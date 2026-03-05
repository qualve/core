import OpenAIClient from "openai";
import LLMTask from "../types/llm.js";

export default class OpenAI extends LLMTask {
	static models = ["gpt-5.2", "gpt-5-mini", "gpt-5-nano"];
	static id = "openai";
	static name = "OpenAI";
	static capabilities = {
		outputSchema: true,
		thinkingLevel: true,
	};

	client = new OpenAIClient({
		apiKey: process.env.OPENAI_API_KEY,
		timeout: 30 * 60_000, // 30 minutes — LLM tasks with thinking can be very slow
	});
	stores = {};

	async getStore (name) {
		if (!name) {
			return null;
		}

		// Store the Promise immediately so concurrent callers awaiting the same name
		// all get the same in-flight Promise rather than racing to create duplicate stores.
		// On failure, clear the cache so the next call can retry instead of replaying the rejection.
		this.stores[name] ??= (async () => {
			for await (const store of await this.client.vectorStores.list()) {
				if (store.name === name) {
					return store;
				}
			}
			return this.client.vectorStores.create({ name });
		})().catch(e => {
			delete this.stores[name];
			throw e;
		});

		return this.stores[name];
	}

	async uploadFile (filepath, { mimeType, contents }) {
		let { name, dirName } = this.getFileInfo(filepath);
		let file = await this.client.files.create({
			file: new File([contents], name, { type: mimeType }),
			purpose: "user_data",
		});

		let store = await this.getStore(dirName);
		await this.client.vectorStores.files.createAndPoll(store.id, { file_id: file.id });
		return { ...file, storeId: store.id };
	}

	async listFiles () {
		const meta = [];
		const list = await this.client.files.list();

		for await (const file of list) {
			meta.push(file);
		}

		return meta;
	}

	async getFile (filepath) {
		let { name } = this.getFileInfo(filepath);
		const list = await this.listFiles();
		return list.find(file => file.filename === name);
	}

	async deleteFile (filepath) {
		const file = await this.getFile(filepath);
		if (!file) {
			return null;
		}
		await this.client.files.delete(file.id);

		let { dirName } = this.getFileInfo(filepath);
		let store = await this.getStore(dirName);
		await this.client.vectorStores.files.delete(file.id, { vector_store_id: store.id });
	}

	async createStream () {
		let { system, prompt, output, input = [] } = this;
		const storeId = input.find(f => f.remoteFile?.storeId)?.remoteFile?.storeId;
		let responseSchema = output?.schema;
		let hasRootObject = output?.schemaType === "object";

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

		const stream = this.client.responses.stream({
			model: this.model,
			background: true, // try to avoid hitting a client-side socket timeout after ~601s (10 minutes)
			store: true,
			reasoning: {
				effort: this.thinking ?? "medium",
			},
			input: [
				...system.map(s => ({ type: "message", role: "system", content: s })),
				...prompt.map(t => ({ type: "message", role: "user", content: t })),
			],
			...(storeId && {
				tools: [
					{
						type: "file_search",
						vector_store_ids: [storeId],
					},
				],
				tool_choice: { type: "file_search" },
			}),
			text: {
				verbosity: "low",
				format: responseSchema,
			},
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
			if (item.type === "file_search_call") {
				message = "Working on the uploaded files...";
			}
			else if (item.type === "reasoning") {
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
