import path from "node:path";
import { createUserContent, createPartFromUri, GoogleGenAI, ThinkingLevel } from "@google/genai";

export default {
	id: "gemini",
	name: "Gemini",
	models: ["gemini-3-pro-preview", "gemini-3-flash-preview"],

	getClient: () =>
		new GoogleGenAI({
			apiKey: process.env.GEMINI_API_KEY,
		}),

	normalizeFilename (filename) {
		// Important: File name may only contain lowercase alphanumeric characters or dashes (-) and cannot begin or end with a dash.
		return filename.replace(/[_.]/g, "-").replace(/^-|-$/g, "");
	},

	async uploadFile (filepath, { key = filepath, displayName = key, mimeType }) {
		return this.client.files.upload({
			file: filepath,
			config: {
				name: key,
				displayName,
				mimeType,
			},
		});
	},

	async getFile (name) {
		try {
			// If we don't await here, the error is unhandled
			return await this.client.files.get({ name: "files/" + name });
		}
		catch (e) {}

		// this.client.files.get() throws in two cases: file not found and permission denied.
		// We can't distinguish them without listing all files.
		try {
			let files = await this.client.files.list();
			for await (const file of files) {
				if (file.name === "files/" + name) {
					return file;
				}
			}
		}
		catch (e) {
			let message = JSON.parse(e.message);
			if (message?.error?.status === "PERMISSION_DENIED") {
				// This shouldn't happen, abort
				throw e;
			}
		}

		// Not found
		return null;
	},

	async deleteFile (name) {
		let file = await this.getFile(name);
		if (!file) {
			// Not found
			return null;
		}

		await this.client.files.delete({ name: file.name });
	},

	async listFiles () {
		return [...(await this.client.files.list())];
	},

	async createStream ({ system, task, responseSchema, files = {} }) {
		task = Array.isArray(task) ? task : [task];

		const stream = await this.client.models.generateContentStream({
			model: this.model,
			contents: createUserContent([
				...task,
				...Object.values(files).map(file => createPartFromUri(file.uri, file.mimeType)),
			]),
			config: {
				systemInstruction: system,
				// For deductive coding, it's recommended to keep the temperature low (e.g., 0.0 as with other LLMs).
				// However, we need to allow Gemini some flexibility to follow the schema properly.
				// Otherwise, it might refuse to answer, and we'll never get a response.
				temperature: 0.1,
				tools: /-pro(?:-|$)/.test(this.model) ? [{ googleSearch: {} }] : undefined,
				responseMimeType: "application/json",
				responseJsonSchema: responseSchema.schema,
				thinkingConfig: {
					thinkingLevel: ThinkingLevel.HIGH,
				},
			},
		});

		return {
			stream,
			transformChunk: chunk => chunk.candidates[0].content.parts[0].text,
		};
	},
};
