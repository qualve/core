import LLM from "../llm.js";
import { truncatedIds } from "../question.js";
import { createUserContent, createPartFromUri, GoogleGenAI, ThinkingLevel } from "@google/genai";

export default class Gemini extends LLM {
	static id = "gemini";
	static name = "Gemini";
	static models = ["gemini-3-pro-preview", "gemini-3-flash-preview"];
	static capabilities = {
		outputSchema: true,
	};

	get capabilities () {
		return {
			...super.capabilities,
			webSearch: /-pro(?:-|$)/.test(this.model),
		};
	}

	client = new GoogleGenAI({
		apiKey: process.env.GEMINI_API_KEY,
	});

	getFileInfo (filepath) {
		let { name, dirName } = super.getFileInfo(filepath);
		let displayName = name;
		// Important: File name may only contain lowercase alphanumeric characters or dashes (-) and cannot begin or end with a dash.
		let prefix = truncatedIds[dirName];
		name = `${prefix}-${name}`.replace(/[_.]/g, "-").replace(/^-|-$/g, "");
		return { name, dirName, displayName };
	}

	async uploadFile (filepath, { mimeType, contents }) {
		let { name, displayName } = this.getFileInfo(filepath);
		return this.client.files.upload({
			file: new Blob([contents], { type: mimeType }),
			config: { name, displayName, mimeType },
		});
	}

	async getFile (filepath) {
		let { name } = this.getFileInfo(filepath);
		try {
			// If we don't await here, the error is unhandled
			return await this.client.files.get({ name: "files/" + name });
		}
		catch (e) {
			let message = JSON.parse(e.message);
			if (message?.error?.code === 403) {
				// Check if the file exists but we don't have permission to access it
				let files = await this.client.files.list();
				for await (let file of files) {
					if (file.name === "files/" + name) {
						var ret = file;
					}
				}

				if (ret) {
					// Permission denied. This shouldn't happen, abort
					throw new Error(`You don't have permission to access file ${filepath}`, {
						cause: e,
					});
				}
			}
			else {
				throw new Error(`Failed to get file ${filepath}`, { cause: e });
			}
		}

		// Not found
		return null;
	}

	async deleteFile (filepath) {
		let { name } = this.getFileInfo(filepath);

		try {
			// If we don't await here, the error is unhandled
			return await this.client.files.delete({ name: "files/" + name });
		}
		catch (e) {
			let message = JSON.parse(e.message);
			if (message?.error?.status === "PERMISSION_DENIED") {
				// This shouldn't happen, abort
				throw new Error(`Failed to delete file ${filepath}`, { cause: e });
			}
		}

		// Not found; nothing to delete
		return null;
	}

	async listFiles () {
		return [...(await this.client.files.list())];
	}

	async createStream ({ system, prompt, output, input = [] }) {
		let responseSchema = output?.schema;
		const stream = await this.client.models.generateContentStream({
			model: this.model,
			contents: createUserContent([
				...prompt,
				...input.map(f => createPartFromUri(f.remoteFile.uri, f.remoteFile.mimeType)),
			]),
			config: {
				systemInstruction: system?.join("\n"),
				tools: this.capabilities.webSearch ? [{ googleSearch: {} }] : undefined,
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
	}
}
