import path from "node:path";
import fs from "node:fs";
import OpenAI from "openai";

async function getVectorStore (client, name) {
	const vectorStores = await client.vectorStores.list();

	// First, let's try to find an existing vector store
	for await (const store of vectorStores) {
		if (store.name === name) {
			return store;
		}
	}

	// If not found, create a new one
	return await client.vectorStores.create({ name });
}

export default {
	id: "openai",
	name: "OpenAI",
	streaming: true,
	filepath: true,
	models: ["gpt-5.2", "gpt-5-mini", "gpt-5-nano"],

	init () {
		this.stores = new Proxy(
			{},
			{
				get: (target, name) => {
					if (name in target) {
						return target[name];
					}

					target[name] ??= getVectorStore(this.client, name).then(
						store => (target[name] = store),
					);
					return target[name];
				},
			},
		);
	},

	getClient: () =>
		new OpenAI({
			apiKey: process.env.OPENAI_API_KEY,
		}),

	async uploadFile (filepath) {
		let file = await this.client.files.create({
			file: fs.createReadStream(filepath),
			purpose: "user_data",
		});
		let dirName = path.basename(path.dirname(filepath));
		file.dirName = dirName;
		let store = await this.stores[dirName];
		await this.client.vectorStores.files.createAndPoll(store.id, { file_id: file.id });
		return file;
	},

	async listFiles () {
		const meta = [];
		const list = await this.client.files.list();

		for await (const file of list) {
			meta.push(file);
		}

		return meta;
	},

	async getFile (name) {
		name = path.basename(name);
		const list = await this.listFiles();
		return list.find(file => file.filename === name);
	},

	async deleteFile (name) {
		const file = await this.getFile(name);
		if (!file) {
			return null;
		}
		await this.client.files.del(file.id);
		let dirName = path.basename(path.dirname(name));
		let store = await this.stores[dirName];
		await this.client.vectorStores.files.del(store.id, file.id);
	},

	async createStream ({ system, task, responseSchema, files = {} }) {
		task = Array.isArray(task) ? task : [task];
		system = Array.isArray(system) ? system : [system];

		const dirName = Object.values(files)[0].dirName;
		const store = await this.stores[dirName];
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
				...task.map(t => ({ type: "message", role: "user", content: t })),
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
	},
};
