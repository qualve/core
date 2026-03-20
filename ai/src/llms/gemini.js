import { createHash } from "node:crypto";
import LLMTask from "../types/llm.js";
import { createUserContent, createPartFromUri, GoogleGenAI } from "@google/genai";

export default class Gemini extends LLMTask {
	static id = "gemini";
	static name = "Gemini";
	static models = [
		"gemini-3.1-pro-preview",
		"gemini-3.1-flash-preview",
		"gemini-3.1-flash-lite-preview",
	];
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

		// Gemini file ID: lowercase alphanumeric or dashes, no leading/trailing dashes.
		name = name.replace(/[_.]/g, "-").replace(/^-|-$/g, "");

		// Gemini file IDs are limited to 40 chars.
		// Batch slice inputs can exceed this (e.g. "ba-answers-normalized-unique-500-999-json").
		// Truncate with a hash suffix to preserve uniqueness.
		let maxLength = 40;
		if (name.length > maxLength) {
			let hash = createHash("sha256").update(name).digest("hex").slice(0, 6);
			name = name.slice(0, maxLength - 7) + "-" + hash;
		}

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
	 * Execute a file operation with shared error handling for not-found cases.
	 * Gemini returns 403 (not 404) when a file doesn't exist, so we disambiguate
	 * by listing files to check whether it's a real permission error.
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
			if (e.status === 403 || e.status === 404) {
				// 403 can mean "not found" on Gemini — verify by listing files.
				// 404 is a straightforward not-found.
				if (e.status === 403) {
					let files = await this.client.files.list();
					for await (let file of files) {
						if (file.name === name) {
							throw new Error(
								`You don't have permission to access file ${filepath}`,
								{
									cause: e,
								},
							);
						}
					}
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

	async countTokens () {
		let { system, prompt, input = [] } = this;
		const result = await this.client.models.countTokens({
			model: this.model,
			contents: createUserContent([
				// FIXME: Correctly pass system instructions via `config.systemInstruction` instead of including them in contents once countTokens supports it.
				...system,
				...prompt,
				...input
					.map(f => this.readFile(f.filePath, { contents: f.contents })?.contents)
					.filter(Boolean),
			]),
		});

		return result.totalTokens;
	}

	async createStream () {
		let { system, prompt, output, input = [] } = this;
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

		let finishReason;
		return {
			stream,
			transformChunk: chunk => {
				// Filter out thought-parts so thinking text is never written to the output
				let part = chunk.candidates?.[0]?.content?.parts?.find(p => !p.thought);
				return part?.text ?? "";
			},
			onChunk: chunk => {
				// See https://googleapis.github.io/js-genai/release_docs/enums/types.FinishReason.html
				finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
			},
			onFinish: () => {
				if (!finishReason) {
					// No finishReason means no evidence of failure — treat as complete.
					return {
						complete: true,
						reason: LLMTask.stopReasons.COMPLETE,
						reasonRaw: null,
					};
				}

				// Gemini finish reasons → normalized stop reasons.
				// See https://googleapis.github.io/js-genai/release_docs/enums/types.FinishReason.html
				// STOP:               Natural stop or configured stop sequence reached.
				// MAX_TOKENS:         Configured maximum output tokens reached.
				// SAFETY:             Content potentially contains safety violations.
				// RECITATION:         Content potentially recites training data.
				// LANGUAGE:           Unsupported language detected.
				// BLOCKLIST:          Content contains forbidden terms.
				// PROHIBITED_CONTENT: Content potentially contains prohibited material.
				// SPII:               Content potentially contains Sensitive Personally Identifiable Information.
				let reasons = {
					STOP: LLMTask.stopReasons.COMPLETE,
					MAX_TOKENS: LLMTask.stopReasons.MAX_TOKENS,
					SAFETY: LLMTask.stopReasons.ABORTED,
					RECITATION: LLMTask.stopReasons.ABORTED,
					LANGUAGE: LLMTask.stopReasons.ABORTED,
					BLOCKLIST: LLMTask.stopReasons.ABORTED,
					PROHIBITED_CONTENT: LLMTask.stopReasons.ABORTED,
					SPII: LLMTask.stopReasons.ABORTED,
				};

				let normalized = reasons[finishReason] ?? LLMTask.stopReasons.UNKNOWN;
				return {
					complete: normalized === LLMTask.stopReasons.COMPLETE,
					reason: normalized,
					reasonRaw: finishReason,
				};
			},
		};
	}
}

LLMTask.register(Gemini);
