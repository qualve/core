import LLMTask from "../types/llm.js";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { inputFile } from "../../tasks/_prompts-common.js";

export default class Claude extends LLMTask {
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

	async countTokens () {
		let { system, prompt, input = [] } = this;
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
							context: inputFile.call(this, f),
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

	async createStream () {
		let { system, prompt, output, input = [] } = this;
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
							context: inputFile.call(this, f),
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

		let stopReason;
		return {
			stream,
			transformChunk: chunk =>
				chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta"
					? chunk.delta.text
					: "",
			onChunk: chunk => {
				if (chunk.type === "message_delta") {
					stopReason = chunk.delta?.stop_reason;
				}
			},
			onFinish: () => {
				// See https://platform.claude.com/docs/en/agent-sdk/stop-reasons#available-stop-reasons
				if (!stopReason || ["end_turn", "stop_sequence"].includes(stopReason)) {
					return {
						complete: true,
						reason: LLMTask.stopReasons.COMPLETE,
						reasonRaw: stopReason ?? null,
					};
				}

				return {
					complete: false,
					reason:
						stopReason === "max_tokens"
							? LLMTask.stopReasons.MAX_TOKENS
							: LLMTask.stopReasons.UNKNOWN,
					reasonRaw: stopReason,
				};
			},
		};
	}
}
