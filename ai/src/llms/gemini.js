import LLM from "../llm.js";
import { createUserContent, createPartFromUri, GoogleGenAI } from "@google/genai";

export default class Gemini extends LLM {
	static id = "gemini";
	static name = "Gemini";
	static models = ["gemini-3-pro-preview", "gemini-3-flash-preview"];
	static levelMap = { none: "minimal", xhigh: "high" };
	static capabilities = {
		outputSchema: true,
		thinkingLevel: true,
	};

	get capabilities () {
		return {
			...super.capabilities,
			webSearch: /-pro(?:-|$)/.test(this.model),
		};
	}

	client = new GoogleGenAI({
		apiKey: process.env.GEMINI_API_KEY,
		httpOptions: { timeout: 30 * 60_000 }, // 30 minutes — LLM tasks with thinking can be very slow
	});

	getFileInfo (filepath) {
		let { name, dirName } = super.getFileInfo(filepath);
		let displayName = name;
		// Important: File name may only contain lowercase alphanumeric characters or dashes (-) and cannot begin or end with a dash.
		name = name.replace(/[_.]/g, "-").replace(/^-|-$/g, "");
		return { name, dirName, displayName };
	}

	async uploadFile (filepath, { mimeType, contents }) {
		let { name, displayName } = this.getFileInfo(filepath);
		return this.client.files.upload({
			file: new Blob([contents], { type: mimeType }),
			config: { name, displayName, mimeType },
		});
	}

	/**
	 * Execute a file operation with shared error handling for 403/not-found cases.
	 * @param {string} filepath - The local file path (used for name resolution and error messages).
	 * @param {"get" | "delete"} method - The method name on `this.client.files` to call.
	 * @returns {Promise<object|null>} The operation result, or null if the file was not found.
	 */
	async #safeFileOp (filepath, method) {
		let { name } = this.getFileInfo(filepath);
		name = "files/" + name;

		try {
			// If we don't await here, the error is unhandled
			return await this.client.files[method]({ name });
		}
		catch (e) {
			let message = JSON.parse(e.message);
			if (message?.error?.code === 403) {
				// Check if the file exists but we don't have permission to access it
				let files = await this.client.files.list();
				for await (let file of files) {
					if (file.name === name) {
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
				throw new Error(`Failed to ${method} file ${filepath}`, { cause: e });
			}
		}

		// Not found
		return null;
	}

	async getFile (filepath) {
		return this.#safeFileOp(filepath, "get");
	}

	async deleteFile (filepath) {
		return this.#safeFileOp(filepath, "delete");
	}

	async listFiles () {
		return [...(await this.client.files.list())];
	}

	async countTokens (task) {
		let { system, prompt, input = [] } = task;
		const result = await this.client.models.countTokens({
			model: this.model,
			contents: createUserContent([
				// FIXME: Correctly pass system instructions via `config.systemInstruction` instead of including them in contents once countTokens supports it.
				...system,
				...prompt,
				...input.map(f => this.readFile(f.filePath)?.contents).filter(Boolean),
			]),
		});

		return result.totalTokens;
	}

	async createStream ({ system, prompt, output, input = [] }) {
		let responseSchema;
		if (output?.schema) {
			responseSchema = {
				responseMimeType: "application/json",
				responseJsonSchema: output?.schema.schema,
			};
		}

		const stream = await this.client.models.generateContentStream({
			model: this.model,
			contents: createUserContent([
				...prompt,
				...input.map(f => createPartFromUri(f.remoteFile.uri, f.remoteFile.mimeType)),
			]),
			config: {
				systemInstruction: system?.join("\n"),
				tools: this.capabilities.webSearch ? [{ googleSearch: {} }] : undefined,
				...responseSchema,
				thinkingConfig: {
					thinkingLevel: this.thinking ?? "high",
				},
			},
		});

		return {
			stream,
			transformChunk: chunk => chunk.candidates[0].content.parts[0].text,
		};
	}
}
