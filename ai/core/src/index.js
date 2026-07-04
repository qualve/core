import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import Task from "qualve/task";
import { ProgressIndicator, addFilenameSuffix } from "qualve/util";
import { resolveOptions } from "qualve/options";
import { handleStream, dedent } from "./util.js";
import * as prompts from "./prompts.js";
import LLMFile from "./file.js";

export { LLMFile };

export default class LLMTask extends Task {
	static File = LLMFile;

	/**
	 * Declared options for any LLM task. The chain in src/options.js merges these with
	 * L1 (global), L2 (config), and L4 (task instance options) at construction time.
	 * Declaring `prompt` and `system` here means a CLI flag like `--prompt='...'`
	 * routes through the standard chain and lands on `this.prompt` instead of the
	 * unknownOptions bag.
	 */
	static options = {
		llm: {
			default: "gemini",
			description: "LLM provider (gemini, claude, openai, …)",
		},
		model: {
			description: "Model name (provider-specific)",
		},
		thinking: {
			description:
				"Thinking level: none, minimal, low, medium, high, xhigh (provider remaps unsupported levels)",
		},
		prompt: {
			short: "p",
			description: "Prompt content (string, array, or function)",
		},
		system: {
			description: "System prompt (string, array, or function)",
		},
	};

	// Subclass must define these
	client = null;

	/**
	 * Normalized stop reason vocabulary, consistent across all providers.
	 * Each provider subclass maps its own provider-specific stop states to these values.
	 *
	 * - `COMPLETE` — The model finished generating its full response.
	 * - `MAX_TOKENS` — The response was truncated because it hit the output token limit.
	 * - `ABORTED` — The provider refused to produce output (safety, policy, PII, etc.).
	 * - `UNKNOWN` — The provider returned a stop state we don't have a mapping for.
	 * @enum {string}
	 */
	static stopReasons = {
		COMPLETE: "complete",
		MAX_TOKENS: "max_tokens",
		ABORTED: "aborted",
		UNKNOWN: "unknown",
	};

	/**
	 * Canonical ordered list of all thinking levels across all providers.
	 * Subclasses use {@link levelMap} to remap levels they don't natively support.
	 */
	static thinkingLevels = ["none", "minimal", "low", "medium", "high", "xhigh"];

	static type = "llm";
	static capabilities = {};

	static #registry = new Map();

	/**
	 * Register an LLM provider so LLMTask.create() can dispatch to it by `task.llm`.
	 * Reads `SubClass.id` as the registry key.
	 * Each provider calls this after its own definition to self-register.
	 * @param {typeof LLMTask} SubClass
	 */
	static register (SubClass) {
		LLMTask.#registry.set(SubClass.id, SubClass);
	}

	/**
	 * Resolve LLMTask's own options (llm, model, thinking, prompt, system) against the
	 * input bag, then route to the provider class for the resolved `llm`. The provider's
	 * constructor will see those resolved values via the standard task-field/default flow.
	 */
	static create (task, args = {}) {
		let { resolved } = resolveOptions(LLMTask.options, args.options ?? {}, task);
		let Provider = LLMTask.#registry.get(resolved.llm);
		if (!Provider) {
			throw new Error(
				`Unknown LLM provider: "${resolved.llm}". Available: ${[...LLMTask.#registry.keys()].join(", ")}`,
			);
		}
		return new Provider(task, args);
	}

	get capabilities () {
		return this.constructor.capabilities;
	}

	/** Provider display name (e.g., "Gemini"). */
	get name () {
		return this.constructor.name;
	}

	/**
	 * LLM tasks default to sequential for question expansion and bounded for batch,
	 * to avoid overwhelming the provider API.
	 * Task definitions can override this by setting `concurrency` explicitly.
	 */
	get concurrency () {
		return this.task.concurrency ?? (this.batched ? 5 : 1);
	}

	constructor (task, args) {
		super(task, args);

		if (existsSync(".env")) {
			loadEnvFile(".env");
		}

		// Default to the first model in the provider's list, also falling back
		// if the task's hardcoded model isn't supported by this provider (e.g., when switching providers via --llm).
		if (!this.constructor.models.includes(this.model)) {
			this.model = this.constructor.models[0];
		}

		// Normalize thinking level for this provider, or unset it if not supported.
		if (
			this.constructor.capabilities.thinkingLevel &&
			LLMTask.thinkingLevels.includes(this.thinking)
		) {
			this.thinking = this.constructor.levelMap?.[this.thinking] ?? this.thinking;
		}
		else {
			this.thinking = undefined;
		}

		Object.assign(this.debug, {
			llm: this.name,
			model: this.model,
			...(this.thinking && { thinking: this.thinking }),
			...(this.itemsPerPage && { itemsPerPage: this.itemsPerPage }),
		});
	}

