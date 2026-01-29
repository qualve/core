import path from "node:path";
import fs from "node:fs";
import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { answersSchema } from "./schemas.js";
import { codingInstructions, intro, inputAnswers } from "./prompts.js";
import { handleStreamedChunks, showProgressIndicator } from "./util.js";

loadEnvFile(".env");

const client = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

async function getVectorStore (name) {
	const vectorStores = await client.vectorStores.list();

	// First, let's try to find an existing vector store
	for await (const store of vectorStores) {
		if (store.name === name) {
			return store;
		}
	}

	// If not found, create a new one
	return await client.vectorStores.create({ name });
}

export async function codeAnswers (questionId, { fresh, model = "gpt-5.2-pro" } = {}) {
	if (!questionId) {
		throw new Error("Question id is required!");
	}

	const question = JSON.parse(await readFile(`${questionId}/question.json`, "utf-8")).description;

	console.log("Working with source files...");

	let codebookPath = `${questionId}/codebook.json`;
	let answersPath = `${questionId}/answers.json`;

	let codebookFile = await getFile(codebookPath);
	let answersFile = await getFile(answersPath);

	const filesVS = await getVectorStore(`${questionId}-files`);

	if (fresh) {
		if (codebookFile) {
			await client.files.del(codebookFile.id);
			await client.vectorStores.files.del(filesVS.id, codebookFile.id);
			codebookFile = null;
		}

		if (answersFile) {
			await client.files.del(answersFile.id);
			await client.vectorStores.files.del(filesVS.id, answersFile.id);
			answersFile = null;
		}
	}

	try {
		if (!codebookFile) {
			console.log("Uploading the codebook...");
			codebookFile = await uploadFile(codebookPath);
			await client.vectorStores.files.createAndPoll(filesVS.id, { file_id: codebookFile.id });
		}

		if (!answersFile) {
			console.log("Uploading the answers...");
			answersFile = await uploadFile(answersPath);
			await client.vectorStores.files.createAndPoll(filesVS.id, { file_id: answersFile.id });
		}
	}
	catch (e) {
		// Something went wrong. We can't proceed without these files. Abort the mission!
		throw e;
	}

	console.log(`Source files (${codebookFile.filename}, ${answersFile.filename}) are ready.`);

	let stopIndicator = showProgressIndicator("Coding with OpenAI and streaming the response...");

	const stream = client.responses.stream({
		model,
		reasoning: {
			effort: "high",
		},
		input: [
			{
				type: "message",
				role: "system",
				content: intro(question),
			},
			{
				type: "message",
				role: "user",
				content: inputAnswers,
			},
			{
				type: "message",
				role: "user",
				content: codingInstructions,
			},
		],
		tools: [
			{
				type: "file_search",
				vector_store_ids: [filesVS.id],
			},
		],
		tool_choice: { type: "file_search" },
		text: {
			verbosity: "low",
			format: {
				name: "answers_coding",
				type: "json_schema",
				strict: true,
				schema: {
					title: "Coded Answers",
					type: "object",
					properties: {
						answers: {
							...answersSchema.schema,
						},
					},
					required: ["answers"],
					additionalProperties: false,
				},
			},
		},
	});

	await handleStreamedChunks({
		stream,
		filepath: `${questionId}/gpt.json`,
		suffix: model.replace("gpt", "") + "-coding",
		transform: chunk => (chunk.type === "response.output_text.delta" ? chunk.delta : ""),
	});

	await stream.finalResponse();

	stopIndicator();
	console.log("Done!");
}

// === Helper functions for file management === //

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
