import LLMTask from "@qualve/llm";
import { createUserContent, createPartFromUri, GoogleGenAI } from "@google/genai";
import GeminiFile from "./file.js";

export default class Gemini extends LLMTask {
	static id = "gemini";
	static name = "Gemini";
	static File = GeminiFile;
	static models = [
		"gemini-3.1-pro-preview",
		"gemini-3.5-flash",
		"gemini-3.1-flash-lite",
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
					.map(f => f.toString())
					.filter(Boolean),
			]),
		});

		return result.totalTokens;
	}

	async createStream () {
		let { system, prompt, output, input = [] } = this;
		let responseSchema;
		if (output?.[0]?.schema) {
			responseSchema = {
				responseMimeType: "application/json",
				responseJsonSchema: output[0].schema.schema,
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
				// SPII:              Content potentially contains Sensitive Personally Identifiable Information.
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
