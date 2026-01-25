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

async function developCodebook () {
	const model = "claude-sonnet-4-5";

	const response = await client.beta.messages.create({
		model,
		max_tokens: 8000,
		betas: ["structured-outputs-2025-11-13"],
		system: systemInstruction,
		messages: [
			{
				role: "user",
				content: codebookPrompt,
			},
		],
		output_format: codebookSchema,
	});

	const jsonText = response.content[0].text;
	return JSON.parse(jsonText);
}

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

await main();
