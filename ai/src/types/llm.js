import * as path from "node:path";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import Task from "./task.js";
import {
	handleStream,
	ProgressIndicator,
	addFilenameSuffix,
	readJSONSync,
	dedent,
} from "../util.js";
import { truncatedIds } from "../question.js";
import { inputFiles, outputFile } from "../../tasks/_prompts-common.js";

export default class LLMTask extends Task {
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

	static capabilities = {};

	/**
	 * Provider subclasses, keyed by ID. Populated by src/task.js at startup
	 * to avoid a circular import (src/types/llm.js → src/llms/ → src/types/llm.js).
	 * @type {Record<string, typeof LLMTask>}
	 */
	static providers = {};

	/**
	 * Select and instantiate the right provider subclass based on `task.llm`.
	 * Overrides the base Task.create factory to add provider dispatch.
	 */
	static create (task, ...args) {
		let id = task.llm ?? "gemini";
		let Provider = LLMTask.providers[id];
		if (!Provider) {
			throw new Error(
				`Unknown LLM provider: "${id}". Available: ${Object.keys(LLMTask.providers).join(", ")}`,
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
	}

	/**
	 * Read a file if no contents are provided and prepare it for upload.
	 * Mainly intended to be used internally.
	 * @protected
	 * @param {string} filepath
	 * @param {object} [options]
	 * @param {string} [options.mimeType="application/json"] - The MIME type of the file.
	 * @param {string|object|Array} [options.contents] - The file contents to upload. Reads filepath if not provided.
	 */
	readFile (filepath, options = {}) {
		options.mimeType ??= "application/json";
		let isJSON = options.mimeType === "application/json";
		options.contents ??= isJSON ? readJSONSync(filepath) : readFileSync(filepath);

		if (isJSON && typeof options.contents !== "string") {
			options.contents = JSON.stringify(options.contents, (k, v) => v ?? undefined);
		}

		return options;
	}

	/**
	 * Read a file, prepare its contents, and upload it to the provider.
	 * For JSON files, this minifies the data and strips nulls to reduce token usage.
	 * @param {string} filepath
	 * @param {object} [options]
	 * @param {string} [options.mimeType="application/json"] - The MIME type of the file.
	 * @param {string|object|Array} [options.contents] - The file contents to upload. Reads filepath if not provided.
	 */
	sendData (filepath, options = {}) {
		options = this.readFile(filepath, options);
		return this.uploadFile(filepath, options);
	}

	/**
	 * Resolve a local filepath to a stable remote filename, namespaced by question.
	 * @param {string} filepath
	 * @returns {{ name: string, dirName: string }}
	 */
	getFileInfo (filepath) {
		let dirName = path.basename(path.dirname(filepath));
		let prefix = truncatedIds[dirName];
		let name = path.basename(filepath);

		// Make sure the filename is unique per question by prefixing it with the truncated parent directory name.
		// For other files (e.g., questions, merged codebooks), no prefix is needed since they are already unique and shared across questions.
		name = (prefix ? prefix + "-" : "") + name;
		return { name, dirName };
	}

	/**
	 * Ensure a file is available on the provider, uploading it if necessary.
	 * Freshness is determined by the file-level `fresh` option, falling back to the task-level `this.fresh`.
	 * @param {string} filepath
	 * @param {object} [options]
	 * @param {string|object|Array} [options.contents] - In-memory file contents. Skips disk read when provided.
	 * @param {boolean} [options.fresh] - Force re-upload for this specific file.
	 */
	async getRemoteFile (filepath, options = {}) {
		let fresh = options.fresh ?? this.fresh;

		if (fresh) {
			this.info(`Removing previously uploaded file ${filepath} ...`);
			await this.deleteFile(filepath);
		}

		let ret = !fresh ? await this.getFile(filepath) : null;
		if (!ret) {
			this.info(`Uploading ${filepath} ...`);
			ret = await this.sendData(filepath, options);
		}

		this.info(`Source file ${filepath} ready`);
		return ret;
	}

	/**
	 * Ensure all input files are available on the provider, populating `entry.remoteFile`.
	 * @param {Array} input
	 */
	async getRemoteFiles (input) {
		await Promise.all(
			input.map(async entry => {
				entry.remoteFile ??= await this.getRemoteFile(entry.filePath, {
					contents: entry.contents,
					fresh: entry.fresh,
				});
			}),
		);
	}

	// Abstract — subclasses must override

	/**
	 * Low-level: upload data to the provider.
	 * Use {@link sendData} for most things instead.
	 * @protected
	 * @param {string} filepath
	 * @param {object} options
	 * @param {string} options.contents - The file contents to upload.
	 * @param {string} options.mimeType - The MIME type of the file.
	 */
	uploadFile (filepath, options) {
		throw this.notImplemented();
	}

	/** Retrieve a previously uploaded file from the provider, or null if not found. */
	getFile (filepath) {
		throw this.notImplemented();
	}

	/** Delete a previously uploaded file from the provider. */
	deleteFile (filepath) {
		throw this.notImplemented();
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
	 * Normalize a prompts value to a flat array of strings.
	 * Accepts a string, array, or function (called with the current question).
	 */
	normalizePrompts (prompts) {
		if (!prompts) {
			return [];
		}

		if (typeof prompts === "function") {
			prompts = prompts.call(this, this.question);
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
			this.prompt.push(inputFiles.call(this, this.input));
		}

		if (this.output) {
			this.prompt.push(outputFile.call(this, this.output));
		}
	}

	async debugInfo () {
		const [base, tokens] = await Promise.all([
			super.debugInfo(),
			this.batched ? undefined : this.countTokens(),
		]);

		return {
			...base,
			llm: this.name,
			model: this.model,
			...(this.thinking !== undefined && { thinking: this.thinking }),
			...(this.batched && { itemsPerPage: this.itemsPerPage }),
			system: this.system,
			prompt: this.prompt,
			...(tokens != undefined && { tokens }),
		};
	}

	async runTask () {
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
				outputPath: this.output?.filePath,
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

		let outputPath = this.output?.filePath;

		if (outputPath && error) {
			outputPath = addFilenameSuffix(outputPath, ".tmp");
		}

		return {
			outputPath,
			size: chunksReceived,
			sizeUnit: "chunk",
			error,
			result: text,
		};
	}
}
