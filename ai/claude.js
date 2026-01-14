import { loadEnvFile } from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { codebookSchema, csvToJson, jsonToCsv } from "../util.js";
import { toFile } from "@anthropic-ai/sdk";

loadEnvFile(".env");

// Upload files to Anthropic's file storage
async function uploadFile(filepath, mimeType = "application/json") {
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

async function deleteFile(fileId) {
	return client.beta.files.delete(fileId, {
		betas: ["files-api-2025-04-14"],
	});
}

async function listFiles() {
	const meta = [];

	for await (const file of client.beta.files.list({
		betas: ["files-api-2025-04-14"],
	})) {
		meta.push(file);
	}

	return meta;
}

const client = new Anthropic({
	apiKey: process.env["ANTHROPIC_API_KEY"],
});

const model = "claude-sonnet-4-20250514";
const systemPrompt = `Who you are and what you need to do...`;
const codebookPrompt = `...`;

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

async function developCodebook() {
	const response = await client.messages.create({
		model,
		max_tokens: 8000,
		system: systemPrompt,
		messages: [
			{
				role: "user",
				content: codebookPrompt,
			},
		],
		output_format: codebookSchema,
	});

	const yamlText = response.content.find((b) => b.type === "text").text;
	return yaml.load(yamlText);
}
