import LLMTask from "@qualve/llm";
import { createUserContent, createPartFromUri, GoogleGenAI } from "@google/genai";
import GeminiFile from "./file.js";

export default class Gemini extends LLMTask {
	static id = "gemini";
	static name = "Gemini";
	static File = GeminiFile;
	static models = ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
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
		let { system } = this;
		const result = await this.client.models.countTokens({
			model: this.model,
			contents: createUserContent([
				// FIXME: Pass system instructions via `config.systemInstruction` once the Gemini Developer API supports it on countTokens (Vertex AI does; the Developer API rejects it at request build).
				...system,
				...this.promptContent
					.map(seg => (seg.text !== undefined ? seg.text : seg.file.toString()))
					.filter(Boolean),
			]),
		});

		return result.totalTokens;
	}

	async createStream () {
		let { system, output } = this;
		let responseSchema;
		if (output?.[0]?.schema) {
			responseSchema = {
				responseMimeType: "application/json",
				responseJsonSchema: output[0].schema.schema,
			};
		}

		const stream = await this.client.models.generateContentStream({
			model: this.model,
			// Stable reference input first, then prompt, then the per-call payload, so the shared
			// prefix (e.g. the codebook) stays a cacheable prefix across calls. See LLMTask#promptContent.
			// TODO: use explicit CachedContent for the stable prefix — guaranteed cache + longer TTL,
			// and immune to remote-identity churn — instead of best-effort implicit prefix caching.
			contents: createUserContent(
				this.promptContent.map(seg =>
					seg.text !== undefined
						? seg.text
						: createPartFromUri(seg.file.remoteFile.uri, seg.file.remoteFile.mimeType)),
			),
			config: {
				systemInstruction: system?.join("\n"),
				// Low temperature favors focused, on-task output; the small nonzero
				// margin lets the model follow constrained schemas without refusing.
				temperature: 0.1,
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
