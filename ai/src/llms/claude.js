import LLM from "../llm.js";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { inputFile } from "../../tasks/_prompts-common.js";

export default class Claude extends LLM {
	static id = "claude";
	static name = "Claude";
	static models = ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"];
	static capabilities = {
		inputDescriptions: true,
		outputSchema: true,
	};

	client = new Anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY,
		timeout: 30 * 60_000, // 30 minutes — LLM tasks with thinking can be very slow
	});

	async uploadFile (filepath, { mimeType, contents }) {
		let { name } = this.getFileInfo(filepath);

		return this.client.beta.files.upload(
			{
				// The Claude Files API doesn't support JSON files directly,
				// so to use them in prompts, we upload them with a text/plain MIME type that Claude supports.
				// See https://platform.claude.com/docs/en/build-with-claude/files#file-types-and-content-blocks
				file: await toFile(new Blob([contents], { type: mimeType }), name, {
					type: "text/plain",
				}),
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
		let fileId = await this.getFile(filepath)?.id;
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

	async countTokens (task) {
		let { system, prompt, input = [] } = task;
		let result = await this.client.messages.countTokens({
			model: this.model,
			system: system?.join("\n"),
			messages: [
				{
					role: "user",
					content: [
						...prompt.map(t => ({ type: "text", text: t })),
						...input.map(f => ({
							type: "document",
							context: inputFile.call(task, f),
							source: {
								type: "text",
								media_type: "text/plain",
								data: this.readFile(f.filePath)?.contents ?? "",
							},
						})),
					],
				},
			],
		});

		return result.input_tokens;
	}

	async createStream (task) {
		let { system, prompt, output, input = [] } = task;
		let responseSchema = output?.schema;
		let output_format = responseSchema
			? {
					type: "json_schema",
					schema: responseSchema.schema,
				}
			: undefined;
		const stream = this.client.beta.messages.stream({
			model: this.model,
			max_tokens: 64000, // maximum for claude-sonnet-4-5
			betas: ["structured-outputs-2025-11-13", "files-api-2025-04-14"],
			system: system?.join("\n"),
			messages: [
				{
					role: "user",
					content: [
						...prompt.map(t => ({ type: "text", text: t })),
						...input.map(f => ({
							type: "document",
							context: inputFile.call(task, f),
							source: {
								type: "file",
								file_id: f.remoteFile.id,
							},
						})),
					],
				},
			],
			// Claude API doesn't allow extra properties in the schema root.
			// It throws an "invalid_request_error" error (output_format.description: Extra inputs are not permitted)
			output_format,
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
