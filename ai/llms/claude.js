import { loadEnvFile } from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { answersSchema } from "../schemas.js";
import { codingInstructions, intro, inputAnswers } from "../prompts.js";
import { handleStreamedChunks, showProgressIndicator } from "../util.js";

loadEnvFile(".env");

const client = new Anthropic({
	apiKey: process.env["ANTHROPIC_API_KEY"],
});

export async function codeAnswers (questionId, { fresh, model = "claude-sonnet-4-5" } = {}) {
	if (!questionId) {
		throw new Error("Question id is required!");
	}

	const question = JSON.parse(
		await readFile(`data/${questionId}/question.json`, "utf-8"),
	).description;

	console.log("Working with source files...");

	let codebookPath = `data/${questionId}/codebook.json`;
	let answersPath = `data/${questionId}/answers.json`;

	let codebookFile = await getFile(codebookPath);
	let answersFile = await getFile(answersPath);

	if (fresh) {
		if (codebookFile) {
			await deleteFile(codebookFile.id);
			codebookFile = null;
		}

		if (answersFile) {
			await deleteFile(answersFile.id);
			answersFile = null;
		}
	}

	try {
		if (!codebookFile) {
			console.log("Uploading the codebook...");
			// Claude can't work with files of types other than PDF and plain text.
			// So, we need to "trick" it by uploading a JSON file as a plain text file.
			codebookFile = await uploadFile(codebookPath, "text/plain");
		}

		if (!answersFile) {
			console.log("Uploading the answers...");
			answersFile = await uploadFile(answersPath, "text/plain");
		}
	}
	catch (e) {
		// Something went wrong. We can't proceed without these files. Abort the mission!
		throw e;
	}

	console.log(`Source files (${codebookFile.filename}, ${answersFile.filename}) are ready.`);

	let stopIndicator = showProgressIndicator("Coding with Claude...");

	const stream = client.beta.messages.stream({
		model,
		max_tokens: 8000,
		betas: ["structured-outputs-2025-11-13", "files-api-2025-04-14"],
		system: intro(question),
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: inputAnswers },
					{ type: "text", text: codingInstructions },
					{
						type: "document",
						source: {
							type: "file",
							file_id: codebookFile.id,
						},
					},
					{
						type: "document",
						source: {
							type: "file",
							file_id: answersFile.id,
						},
					},
				],
			},
		],
		output_format: answersSchema,
	});

	stopIndicator();
	stopIndicator = showProgressIndicator("Streaming the response...");

	await handleStreamedChunks({
		stream,
		filepath: `data/${questionId}/claude.json`,
		suffix: model.replace("claude", "") + "-coding",
		transform: chunk =>
			chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta"
				? chunk.delta.text
				: "",
	});

	stopIndicator();
	console.log("Done!");
}

// === Helper functions for file management === //

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
