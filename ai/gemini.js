import { loadEnvFile } from "node:process";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
	createUserContent,
	createPartFromUri,
	GoogleGenAI,
	ThinkingLevel,
	Type,
} from "@google/genai";
import { codebookSchema } from "./schemas.js";
import { codebookPrompt, systemInstruction } from "./prompts.js";

loadEnvFile(".env");

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
});

async function uploadFile (filepath, mimeType = "application/json") {
	const myfile = await ai.files.upload({
		file: filepath,
		config: {
			// Important: File name may only contain lowercase alphanumeric characters or dashes (-) and cannot begin or end with a dash.
			name: path.parse(filepath).name.replace(/_/g, "-"),
			displayName: path.basename(filepath),
			mimeType,
		},
	});

	return myfile;
}

async function getFile (name) {
	// Returns the file metadata. Example:
	// {
	// 	name: 'files/starting-codes',
	// 	displayName: 'starting_codes.json',
	// 	mimeType: 'application/json',
	// 	sizeBytes: '9489',
	// 	createTime: '2026-01-14T12:38:12.184717Z',
	// 	updateTime: '2026-01-14T12:38:12.184717Z',
	// 	expirationTime: '2026-01-16T12:38:11.617341351Z',
	// 	sha256Hash: 'YjkyNDcwNmMxZWUwN2Q4YTgyMDQzMmQxMWVjNjdlZGU3NGRjZjYyZGM4YTM1Y2U0NmQ4NjRhNThiNTdmN2M0OQ==',
	// 	uri: 'https://generativelanguage.googleapis.com/v1beta/files/starting-codes',
	// 	state: 'ACTIVE',
	// 	source: 'UPLOADED'
	// }
	return ai.files.get({ name: name.replace(/_/g, "-") });
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

// It's an example of how to use the API to generate content.
async function main () {
	const prompt = "Provide a list of 3 famous physicists.";

	const stream = await ai.models.generateContentStream({
		model: "gemini-3-flash-preview",
		contents: prompt,
		config: {
			systemInstruction:
				"You are a helpful assistant that generates a list of famous physicists.",
			responseMimeType: "application/json",
			responseJsonSchema: {
				// See https://ai.google.dev/gemini-api/docs/structured-output?example=recipe#json_schema_support
				title: "Famous Physicists",
				type: Type.ARRAY,
				items: {
					type: Type.OBJECT,
					properties: {
						first_name: {
							type: Type.STRING,
						},
						middle_name: {
							type: Type.STRING,
						},
						last_name: {
							type: Type.STRING,
						},
					},
					required: ["first_name", "last_name"],
					additionalProperties: false,
				},
			},
			thinkingConfig: {
				// See https://ai.google.dev/gemini-api/docs/thinking#levels-budgets
				thinkingLevel: ThinkingLevel.LOW,
			},
		},
	});

	// Stream the response
	for await (const chunk of stream) {
		let text = chunk.candidates[0].content.parts[0].text;
		console.log(text, "\n");
	}

	// One of possible outputs (in the console):
	// 	[{"first_name":"Albert","last_name
	//
	// ":"Einstein"},{"first_name":"Isaac","last_name":"Newton"},{"first_name":"Richard","middle_name
	//
	// ":"Phillips","last_name":"Feynman"}]
}

// await main();

// let myfile = await uploadFile("files/starting_codes.json");
// console.log(myfile);

// let meta = await getFile("files/starting-codes");
// console.log(meta);

// let files = await listFiles();
// console.log(files);

// await deleteFile("files/starting-codes");
// let files = await listFiles();
// console.log(files);

async function useFileAsSourceTest (filename = "files/films") {
	let file;
	try {
		// Check if the file exists
		file = await getFile(filename);
	}
	catch (e) {
		console.log("Uploading file...");
		file = await uploadFile(filename + ".json");
	}

	console.log("File metadata:");
	console.log(file);

	const stream = await ai.models.generateContentStream({
		model: "gemini-3-flash-preview",
		contents: createUserContent([
			"For each of the films mentioned in the attached file, find their title in Russian distribution.",
			createPartFromUri(file.uri, file.mimeType),
		]),
		config: {
			systemInstruction:
				"You are a helpful assistant that provides Russian distribution titles for films.",
			responseMimeType: "application/json",
			responseJsonSchema: {
				title: "Films with Russian Titles",
				type: Type.ARRAY,
				items: {
					type: Type.OBJECT,
					properties: {
						original_title: {
							type: Type.STRING,
						},
						russian_title: {
							type: Type.STRING,
						},
					},
					required: ["original_title", "russian_title"],
					additionalProperties: false,
				},
			},
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.LOW,
			},
		},
	});

	console.log("Thinking...");
	// Stream the response
	let res = [];
	for await (const chunk of stream) {
		res.push(chunk.candidates[0].content.parts[0].text);
	}

	let json = JSON.parse(res.join(""));
	console.log("Response:\n", json);

	console.log("Saving the response to a file...");
	await writeFile(filename + "-russian-titles-gemini.json", JSON.stringify(json, null, 2));

	console.log("Done!");
}

// await useFileAsSourceTest();

async function developCodebook (filename = "files/starting-codes") {
	const model = "gemini-3-flash-preview"; // TODO: Use the correct model. E.g., gemini-3-pro-preview

	let file;
	try {
		// Check if the file exists
		file = await getFile(filename);
	}
	catch (e) {
		// If doesn't exist, upload it
		file = await uploadFile(filename + ".json");
	}

	const stream = await ai.models.generateContentStream({
		model,
		contents: createUserContent([codebookPrompt, createPartFromUri(file.uri, file.mimeType)]),
		config: {
			systemInstruction,
			responseMimeType: "application/json",
			responseJsonSchema: codebookSchema.schema,
			thinkingConfig: {
				// See https://ai.google.dev/gemini-api/docs/thinking#levels-budgets
				thinkingLevel: ThinkingLevel.HIGH,
			},
		},
	});

	// Stream the response
	for await (const chunk of stream) {
		let text = chunk.candidates[0].content.parts[0].text;
		// TODO: Save the chunk to a file
	}
}