	/**
	 * Ensure all input files are available on the provider.
	 * Resolves async contents, then uploads each file idempotently.
	 * @param {LLMFile[]} input
	 */
	async getRemoteFiles (input) {
		await Promise.all(
			input.map(async f => {
				let c = f.contents;
				if (c?.then) {
					await c;
				}
				await f.upload();
			}),
		);
	}

	/** List all files currently uploaded to the provider. */
	listFiles () {
		throw this.notImplemented();
	}

	/** Create the streaming API call for this task. Returns stream + handler callbacks. */
	createStream () {
		throw this.notImplemented();
	}

	// To be overridden

	/** Extract a human-readable status message from a streaming chunk. */
	getStatus (chunk) {}

	/** Count the total input tokens for this task. Returns undefined if unsupported. */
	async countTokens () {}

	/**
	 * Describe all input files for inclusion in the prompt.
	 * Defined as a method so subclasses can override without separate imports.
	 */
	inputFiles (files) {
		return prompts.inputFiles(files);
	}

	/**
	 * Normalize a prompts value to a flat array of strings.
	 * Accepts a string, array, or function (called with the current entity).
	 */
	normalizePrompts (prompts) {
		if (!prompts) {
			return [];
		}

		if (typeof prompts === "function") {
			prompts = prompts.call(this, this.entity);
		}

		// Do not convert to else if, function may return a string or an array
		if (typeof prompts === "string") {
			prompts = dedent(prompts);
		}
		else if (Array.isArray(prompts)) {
			return prompts.flatMap(prompt => this.normalizePrompts(prompt));
		}

		return [prompts];
	}

	async postInit () {
		await super.postInit();

		this.system = this.normalizePrompts(this.system);
		this.prompt = this.normalizePrompts(this.prompt);

		const capabilities = this.capabilities;

		if (
			this.input?.length > 0 &&
			!capabilities.inputSchema &&
			!capabilities.inputDescriptions
		) {
			// Incorporate file descriptions and schemas into the prompt
			this.prompt.push(this.inputFiles(this.input));
		}

		if (this.output?.length > 0) {
			for (let file of this.output) {
				this.prompt.push(file.describe({ role: "output" }));
			}
		}

		Object.assign(this.debug, { system: this.system, prompt: this.prompt });
	}

	async runTask () {
		if (this.dryRun) {
			if (!this.batched) {
				this.debug.tokens = await this.countTokens();
			}

			return;
		}

		if (this.input) {
			await this.getRemoteFiles(this.input);
		}

		// If no progress indicator exists (standalone task, not part of a multiple run),
		// install one so chunk status gets logUpdate-based in-place display.
		// Subtasks in a multiple run already have an indicator (child of the coordinator's).
		let ownedIndicator = !this.progressIndicator;
		if (ownedIndicator) {
			this.progressIndicator = new ProgressIndicator({
				status: `${this.title} with ${this.name}...`,
			});
		}

		const streamParams = await this.createStream();
		let chunksReceived = 0;

		// Streaming targets a single file (NOTE: multi-output is unsupported here — only
		// output[0] streams). Reshape the streamed result before it lands: the provider's
		// system-level transform first (e.g. unwrapping a response envelope), then the
		// consumer's handleResult. Left undefined when neither applies so handleStream
		// keeps its cheap rename path.
		let output = this.output?.[0];
		let providerTransform = streamParams.transformResult;
		let transformResult;
		if (providerTransform || output?.handleResult) {
			transformResult = result => {
				if (providerTransform) {
					result = providerTransform(result);
				}
				if (output?.handleResult) {
					result = output.process(result);
				}
				return result;
			};
		}

		let text;
		try {
			text = await handleStream({
				...streamParams,
				outputPath: output?.filePath,
				transformResult,
				onChunk: chunk => {
					chunksReceived++;
					let status = this.getStatus(chunk);
					status = status
						? `Chunk ${chunksReceived}: ${status}`
						: `${chunksReceived} chunks received...`;
					this.info(status);

					// The explicit onChunk above shadows the one from streamParams, so call it manually.
					streamParams.onChunk?.(chunk);
				},
			});
		}
		catch (e) {
			// var hoists `error` out of the catch block so it's accessible after the finally.
			var error = e;
		}
		finally {
			if (ownedIndicator) {
				this.progressIndicator?.stop();
				this.progressIndicator = null;
			}
		}

		let outputPath = this.output?.[0]?.filePath;

		if (outputPath && error) {
			outputPath = addFilenameSuffix(outputPath, ".tmp");
		}

		return {
			...(outputPath && { outputs: [{ outputPath, size: chunksReceived }] }),
			sizeUnit: "chunk",
			error,
			result: text,
		};
	}
}

Task.register(LLMTask);
