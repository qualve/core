import { loadEnvFile } from "node:process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createUserContent, createPartFromUri, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { answersSchema } from "./schemas.js";
import { inputAnswers, intro, codingInstructions } from "./prompts.js";
import { handleStreamedChunks } from "./util.js";

loadEnvFile(".env");

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
});

async function codeAnswers (questionId) {
	const question = JSON.parse(await readFile(`${questionId}/question.json`, "utf-8")).description;

	let codebookFile;
	try {
		// Check if the file exists
		codebookFile = await getFile(`files/${questionId}-codebook`);
	}
	catch (e) {
		// If doesn't exist, upload it
		console.log("Uploading the codebook...");
		codebookFile = await uploadFile(`${questionId}/codebook.json`);
	}

	let answersFile;
	try {
		answersFile = await getFile(`files/${questionId}-answers`);
	}
	catch (e) {
		console.log("Uploading the answers...");
		answersFile = await uploadFile(`${questionId}/answers.json`);
	}

	const stream = await ai.models.generateContentStream({
		model: "gemini-3-pro",
		contents: createUserContent([
			inputAnswers,
			codingInstructions,
			createPartFromUri(answersFile.uri, answersFile.mimeType),
			createPartFromUri(codebookFile.uri, codebookFile.mimeType),
		]),
		config: {
			systemInstruction: intro(question),
			tools: [
				{
					googleSearch: {},
				},
			],
			responseMimeType: "application/json",
			responseJsonSchema: answersSchema.schema,
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.HIGH,
			},
		},
	});

	console.log("Thinking...");

	handleStreamedChunks({
		stream,
		filepath: `${questionId}/gemini-coding.json`,
		transform: chunk => chunk.candidates[0].content.parts[0].text,
	});

	console.log("Done!");
}

// await codeAnswers("browser_apis");

// === Helper functions for file management === //

async function uploadFile (filepath, mimeType = "application/json") {
	const { dir: prefix, name, base } = path.parse(filepath);

	const myfile = await ai.files.upload({
		file: filepath,
		config: {
			// Important: File name may only contain lowercase alphanumeric characters or dashes (-) and cannot begin or end with a dash.
			name: `${prefix}-${name}`.replace(/_/g, "-"),
			displayName: `${prefix}-${base}`,
			mimeType,
		},
	});

	return myfile;
}

async function getFile (name) {
	name = name.replace(/_/g, "-");

	// Why not just ai.files.get()? Because it throws in two cases: file not found and permission denied.
	// We can't distinguish them without listing all files.
	let files = await ai.files.list();
	for await (const file of files) {
		if (file.name === name) {
			return file;
		}
	}

	// Not found
	return null;
}

async function deleteFile (name) {
	await ai.files.delete({ name: name.replace(/_/g, "-") });
}

async function listFiles () {
	const meta = [];
	const listResponse = await ai.files.list();
	for await (const file of listResponse) {
		meta.push(file);
	}

	return meta;
}
