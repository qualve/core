import OpenAIClient from "openai";
import LLMTask from "@qualve/llm";
import OpenAIFile from "./file.js";

export default class OpenAI extends LLMTask {
	static models = ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano"];
	static id = "openai";
	static name = "OpenAI";
	static File = OpenAIFile;
	static capabilities = {
		outputSchema: true,
		thinkingLevel: true,
	};

	client = new OpenAIClient({
		apiKey: process.env.OPENAI_API_KEY,
		timeout: 30 * 60_000, // 30 minutes — LLM tasks with thinking can be very slow
	});

	async listFiles () {
		const meta = [];
		const list = await this.client.files.list();

		for await (const file of list) {
			meta.push(file);
		}

		return meta;
	}

	async createStream () {
		let { system, output } = this;
		let responseSchema = output?.[0]?.schema;
		let hasRootObject = output?.[0]?.schemaType === "object";

		if (responseSchema) {
			// All object properties in the response schema must be required.
			// See https://developers.openai.com/api/docs/guides/structured-outputs#all-fields-must-be-required
			let obj = hasRootObject ? responseSchema.schema : responseSchema.schema.items;
			let properties = Object.keys(obj.properties);
			let notRequired = properties.filter(key => !obj.required.includes(key));
			if (notRequired.length) {
				for (let key of notRequired) {
					// Emulate an optional parameter by using a union type with null
					obj.properties[key].type = [obj.properties[key].type, "null"];
				}
				obj.required = properties;
			}

			// OpenAI requires a name for the response schema and strict mode
			responseSchema = { strict: true, name: "response", ...responseSchema };

			if (!hasRootObject) {
				// OpenAI only supports objects at the top level of output schemas.
				// See https://platform.openai.com/docs/guides/structured-outputs#root-objects-must-not-be-anyof-and-must-be-an-object
				responseSchema.schema = {
					type: "object",
					properties: {
						data: responseSchema.schema,
					},
					required: ["data"],
					additionalProperties: false,
				};
			}
		}

		// Using create({ stream: true }) instead of the .stream() helper: the helper's
		// ResponseAccumulator throws on the undocumented "keepalive" event emitted during
		// long background streams. See https://github.com/openai/openai-node/issues/1964
		const stream = await this.client.responses.create({
			model: this.model,
			background: true, // try to avoid hitting a client-side socket timeout after ~601s (10 minutes)
			store: true,
			reasoning: {
				effort: this.thinking ?? "medium",
			},
			input: [
				...system.map(s => ({ type: "message", role: "system", content: s })),
				{
					type: "message",
					role: "user",
					// Stable reference input first, then prompt, then the per-call payload, so the
					// shared prefix (e.g. the codebook) stays cacheable across calls. See LLMTask#promptContent.
					// Uploaded files are sent as direct input_file blocks, giving the model complete access
					// to file contents (unlike file_search which returns chunks).
					// NOTE: setting `prompt_cache_key` here would improve cross-question cache-hit routing (#12).
					content: this.promptContent.flatMap(seg =>
						seg.text !== undefined
							? [{ type: "input_text", text: seg.text }]
							: [
									{ type: "input_text", text: seg.file.describe() },
									{ type: "input_file", file_id: seg.file.remoteFile.id },
								]),
				},
			],
			text: {
				verbosity: "low",
				format: responseSchema,
			},
			stream: true,
		});

		let incompleteReason;
		return {
			stream,
			transformChunk: chunk =>
				chunk.type === "response.output_text.delta" ? chunk.delta : "",
			transformResult: result => (hasRootObject || !responseSchema ? result : result.data),
			onChunk: chunk => {
				if (chunk.type === "response.incomplete") {
					incompleteReason = chunk.response?.incomplete_details?.reason ?? "unknown";
				}
			},
			onFinish: () => {
				if (!incompleteReason) {
					return {
						complete: true,
						reason: LLMTask.stopReasons.COMPLETE,
						reasonRaw: null,
					};
				}

				let reasons = {
					run_length: LLMTask.stopReasons.MAX_TOKENS,
					max_output_tokens: LLMTask.stopReasons.MAX_TOKENS,
				};

				return {
					complete: false,
					reason: reasons[incompleteReason] ?? LLMTask.stopReasons.UNKNOWN,
					reasonRaw: incompleteReason,
				};
			},
		};
	}

	getStatus (chunk) {
		// All supported events: https://platform.openai.com/docs/api-reference/responses-streaming
		let { type, item } = chunk;
		type = type.replace("response.", "");
		let message;
		if (type === "created") {
			message = "Processing the input...";
		}
		else if (type === "in_progress") {
			message = "Working on the response...";
		}
		else if (type.startsWith("output_item")) {
			if (item.type === "reasoning") {
				// If we don't do the model more "talkative" during reasoning, we won't get any additional info to display
				message = "Thinking...";
			}
		}
		else if (type.startsWith("web_search_call")) {
			message = "Searching the web...";
		}
		else if (type === "output_text.delta") {
			message = "Streaming the response...";
		}
		else if (type === "error") {
			message = `An error occurred: ${chunk.message}`;
		}

		return message;
	}
}

LLMTask.register(OpenAI);
