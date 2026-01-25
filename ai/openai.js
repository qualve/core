import path from "node:path";
import fs from "node:fs";
import { loadEnvFile } from "node:process";
import { writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { codebookSchema } from "./schemas.js";
import { codebookPrompt, systemInstruction } from "./prompts.js";

loadEnvFile(".env");

const client = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// File operations: https://platform.openai.com/docs/api-reference/files?lang=node.js
async function uploadFile (filename) {
	return client.files.create({
		file: fs.createReadStream(filename),
		purpose: "user_data",
	});
}

async function listFiles () {
	const meta = [];
	const list = await client.files.list();

	for await (const file of list) {
		meta.push(file);
	}

	return meta;
}

async function getFile (name) {
	const list = await listFiles();

	const basename = path.basename(name);
	return list.find(file => file.filename === basename);
}

async function deleteFile (name) {
	const file = await getFile(name);
	if (file) {
		return client.files.del(file.id);
	}
	return null;
}

// let myfile = await uploadFile("files/starting_codes.json");
// console.log(myfile);

// let meta = await getFile("starting_codes.json");
// console.log(meta);

// let files = await listFiles();
// console.log(files);

// await deleteFile("starting_codes.json");
// let files = await listFiles();
// console.log(files);

// It's an example of how to use the API to generate content.
async function main () {
	// See https://platform.openai.com/docs/guides/structured-outputs?example=structured-data#streaming
	const stream = client.responses
		.stream({
			model: "gpt-5-nano",
			input: [
				{
					type: "message",
					role: "system",
					content:
						"You are a helpful assistant that generates a list of famous physicists.",
				},
				{
					type: "message",
					role: "user",
					content: "Provide a list of 3 famous physicists.",
				},
			],
			text: {
				format: {
					name: "famous_physicists",
					type: "json_schema",
					strict: true,
					schema: {
						title: "Famous Physicist",
						type: "object",
						properties: {
							physicists: {
								type: "array",
								items: {
									type: "object",
									properties: {
										first_name: {
											type: "string",
										},
										// Can't have optional properties in a JSON schema (WTF OpenAI?)
										// middle_name: {
										// 	type: "string",
										// },
										last_name: {
											type: "string",
										},
									},
									required: ["first_name", "last_name"],
									additionalProperties: false,
								},
							},
						},
						required: ["physicists"],
						additionalProperties: false,
					},
				},
			},
		})
		.on("response.refusal.delta", event => {
			console.log(event.delta);
		})
		.on("response.output_text.delta", event => {
			console.log(event.delta);
			// Example output:
			// {"
			// phys
			// ic
			// ists
			// ":[
			// {"
			// first
			// _name
			// ":"
			// Albert
			// ","
			// last
			// _name
			// ":"
			// Ein
			// stein
			// "},{"
			// first
			// _name
			// ":"
			// Marie
			// ","
			// last
			// _name
			// ":"
			// Cur
			// ie
			// "},{"
			// first
			// _name
			// ":"
			// N
			// iels
			// ","
			// last
			// _name
			// ":"
			// Bo
			// hr
			// "}
			// ]}
		})
		.on("response.output_text.done", () => {
			console.log("\n");
		})
		.on("response.error", event => {
			console.error(event.error);
		});

	let result = await stream.finalResponse();

	console.log(result);
	// Example output:
	// {
	//   id: 'resp_05206ecbace67e31006967affe1b94819d99098a6a63a251e4',
	//   object: 'response',
	//   created_at: 1768402942,
	//   status: 'completed',
	//   background: false,
	//   completed_at: 1768402948,
	//   error: null,
	//   frequency_penalty: 0,
	//   incomplete_details: null,
	//   instructions: null,
	//   max_output_tokens: null,
	//   max_tool_calls: null,
	//   model: 'gpt-5-nano-2025-08-07',
	//   output: [
	//     {
	//       id: 'rs_05206ecbace67e31006967affeab4c819d99c28a9ca6dc2d3c',
	//       type: 'reasoning',
	//       summary: []
	//     },
	//     {
	//       id: 'msg_05206ecbace67e31006967b0044c14819d9394bb35a7295e5d',
	//       type: 'message',
	//       status: 'completed',
	//       content: [Array],
	//       role: 'assistant'
	//     }
	//   ],
	//   parallel_tool_calls: true,
	//   presence_penalty: 0,
	//   previous_response_id: null,
	//   prompt_cache_key: null,
	//   prompt_cache_retention: null,
	//   reasoning: { effort: 'medium', summary: null },
	//   safety_identifier: null,
	//   service_tier: 'default',
	//   store: true,
	//   temperature: 1,
	//   text: {
	//     format: {
	//       type: 'json_schema',
	//       description: null,
	//       name: 'famous_physicists',
	//       schema: [Object],
	//       strict: true
	//     },
	//     verbosity: 'medium'
	//   },
	//   tool_choice: 'auto',
	//   tools: [],
	//   top_logprobs: 0,
	//   top_p: 1,
	//   truncation: 'disabled',
	//   usage: {
	//     input_tokens: 92,
	//     input_tokens_details: { cached_tokens: 0 },
	//     output_tokens: 630,
	//     output_tokens_details: { reasoning_tokens: 576 },
	//     total_tokens: 722
	//   },
	//   user: null,
	//   metadata: {},
	//   output_parsed: null
	// }
}

// await main();

async function useFileAsSourceTest (filename = "files/films.json") {
	// Check if the file exists
	let file = await getFile(filename);

	// If doesn't exist, upload it
	if (!file) {
		console.log("Uploading file...");
		file = await uploadFile(filename);
	}

	console.log("File metadata:");
	console.log(file);

	console.log("Creating vector store to work with the uploaded file...");
	const vectorStore = await client.vectorStores.create({ name: "films-json" });
	await client.vectorStores.files.createAndPoll(vectorStore.id, { file_id: file.id });

	let res = [],
		json;

	console.log("Thinking...");
	const stream = client.responses
		.stream({
			model: "gpt-5-nano",
			reasoning: {
				effort: "medium",
			},
			input: [
				{
					type: "message",
					role: "system",
					content:
						"You are a helpful assistant that provides Russian distribution titles for films.",
				},
				{
					type: "message",
					role: "user",
					content:
						"For each of the films mentioned in the attached file, find their title in Russian distribution.",
				},
			],
			tools: [
				{
					type: "file_search",
					vector_store_ids: [vectorStore.id],
				},
			],
			tool_choice: { type: "file_search" },
			text: {
				verbosity: "low",
				format: {
					name: "films",
					type: "json_schema",
					strict: true,
					schema: {
						title: "Films with Russian Titles",
						type: "object",
						properties: {
							films: {
								type: "array",
								items: {
									type: "object",
									properties: {
										original_title: {
											type: "string",
										},
										russian_title: {
											type: "string",
										},
									},
									required: ["original_title", "russian_title"],
									additionalProperties: false,
								},
							},
						},
						required: ["films"],
						additionalProperties: false,
					},
				},
			},
		})
		.on("response.output_text.delta", event => {
			// Stream the response
			res.push(event.delta);
		})
		.on("response.output_text.done", async event => {
			// We are done
			json = JSON.parse(res.join("").trim());
			// Alternatively
			// json = JSON.parse(event.text.trim());

			console.log("Response:\n", json);

			console.log("Saving the response to a file...");
			await writeFile(
				filename.replace(/\.json$/, "") + "-russian-titles-openai.json",
				JSON.stringify(json, null, 2),
			);
		});

	await stream.finalResponse();
	console.log("Done!");
}

// await useFileAsSourceTest();

async function developCodebook (filename = "files/starting_codes.json") {
	const model = "gpt-5.2-pro";

	// Check if the file exists
	let file = await getFile(filename);

	// If doesn't exist, upload it
	if (!file) {
		file = await uploadFile(filename);
	}

	// Creating vector store to work with the uploaded file
	const vectorStore = await client.vectorStores.create({ name: "codebook-json" });
	await client.vectorStores.files.createAndPoll(vectorStore.id, { file_id: file.id });

	const stream = client.responses
		.stream({
			model,
			reasoning: {
				effort: "medium", // See https://platform.openai.com/docs/guides/reasoning
			},
			input: [
				{
					type: "message",
					role: "system",
					content: systemInstruction,
				},
				{
					type: "message",
					role: "user",
					content: codebookPrompt,
				},
			],
			tools: [
				{
					type: "file_search",
					vector_store_ids: [vectorStore.id],
				},
			],
			tool_choice: { type: "file_search" },
			text: {
				verbosity: "low", // See https://platform.openai.com/docs/guides/latest-model#verbosity
				format: {
					name: "codebook",
					type: "json_schema",
					strict: true,
					schema: {
						title: "Codebook",
						type: "object",
						properties: {
							codes: {
								...codebookSchema.schema,
							},
						},
						required: ["codes"],
						additionalProperties: false,
					},
				},
			},
		})
		.on("response.refusal.delta", event => {
			// Handle the refusal
		})
		.on("response.output_text.delta", event => {
			// Stream the response
		})
		.on("response.output_text.done", () => {
			// We are done
		})
		.on("response.error", event => {
			// Handle the error
		});

	let result = await stream.finalResponse();
	// Do something with the result, if needed
}
