import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import Task from "qualve/task";
import { ProgressIndicator, addFilenameSuffix } from "qualve/util";
import { handleStream, dedent } from "./util.js";
import * as prompts from "./prompts.js";
import LLMFile from "./file.js";
import options from "qualve/options";

Object.assign(options, {
	// Options specific to LLM tasks
	llm: {},
	model: {},
	thinking: {},
});

export { LLMFile };

export default class LLMTask extends Task {
	static File = LLMFile;

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
	 * Select and instantiate the right provider subclass based on `task.llm`.
	 * Overrides the base Task.create factory to add provider dispatch.
	 */
	static create (task, ...args) {
		let id = task.llm ?? "gemini";
		let Provider = LLMTask.#registry.get(id);
		if (!Provider) {
			throw new Error(
				`Unknown LLM provider: "${id}". Available: ${[...LLMTask.#registry.keys()].join(", ")}`,
			);
		}
		return new Provider(task, ...args);
	}

	get capabilities () {
		return this.constructor.capabilities;
	}

	/** Provider display name (e.g., "Gemini"). */
	get name () {
		return this.constructor.name;
	}

	/**
	 * Provider ID string (e.g., "gemini", "claude").
	 * This getter also prevents the Task constructor from overwriting `this.llm`
	 * with the raw string from task config data.
	 */
	get llm () {
		return this.constructor.id;
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

		let text;
		try {
			text = await handleStream({
				...streamParams,
				outputPath: this.output?.[0]?.filePath,
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
