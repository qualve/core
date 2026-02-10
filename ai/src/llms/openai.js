import fs from "node:fs";
import OpenAIClient from "openai";
import LLM from "../llm.js";

export default class OpenAI extends LLM {
	static models = ["gpt-5.2", "gpt-5-mini", "gpt-5-nano"];
	static id = "openai";
	static name = "OpenAI";
	static capabilities = {
		outputSchema: true,
	};

	client = new OpenAIClient({
		apiKey: process.env.OPENAI_API_KEY,
	});
	stores = {};

	async getStore (name) {
		if (!name) {
			return null;
		}

		if (!this.stores[name]) {
			const vectorStores = await this.client.vectorStores.list();

			// First, let's try to find an existing vector store
			for await (const store of vectorStores) {
				if (store.name === name) {
					return store;
				}
			}

			// If not found, create a new one
			this.stores[name] = this.client.vectorStores
				.create({ name })
				.then(store => (this.stores[name] = store));
		}

		return this.stores[name];
	}

	async uploadFile (filepath, { mimeType = "application/json", contents } = {}) {
		let { name, dirName } = this.getFileInfo(filepath);
		let file = await this.client.files.create({
			file: contents
				? new File([contents], name, { type: mimeType }).stream()
				: fs.createReadStream(filepath),
			purpose: "user_data",
		});

		let store = await this.getStore(dirName);
		await this.client.vectorStores.files.createAndPoll(store.id, { file_id: file.id });
		return file;
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
		let { name, dirName } = this.getFileInfo(filepath);

		const file = await this.getFile(name);
		if (!file) {
			return null;
		}
		await this.client.files.delete(file.id);

		let store = await this.getStore(dirName);
		await this.client.vectorStores.files.delete(file.id, { vector_store_id: store.id });
	}

	async createStream ({ system, prompt, output, input = [] }) {
		let responseSchema = output?.schema;
		const storeId = input[0]?.remoteFile?.storeId;
		const store = await this.getStore(storeId);
		let hasRootObject = responseSchema?.schema?.type === "object";

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

		const stream = this.client.responses.stream({
			model: this.model,
			background: true, // try to avoid hitting a client-side socket timeout after ~601s (10 minutes)
			store: true,
			reasoning: {
				effort: "medium", // enough for deductive coding
			},
			input: [
				...system.map(s => ({ type: "message", role: "system", content: s })),
				...prompt.map(t => ({ type: "message", role: "user", content: t })),
			],
			tools: [
				{
					type: "file_search",
					vector_store_ids: [store.id],
				},
			],
			tool_choice: { type: "file_search" },
			text: {
				verbosity: "low",
				format: responseSchema,
			},
		});

		return {
			stream,
			transformChunk: chunk =>
				chunk.type === "response.output_text.delta" ? chunk.delta : "",
			transformResult: result => (hasRootObject ? result : result.data),
		};
	}

	async getRemoteFile (filepath) {
		let ret = await super.getRemoteFile(filepath);

		if (ret) {
			let { dirName } = this.getFileInfo(filepath);
			ret.storeId = dirName;
		}

		return ret;
	}
}
