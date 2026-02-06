import fs from "node:fs/promises";
import LLM from "../src/llm.js";
import Anthropic, { toFile } from "@anthropic-ai/sdk";

export default class Claude extends LLM {
	static id = "claude";
	static name = "Claude";
	static models = ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"];

	client = new Anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY,
	});

	async uploadFile (filepath, { mimeType = "application/json", contents } = {}) {
		let { name } = this.getFileInfo(filepath);
		let file = contents ?? (await fs.readFile(filepath));

		return this.client.beta.files.upload(
			{
				// The Claude Files API doesn't support JSON files directly,
				// so to use them in prompts, we upload them with a text/plain MIME type that Claude supports.
				// See https://platform.claude.com/docs/en/build-with-claude/files#file-types-and-content-blocks
				file: await toFile(file, name, { type: "text/plain" }),
			},
			{
				betas: ["files-api-2025-04-14"],
			},
		);
	}

	async getFile (filepath) {
		let { name } = this.getFileInfo(filepath);
		const list = await this.listFiles();
		return list.find(f => f.filename === name);
	}

	async deleteFile (filepath) {
		let { name } = this.getFileInfo(filepath);
		let fileId = await this.getFile(name)?.id;
		if (!fileId) {
			// Not found
			return;
		}
		return this.client.beta.files.delete(fileId, {
			betas: ["files-api-2025-04-14"],
		});
	}

	async listFiles () {
		const meta = [];

		for await (const file of this.client.beta.files.list({
			betas: ["files-api-2025-04-14"],
		})) {
			meta.push(file);
		}

		return meta;
	}

	async createStream ({ system, task, responseSchema, files = {} }) {
		// Claude API doesn't allow extra properties in the schema root.
		// It throws an "invalid_request_error" error (output_format.description: Extra inputs are not permitted)
		delete responseSchema.description;

		const stream = this.client.beta.messages.stream({
			model: this.model,
			max_tokens: 64000, // maximum for claude-sonnet-4-5
			betas: ["structured-outputs-2025-11-13", "files-api-2025-04-14"],
			system: system?.join("\n"),
			messages: [
				{
					role: "user",
					content: [
						...task.map(t => ({ type: "text", text: t })),
						{
							type: "text",
							text: "Document 1: codebook.json (use only for code definitions).",
						},
						{
							type: "document",
							context:
								"Codebook for deductive coding. Use only for code definitions.",
							source: {
								type: "file",
								file_id: files.codebook.id,
							},
						},
						{ type: "text", text: "Document 2: answers.json (the responses to code)." },
						{
							type: "document",
							context: "Survey responses to be deductively coded using the codebook.",
							source: {
								type: "file",
								file_id: files.answers.id,
							},
						},
					],
				},
			],
			output_format: responseSchema,
		});

		return {
			stream,
			transformChunk: chunk =>
				chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta"
					? chunk.delta.text
					: "",
		};
	}
}
