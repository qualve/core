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
		let { system } = this;
		let content = this.promptContent.map(seg =>
			seg.text !== undefined
				? { type: "text", text: seg.text }
				: {
						type: "document",
						context: seg.file.describe(),
						source: {
							type: "text",
							media_type: "text/plain",
							data: seg.file.toString(),
						},
					});

		let result = await this.client.messages.countTokens({
			model: this.model,
			system: system?.join("\n"),
			messages: [{ role: "user", content }],
		});

		return result.input_tokens;
	}

	/**
	 * Render the ordered prompt content into Anthropic content blocks, attaching a
	 * `cache_control` breakpoint at each reusable-prefix boundary (see LLMTask#promptContent).
	 * The cross-invocation boundary (shared reference input, e.g. a codebook reused across
	 * questions) gets a 1-hour TTL so it survives a full multi-question run; the per-invocation
	 * boundary (prompt, reused across a call's batches) uses the 5-minute default.
	 */
	buildContent () {
		return this.promptContent.map(seg => {
			let block =
				seg.text !== undefined
					? { type: "text", text: seg.text }
					: {
							type: "document",
							context: seg.file.describe(),
							source: { type: "file", file_id: seg.file.remoteFile.id },
						};

			if (seg.cache) {
				block.cache_control =
					seg.cache === "shared"
						? { type: "ephemeral", ttl: "1h" }
						: { type: "ephemeral" };
			}

			return block;
		});
	}

	async createStream () {
		let { system, output } = this;
		let responseSchema = output?.[0]?.schema;
		// Claude API doesn't allow extra properties in the schema root.
		// It throws an "invalid_request_error" error (output_config.format.description: Extra inputs are not permitted)
		let format = responseSchema
			? { type: "json_schema", schema: responseSchema.schema }
			: undefined;
		const stream = this.client.beta.messages.stream({
			model: this.model,
			max_tokens: 64000, // maximum for claude-sonnet-4-6 and claude-haiku-4-5; claude-opus-4-8 supports up to 128K
			// Required by the API to accept `file_id` document sources;
			// the SDK auto-adds it for `client.beta.files.*` but not for messages.
			betas: ["files-api-2025-04-14"],
			system: system?.join("\n"),
			messages: [{ role: "user", content: this.buildContent() }],
			output_config: format ? { format } : undefined,
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
