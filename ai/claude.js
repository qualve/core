import { loadEnvFile } from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { csvToJson, jsonToCsv } from "./util.js";
import { codebookSchema } from "./schemas.js";
import { codebookPrompt, systemInstruction } from "./prompts.js";
import { toFile } from "@anthropic-ai/sdk";

loadEnvFile(".env");

// Upload files to Anthropic's file storage
async function uploadFile (filepath, mimeType = "application/json") {
	const file = await fs.readFile(filepath);
	const filename = path.basename(filepath);

	return client.beta.files.upload(
		{
			file: await toFile(file, filename, { type: mimeType }),
		},
		{
			betas: ["files-api-2025-04-14"],
		},
	);
}

async function deleteFile (fileId) {
	return client.beta.files.delete(fileId, {
		betas: ["files-api-2025-04-14"],
	});
}

async function listFiles () {
	const meta = [];

	for await (const file of client.beta.files.list({
		betas: ["files-api-2025-04-14"],
	})) {
		meta.push(file);
	}

	return meta;
}

async function getFile (name) {
	const list = await listFiles();
	const basename = path.basename(name);
	return list.find(f => f.filename === basename);
}

const client = new Anthropic({
	apiKey: process.env["ANTHROPIC_API_KEY"],
});

// await csvToJson("files/starting_codes.csv");
// await jsonToCsv("files/coded_responses.json");

// let meta = await uploadFile("files/starting_codes.json");
// let meta = await uploadFile("files/starting_codes.json");
//
// let meta = await uploadFile("files/starting_codes.csv", "text/csv");
// deleteFile("file_011CWPnvt6k8gCz2gvPmevKM");

// try {
// 	let meta = await uploadFile("files/responses.json");
// 	console.log("File ID", meta.id);
// } catch (e) {
// 	throw new Error(`Failed to upload file: ${e.message}`);
// }

// let files = await listFiles();
// console.log(files);

// It's an example of how to use the API to generate content.
async function main () {
	const response = await client.beta.messages.create({
		model: "claude-sonnet-4-5",
		system: "You are a helpful assistant that generates a list of famous physicists.",
		max_tokens: 1024,
		betas: ["structured-outputs-2025-11-13"],
		messages: [
			{
				role: "user",
				content: "Provide a list of 3 famous physicists.",
			},
		],
		// See https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-outputs
		output_format: {
			type: "json_schema",
			schema: {
				title: "Famous Physicists",
				type: "array",
				items: {
					type: "object",
					properties: {
						first_name: {
							type: "string",
						},
						middle_name: {
							type: "string",
						},
						last_name: {
							type: "string",
						},
					},
					required: ["first_name", "last_name"],
					additionalProperties: false,
				},
			},
		},
	});

	console.log(response.content[0].text);
	// Possible output:
	// [{"first_name":"Albert","last_name":"Einstein"},{"first_name":"Isaac","last_name":"Newton"},{"first_name":"Marie","last_name":"Curie"}]
}

// await main();

async function useFileAsSourceTest (filename = "files/films.json") {
	// Check if the file exists
	let file = await getFile(filename);

	// If doesn't exist, upload it
	if (!file) {
		console.log("Uploading file...");

		// Claude can't work with files of types other than PDF and plain text.
		// So, we need to "trick" it by uploading a JSON file as a plain text file.
		file = await uploadFile(filename, "text/plain");
	}

	console.log("File metadata:");
	console.log(file);

	let res = [],
		json;

	console.log("Thinking...");
	// See https://platform.claude.com/docs/en/build-with-claude/streaming
	client.beta.messages
		.stream({
			model: "claude-sonnet-4-5",
			system: "You are a helpful assistant that provides Russian distribution titles for films.",
			max_tokens: 1024,
			betas: ["structured-outputs-2025-11-13", "files-api-2025-04-14"],
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "For each of the films mentioned in the attached file, find their title in Russian distribution.",
						},
						{
							type: "document",
							source: {
								type: "file",
								file_id: file.id,
							},
						},
					],
				},
			],
			output_format: {
				type: "json_schema",
				schema: {
					title: "Films with Russian Titles",
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
		})
		.on("text", text => {
			res.push(text);
		})
		.on("end", async () => {
			json = JSON.parse(res.join("").trim());

			console.log("Response:\n");
			console.log(json);

			console.log("Saving the response to a file...");
			await fs.writeFile(
				filename.replace(/\.json$/, "") + "-russian-titles-claude.json",
				JSON.stringify(json, null, 2),
			);

			console.log("Done!");
		});
}

// await useFileAsSourceTest();

async function developCodebook (filename = "files/starting-codes.json") {
	const model = "claude-sonnet-4-5";

	// Check if the file exists
	let file = await getFile(filename);

	// If doesn't exist, upload it
	if (!file) {
		// Claude can't work with files of types other than PDF and plain text.
		// So, we need to "trick" it by uploading a JSON file as a plain text file.
		file = await uploadFile(filename, "text/plain");
	}

	// See https://platform.claude.com/docs/en/build-with-claude/streaming
	client.beta.messages
		.stream({
			model,
			max_tokens: 8000,
			betas: ["structured-outputs-2025-11-13", "files-api-2025-04-14"],
			system: systemInstruction,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: codebookPrompt },
						{
							type: "document",
							source: {
								type: "file",
								file_id: file.id,
							},
						},
					],
				},
			],
			output_format: codebookSchema,
		})
		.on("text", chunk => {
			// Handle intermediate text chunks
		})
		.on("error", error => {
			// Handle error
		})
		.on("end", () => {
			// Handle completion
		});
}
