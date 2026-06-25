import LLMTask from "@qualve/llm";
import Anthropic from "@anthropic-ai/sdk";
import ClaudeFile from "./file.js";

export default class Claude extends LLMTask {
	static id = "claude";
	static name = "Claude";
	static File = ClaudeFile;
	static models = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];
	static capabilities = {
		inputDescriptions: true,
		outputSchema: true,
	};

	client = new Anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY,
		timeout: 30 * 60_000, // 30 minutes — LLM tasks with thinking can be very slow
	});

	async listFiles () {
		const meta = [];

		for await (const file of this.client.beta.files.list()) {
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
							context: f.describe(),
							source: {
								type: "text",
								media_type: "text/plain",
								data: f.toString(),
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
		const stream = this.client.beta.messages.stream({
			model: this.model,
			max_tokens: 64000, // maximum for claude-sonnet-4-6 and claude-haiku-4-5; claude-opus-4-8 supports up to 128K
			// Required by the API to accept `file_id` document sources;
			// the SDK auto-adds it for `client.beta.files.*` but not for messages.
			betas: ["files-api-2025-04-14"],
			system: system?.join("\n"),
			messages: [
				{
					role: "user",
					content: [
						...prompt.map(t => ({ type: "text", text: t })),
						...input.map(f => ({
							type: "document",
							context: f.describe(),
							source: {
								type: "file",
								file_id: f.remoteFile.id,
							},
						})),
					],
				},
			],
			output_config: output?.schema ? { format: output.schema } : undefined,
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

LLMTask.register(Claude);
