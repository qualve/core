import { loadEnvFile } from "node:process";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createUserContent, createPartFromUri, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { answersSchema, codebookSchema } from "./schemas.js";
import {
	inputAnswers,
	intro,
	codingInstructions,
	codebookGenerationInstructions,
} from "./prompts.js";
import { cleanUpFile, handleStreamedChunks, showProgressIndicator } from "./util.js";

loadEnvFile(".env");

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
});

export async function generateCodebook (
	questionId,
	{ fresh, model = "gemini-3-pro-preview" } = {},
) {
	if (!questionId) {
		throw new Error("Question id is required!");
	}

	const question = JSON.parse(await readFile(`${questionId}/question.json`, "utf-8")).description;

	console.log("Working with source files...");

	let codebookFile, answersFile;
	try {
		codebookFile = await getFile(`files/${questionId}-starting-codebook`);
		answersFile = await getFile(`files/${questionId}-answers`);
	}
	catch (e) {
		let message = JSON.parse(e.message);
		if (message?.error?.status === "PERMISSION_DENIED") {
			// This shouldn't happen, abort
			throw e;
		}
	}

	let codebookPath = `${questionId}/starting-codebook.json`;
	let answersPath = `${questionId}/answers.json`;

	if (fresh) {
		// Start fresh
		console.log("Removing previously uploaded files...");

		if (codebookFile) {
			await deleteFile(codebookFile.name);
			codebookFile = null;
		}

		if (answersFile) {
			await deleteFile(answersFile.name);
			answersFile = null;
		}

		console.log("Cleaning up the codebook...");
		await cleanUpFile(codebookPath);
	}

	try {
		if (!codebookFile) {
			console.log("Uploading the codebook...");
			codebookFile = await uploadFile(codebookPath);
		}

		if (!answersFile) {
			console.log("Uploading the answers...");
			answersFile = await uploadFile(answersPath);
		}
	}
	catch (e) {
		// Something went wrong. We can't proceed without these files. Abort the mission!
		throw e;
	}

	console.log(
		`Source files (${codebookFile.name.replace("files/", "")}, ${answersFile.name.replace("files/", "")}) are ready.`,
	);

	let stopIndicator = showProgressIndicator("Generating codebook with Gemini...");

	const stream = await ai.models.generateContentStream({
		model,
		contents: createUserContent([
			codebookGenerationInstructions,
			createPartFromUri(answersFile.uri, answersFile.mimeType),
			createPartFromUri(codebookFile.uri, codebookFile.mimeType),
		]),
		config: {
			systemInstruction: intro(question),
			tools:
				model.includes("-pro-") || model.endsWith("-pro")
					? [{ googleSearch: {} }]
					: undefined,
			responseMimeType: "application/json",
			responseJsonSchema: codebookSchema.schema,
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.HIGH,
			},
		},
	});

	stopIndicator();
	stopIndicator = showProgressIndicator("Streaming the response...");

	await handleStreamedChunks({
		stream,
		filepath: `${questionId}/codebook.json`,
		transform: chunk => chunk.candidates[0].content.parts[0].text,
	});

	stopIndicator();
	console.log("Done!");
}

export async function codeAnswers (questionId, { fresh, model = "gemini-3-pro-preview" } = {}) {
	if (!questionId) {
		throw new Error("Question id is required!");
	}

	const question = JSON.parse(await readFile(`${questionId}/question.json`, "utf-8")).description;

	console.log("Working with source files...");

	let codebookFile, answersFile;
	try {
		codebookFile = await getFile(`files/${questionId}-codebook`);
		answersFile = await getFile(`files/${questionId}-answers`);
	}
	catch (e) {
		let message = JSON.parse(e.message);
		if (message?.error?.status === "PERMISSION_DENIED") {
			// This shouldn't happen, abort
			throw e;
		}
	}

	let codebookPath = `${questionId}/codebook.json`;
	let answersPath = `${questionId}/answers.json`;

	if (fresh == undefined) {
		// Determine if we should start fresh.
		// Check if codebook_original.json exists.
		fresh = !existsSync(`${questionId}/codebook_original.json`, "utf-8");
	}

	if (fresh) {
		// Start fresh
		console.log("Removing previously uploaded files...");

		if (codebookFile) {
			await deleteFile(codebookFile.name);
			codebookFile = null;

			console.log("Cleaning up the codebook...");
			await cleanUpFile(codebookPath, { exclude: ["ai"] });
		}

		if (answersFile) {
			await deleteFile(answersFile.name);
			answersFile = null;
		}
	}

	try {
		if (!codebookFile) {
			console.log("Uploading the codebook...");
			codebookFile = await uploadFile(codebookPath);
		}

		if (!answersFile) {
			console.log("Uploading the answers...");
			answersFile = await uploadFile(answersPath);
		}
	}
	catch (e) {
		// Something went wrong. We can't proceed without these files. Abort the mission!
		throw e;
	}

	console.log(
		`Source files (${codebookFile.name.replace("files/", "")}, ${answersFile.name.replace("files/", "")}) are ready.`,
	);

	let stopIndicator = showProgressIndicator("Coding with Gemini...");

	const stream = await ai.models.generateContentStream({
		model,
		contents: createUserContent([
			inputAnswers,
			codingInstructions,
			createPartFromUri(answersFile.uri, answersFile.mimeType),
			createPartFromUri(codebookFile.uri, codebookFile.mimeType),
		]),
		config: {
			systemInstruction: intro(question),
			tools:
				model.includes("-pro-") || model.endsWith("-pro")
					? [{ googleSearch: {} }]
					: undefined,
			responseMimeType: "application/json",
			responseJsonSchema: answersSchema.schema,
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.HIGH,
			},
		},
	});

	stopIndicator();
	stopIndicator = showProgressIndicator("Streaming the response...");

	await handleStreamedChunks({
		stream,
		filepath: `${questionId}/gemini.json`,
		suffix: model.replace("gemini", "") + "-coding",
		transform: chunk => chunk.candidates[0].content.parts[0].text,
	});

	stopIndicator();
	console.log("Done!");
}

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
