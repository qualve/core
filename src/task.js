import {
	formatDuration,
	formatSize,
	addFilenameSuffix,
	mapAsync,
	toArray,
	importCwd,
	camelToKebab,
} from "./util.js";
import File from "./file.js";
import { ProgressIndicator } from "./util.js";
import Config from "./config.js";
import {
	assembleOptions,
	resolveOptions,
	matchPositionals,
	findValue,
	mergeSchemas,
} from "./options.js";

export default class Task {
	static File = File;

	constructor (task, { parent = null, info, force, dryRun, config, options: rawOptions } = {}) {
		// Always shallow-copy so we don't mutate imported task definitions when applying overrides
		let baseTask = task instanceof Task ? task.task : task;
		this.task = { ...baseTask };

		this.parent = parent;
		this.config = config ?? this.parent?.config ?? new Config({});
		this.customInfo = info;
		// Inherit the raw option bag from parent so CLI/programmatic flags propagate
		// to subtasks created via fan-out or batch slicing.
		this.rawOptions = rawOptions ?? this.parent?.rawOptions ?? {};

		// Build the task's own option layer (subclass chain + this task's `options`).
		// Match its positional declarations against the leftover `_`. Each task does
		// this against its OWN layer — the config-level layer's positionals were already
		// matched by whoever produced rawOptions (bin/qualve.js or the parent task), so
		// we don't re-match them here.
		let classOptions = getClassChain(this.constructor)
			.map(c => (Object.hasOwn(c, "options") ? c.options : undefined))
			.filter(Boolean);
		// Options this task itself consumes. Used for resolveOptions — predicates
		// (default, present) only run against options the task actually declares.
		let consumedLayer = assembleOptions(...classOptions, this.task.options);
		// Aggregated subtree schema. Used for CLI parse, --help, and positional matching.
		// Subtask-declared options surface here so they parse and inherit through
		// rawOptions, but their predicates aren't evaluated against this parent.
		let subtaskSchemas = {};
		for (let sub of this.task.subtasks ?? []) {
			subtaskSchemas = mergeSchemas(subtaskSchemas, Task.aggregateSchema(sub));
		}
		let aggregatedLayer = assembleOptions(subtaskSchemas, consumedLayer);

		let { _: positionals = [], ...flagsBag } = this.rawOptions;
		this.rawOptions = matchPositionals(
			{ flags: flagsBag, _: positionals },
			aggregatedLayer,
		).flags;

		// Public schemas: aggregated for --help / introspection, consumed for resolution.
		// optionsSchema keeps config options (e.g. --tasks) so they parse and show in help;
		// consumedSchema excludes them — Config already resolved them, tasks don't re-resolve.
		this.optionsSchema = assembleOptions(this.config.availableOptions, aggregatedLayer);
		this.consumedSchema = assembleOptions(this.config.taskOptions, consumedLayer);

		// Resolve only against what this task consumes. Subtask-only options stay
		// in rawOptions and propagate down via the unknown-options escape hatch
		// (and via the rawOptions forwarding in createSubtask).
		let { resolved, claimed } = resolveOptions(this.consumedSchema, this.rawOptions, this.task);

		Object.assign(this, resolved);

		// Framework controls: explicit args take precedence; parent inheritance fills gaps.
		// (resolution may have set defaults like force=false; explicit set wins.)
		this.force = force ?? this.force ?? this.parent?.force ?? false;
		this.dryRun = dryRun ?? this.parent?.dryRun ?? false;

		// Unclaimed keys both apply as task-field overrides (preserving today's escape-hatch
		// behavior so --prompt='...' still mutates task.prompt even if undeclared) and
		// surface in this.unknownOptions for discoverability.
		let unknownOptions = {};
		for (let key in this.rawOptions) {
			if (claimed.has(key) || this.rawOptions[key] === undefined) {
				continue;
			}
			// Options declared as non-task (cli/root/config) are owned elsewhere — the CLI,
			// the orchestrator, the config — and reachable via this.config. Don't let the
			// escape hatch mistake them for undeclared task fields.
			if (this.optionsSchema[key]?.for && this.optionsSchema[key].for !== "task") {
				continue;
			}
			unknownOptions[key] = this.rawOptions[key];
			this.task[key] = this.rawOptions[key];
		}
		this.unknownOptions = unknownOptions;

		// Copy task-def fields not already set by option resolution
		for (let key in this.task) {
			if (!(key in this)) {
				this[key] = this.task[key];
			}
		}

		normalizeFiles(this);

		this.subtasks = this.task.subtasks?.map(t => this.createSubtask(t));

		let resolvedTaskOptions = Object.fromEntries(
			Object.keys(consumedLayer)
				.filter(k => k in resolved && resolved[k] !== undefined)
				.map(k => [k, resolved[k]]),
		);

		this.debug = {
			title: this.prefix,
			type: this.type ?? "compound",
			...resolvedTaskOptions,
		};

		this.ready = Promise.resolve()
			.then(() => this.initAsync())
			.then(() => this.postInit());
	}

	/**
	 * Read an option that may be a function (deferred) or a scalar.
	 * Use this when a task wants to support either form for the same field —
	 * e.g., `prompt` can be a string or a function returning a string.
	 */
	resolveOption (key) {
		let value = this[key];
		return typeof value === "function" ? value.call(this) : value;
	}

	createSubtask (subtask = this.task, args = {}) {
		// Forward the parent's raw options so dispatch (e.g., LLMTask.create resolving `llm`)
		// sees the same input the parent did. Without this, batch / fan-out subtasks
		// would re-dispatch using only static defaults.
		return Task.create(subtask, { parent: this, options: this.rawOptions, ...args });
	}

	/**
	 * Build one subtask for an option-driven fan-out element. Strips whichever
	 * rawOptions alias carried the driver's value (long, short, kebab, or canonical)
	 * before adding the canonical override, so the subtask doesn't see the parent's
	 * full array under a stale alias key.
	 */
	createFanoutSubtask (driver, value) {
		let [aliasUsed] = findValue(this.rawOptions, driver.key, driver.option);
		let options = { ...this.rawOptions };
		if (aliasUsed !== null) {
			delete options[aliasUsed];
		}
		options[driver.key] = [value];
		return this.createSubtask(this.task, { options });
	}

	/**
	 * Find an option that drives fan-out: declared `multiple: true` (and not
	 * a positional, since `multiple` doubles as rest-args for positionals),
	 * `present: true` for this task (so options that are optional or merely
	 * inherited from a parent don't trigger fan-out on tasks that don't need
	 * them), and resolved to an array of length > 1. Returns
	 * `{ key, option, values }` for the driver, or `undefined` if none qualify.
	 * Throws if more than one qualifies — pick one.
	 */
	findFanoutDriver () {
		let drivers = [];
		// Iterate the consumed schema (what this task itself declares), not the
		// aggregated optionsSchema. A subtask-declared option leaking through the
		// unknown-options escape hatch shouldn't drive fan-out at the parent level —
		// the subtask that owns the option fans out on its own.
		for (let key in this.consumedSchema) {
			let option = this.consumedSchema[key];
			// `multiple: true` doubles as rest-args for positionals — exclude those
			// using the same shape check that matchPositionals does (`=== true` or
			// numeric). Explicit `positional: false` stays a valid driver.
			if (!option.multiple) {
				continue;
			}
			if (option.positional === true || typeof option.positional === "number") {
				continue;
			}
			// `present` runs against the task instance here, not the resolution Proxy
			// used in resolveOptions — by the time we're computing subtasks, the
			// constructor has already assigned all resolved options as own properties,
			// so `this.scope` and friends resolve the same either way for predicates
			// that just read other options.
			let present =
				typeof option.present === "function" ? option.present.call(this) : option.present;
			if (present !== true) {
				continue;
			}
			let value = this[key];
			if (Array.isArray(value) && value.length > 1) {
				drivers.push({ key, option, values: value });
			}
		}
		if (drivers.length > 1) {
			let names = drivers.map(d => "--" + (d.option.long ?? camelToKebab(d.key))).join(", ");
			throw new Error(`Ambiguous fan-out: ${names} are all multi-valued — specify one.`);
		}
		return drivers[0];
	}

	info (message) {
		if (this.progressIndicator) {
			this.progressIndicator.status = message;
		}
		else {
			message = "\t".repeat(this.level) + message;
			(this.customInfo ?? console.info)(message);
		}
	}

	/** Like info(), but for advisories that must persist rather than update the progress line. */
	warn (message) {
		message = "\t".repeat(this.level) + message;
		(this.customWarn ?? console.warn)(message);
	}

	get level () {
		return this.parent ? this.parent.level + 1 : 0;
	}

	get prefix () {
		return this.title ?? this.id;
	}

	/** Whether this task splits its input into batches (i.e. `itemsPerPage > 0`). */
	get batched () {
		return this.itemsPerPage > 0;
	}

	/**
	 * The effective list of child tasks for this run, regardless of source
	 * (explicit subtasks, option-driven fan-out, or batch pagination).
	 * Memoized on first access — subsequent reads return the cached array.
	 * Empty array for leaf tasks.
	 */
	get computedSubtasks () {
		let value;

		// Generic option-driven fan-out: any option declared `multiple: true`
		// whose resolved value is an array > 1 replicates the task per element.
		// It takes precedence over batching: each replica resolves and batches its
		// own input; batching first would slice the input of only the first
		// value's context, then re-fan out per slice. Explicit subtasks still win.
		// Strip whichever alias carried the driver value out of rawOptions before
		// adding the canonical override — otherwise the subtask sees both the
		// alias (with the parent's full array) and the canonical (with its slice).
		let driver = !this.subtasks && this.findFanoutDriver();

		if (driver) {
			value = driver.values.map(v => this.createFanoutSubtask(driver, v));
		}
		else if (this.batched) {
			value = this.createBatchSubtasks();
		}
		else {
			value = this.subtasks ?? [];
		}

		if (value.length > 0) {
			this.debug.subtasks = value.map(t => t.debug);
		}

		Object.defineProperty(this, "computedSubtasks", { value });
		return value;
	}

	/**
	 * If true, abort remaining subtasks when the first one fails.
	 * Defaults to true for batch tasks (fail-fast on config/auth issues).
	 */
	get failFast () {
		return this.task.failFast ?? this.batched;
	}

	/**
	 * Maximum number of subtasks to run concurrently.
	 * Task definitions can override this to cap parallelism (e.g. `concurrency: 3`).
	 * Defaults to `Infinity` (fully parallel).
	 */
	get concurrency () {
		return this.task.concurrency ?? Infinity;
	}

	getMessage (args = {}) {
		if (typeof args === "string") {
			return this.prefix + args;
		}

		let { outputs, sizeUnit, error, startTime } = args;
		let message = [
			error ? "failed after" : "completed in",
			formatDuration(performance.now() - startTime),
		];

		if (outputs?.length > 0) {
			message.push("and wrote");

			let total = outputs.reduce((total, output) => total + (output.size ?? 0), 0);
			total = sizeUnit ? `${total} ${sizeUnit}` : formatSize(total);

			if (outputs.length === 1) {
				message.push(total, `to ${outputs[0].outputPath}`);
			}
			else {
				let detail = outputs
					.map(
						output =>
							`${output.outputPath}: ${sizeUnit ? `${output.size} ${sizeUnit}` : formatSize(output.size)}`,
					)
					.join(", ");
				message.push(total, `to ${outputs.length} files (${detail})`);
			}
		}

		return this.prefix + " " + message.join(" ");
	}

	async initAsync () {}

	/**
	 * Base name for files that don't specify one: the first input's name,
	 * falling back to the task id. || rather than ?? so empty names and
	 * cyclic input chains (File's reentrancy guard returns undefined) fall
	 * through to the id too.
	 */
	get baseName () {
		return this.input?.[0]?.name || this.id;
	}

	async postInit () {
		let { File } = this.constructor;

		this.input = this.resolveOption("input");
		if (this.input) {
			this.input = toArray(this.input)
				// Function-valued entries resolve with task context, like whole-input
				// functions: nullish drops the entry, an array splices in place.
				.flatMap(input => {
					let resolved = typeof input === "function" ? input.call(this) : input;
					return resolved ? toArray(resolved) : [];
				})
				.map(input => File.get(input, this))
				.filter(f => !f.optional || f.glob || f.exists());
			this.debug.input = this.input.map(f => f.debug);
		}

		// Dynamic output (function) stays as-is until resolved in run() after runTask.
		if (this.output && typeof this.output !== "function") {
			this.output = toArray(this.output).map(output => File.get(output, this));
			this.debug.output = this.output.map(f => f.debug);
		}
	}

	/**
	 * Unified orchestration for any multiple-subtask run: progress tree, fail-fast,
	 * per-subtask error isolation, bounded concurrency, and optional output merging.
	 * Reads from `this.computedSubtasks`.
	 */
	async runSubtasks () {
		let { computedSubtasks } = this;

		if (computedSubtasks.length === 0) {
			return [];
		}

		let taskCount = computedSubtasks.length;

		let succeeded = 0,
			skipped = 0,
			failed = 0;

		// Only called from inside runOne, which is always awaited before the finally block
		// nulls out this.progressIndicator, so the indicator is guaranteed to still be set here.
		let updateStatus = () => {
			let parts = [`${succeeded}/${taskCount} done`];
			if (skipped > 0) {
				parts.push(`${skipped} skipped`);
			}
			if (failed > 0) {
				parts.push(`${failed} failed`);
			}
			this.progressIndicator.status = `${this.prefix}: ${parts.join(", ")}`;
		};

		let batchInfo = this.batched ? ` (${taskCount} × ${this.itemsPerPage})` : "";
		// If this task already has a progress indicator (assigned by a parent's runSubtasks),
		// reuse it so grandchildren nest into the existing tree instead of creating a competing root.
		let nested = !!this.progressIndicator;
		if (!nested) {
			this.progressIndicator = new ProgressIndicator();
		}
		this.progressIndicator.status = `${this.prefix}${batchInfo}: 0/${taskCount} done`;
		computedSubtasks.forEach((t, i) => {
			t.progressIndicator = this.progressIndicator.addChild({
				prefix: `[${i + 1}/${taskCount}]`,
				status: "Pending...",
			});
		});

		let runOne = async t => {
			try {
				t.result = await t.run();
				if (t.skipped) {
					skipped++;
				}
				else {
					succeeded++;
				}
			}
			catch (e) {
				t.error = e;
				t.progressIndicator.status = `Failed — ${e.message}`;
				failed++;
			}
			updateStatus();
		};

		try {
			// Batch tasks always run the first subtask alone: it uploads all inputs
			// (shared + its slice) fresh, so subsequent subtasks find shared inputs
			// already on the provider. Without this, concurrent subtasks would race
			// to upload the same shared files.
			// failFast independently controls whether a first-subtask failure aborts the rest.
			if (this.failFast || this.batched) {
				let [first, ...rest] = computedSubtasks;
				await runOne(first);

				if (rest.length > 0 && (!this.failFast || !first.error)) {
					await mapAsync(rest, runOne, { concurrency: this.concurrency });
				}
			}
			else {
				await mapAsync(computedSubtasks, runOne, { concurrency: this.concurrency });
			}
		}
		finally {
			if (nested) {
				// Nested: remove grandchildren so the parent tree returns to showing only its direct children.
				// Keep this.progressIndicator so subsequent this.info() calls route through the parent tree.
				this.progressIndicator.clearChildren();
			}
			else {
				this.progressIndicator?.stop();
				this.progressIndicator = null;
			}
		}

		if (computedSubtasks.some(t => t.output?.some?.(output => output.temporary))) {
			return this.mergeSubtaskOutputs(computedSubtasks);
		}

		// No merge: re-surface any subtask errors so they don't disappear silently.
		let errors = computedSubtasks.filter(t => t.error);
		if (errors.length > 0) {
			throw new AggregateError(
				errors.map(
					t =>
						new Error(`${t.output?.[0]?.filePath ?? t.prefix}: ${t.error.message}`, {
							cause: t.error,
						}),
				),
				`${errors.length} subtask(s) failed`,
			);
		}

		return computedSubtasks.map(t => t.result);
	}

	async run () {
		await this.ready;

		let startTime = performance.now();
		let result;

		// Skip if all output files already exist on disk (from a prior run).
		// Dynamic output (function) can never be skipped — files aren't known yet.
		if (
			!this.force &&
			typeof this.output !== "function" &&
			this.output?.length > 0 &&
			this.output.every(output => output.exists())
		) {
			this.skipped = true;
			this.debug.skipped = true;

			if (this.dryRun) {
				return this.debug;
			}
			else if (this.progressIndicator) {
				this.progressIndicator.status = "Skipped — output exists";
			}
			else {
				let paths = this.output.map(output => output.path).join(", ");
				this.info(
					this.prefix + ` skipped (output already exists: ${paths}). Use -f to force.`,
				);
			}

			return;
		}

		let { computedSubtasks } = this;

		if (computedSubtasks.length > 0) {
			if (this.dryRun) {
				// Subtask debug objects are already linked via computedSubtasks;
				// just run each subtask so they populate their own debug
				await Promise.all(computedSubtasks.map(t => t.run()));
				return this.debug;
			}

			this.info(this.getMessage("..."));

			result = await this.runSubtasks();

			let messageArgs = result?.error ? { ...result, startTime } : { startTime };
			let message = this.getMessage(messageArgs);
			if (result?.error) {
				throw new Error(message, { cause: result.error });
			}
			this.info(message);
		}
		else {
			result = await this.runTask();

			if (this.dryRun) {
				return this.debug;
			}

			// Resolve dynamic output using the computed result, binding `this` to the Task
			// so the function can read task state (entity, input files, etc.).
			if (result && typeof this.output === "function") {
				let { File } = this.constructor;
				this.output = toArray(this.output.call(this, result.result)).map(output =>
					File.get(output, this));
				this.debug.output = this.output.map(f => f.debug);
			}

			// Write loop: runs unless runTask already populated `outputs` (e.g. LLM streaming).
			if (result && !result.outputs && this.output?.length > 0) {
				result.outputs = [];
				for (let output of this.output) {
					let data = output.process(result.result);
					if (data === null) {
						// Per-file handleResult may signal "skip this file".
						continue;
					}
					let size = output.write(data);
					result.outputs.push({ outputPath: output.path, size });
				}
			}

			let message = this.getMessage({ ...result, startTime });

			if (result.error) {
				throw new Error(message, { cause: result.error });
			}

			this.info(message);
		}

		// Mirror singular properties when there's exactly one output so existing
		// consumers that read `result.outputPath` / `result.size` continue to work.
		// Applied uniformly to both leaf and subtask-merge results.
		if (result?.outputs?.length === 1) {
			result.outputPath ??= result.outputs[0].outputPath;
			result.size ??= result.outputs[0].size;
		}

		return result;
	}

	async runTask () {
		throw this.notImplemented();
	}

	/**
	 * Create batch subtasks by splitting the batchable input into chunks.
	 * Slice data is kept in memory on the File object and uploaded directly,
	 * avoiding a redundant disk write/read/delete cycle.
	 * @returns {Task[]}
	 */
	createBatchSubtasks () {
		if (toArray(this.output).length > 1 || typeof this.task.output === "function") {
			throw new Error("Batching is not supported with multiple or dynamic outputs.");
		}

		// Find the input to paginate: explicit `paginate` on the file, or auto-detect the single array-schema input.
		// TODO: support multiple paginated inputs.
		let batchableInput = this.input.find(f => f.paginate);

		if (!batchableInput) {
			let inputs = this.input.filter(f => f.schemaType === "array");

			if (inputs.length === 1) {
				batchableInput = inputs[0];
			}
			else if (inputs.length === 0) {
				let names = this.input.map(f => f.name).join(", ");
				throw new Error(
					`itemsPerPage is set but no input has an array schema (inputs: ${names}).`,
				);
			}
			else {
				let names = inputs.map(f => f.name).join(", ");
				throw new Error(
					`Multiple inputs have array schemas (${names}). Set paginate on the file definition to disambiguate.`,
				);
			}
		}

		let rawData = batchableInput.contents;
		// paginate: true (or auto-detected) means top-level array;
		// an array of strings is a property path to a nested array.
		let batchableData = Array.isArray(batchableInput.paginate)
			? batchableInput.paginate.reduce((obj, key) => obj[key], rawData)
			: rawData;
		let batchSize = this.itemsPerPage;

		// Short-circuit: no need to batch if the data fits in a single page
		if (batchableData.length <= batchSize) {
			return [];
		}

		let subtasks = [];

		for (let start = 0; start < batchableData.length; start += batchSize) {
			let end = Math.min(start + batchSize, batchableData.length) - 1;
			let suffix = `-${start}-${end}`;
			let isFirst = start === 0;

			let sliceFilename = addFilenameSuffix(batchableInput.filename, suffix);

			// Batch slice always gets file-level fresh to avoid stale remote data.
			// Shared inputs have no file-level fresh, so they fall back to the task-level fresh below.
			let batchInput = this.input.map(file =>
				file === batchableInput
					? {
							filename: sliceFilename,
							schema: batchableInput.schema,
							description: batchableInput.description,
							contents: batchableData.slice(start, end + 1),
							fresh: true,
						}
					: file);

			let batchOutputFilename = addFilenameSuffix(this.output[0].filename, suffix);

			// First subtask: task-level fresh uploads everything (shared inputs + slice).
			// With fail-fast (default for batch), it runs alone and completes first,
			// so subsequent subtasks find shared inputs already on the provider.
			subtasks.push(
				this.createSubtask({
					...this.task,
					itemsPerPage: undefined, // Prevent re-batching
					fresh: isFirst ? true : undefined,
					input: batchInput,
					output: {
						filename: batchOutputFilename,
						schema: this.output[0].schema,
						temporary: true,
					},
				}),
			);
		}

		return subtasks;
	}

	/**
	 * Merge completed subtask output files into the final result.
	 * If all subtasks completed, writes to the original output path and cleans up any
	 * subtask outputs marked as temporary (e.g. batch slices).
	 * If partial, writes a partial merge with a count-based suffix (e.g., `-3of10`).
	 * @param {Task[]} subtasks
	 * @returns {{ outputPath: string, size: number, sizeUnit: string, error?: Error }}
	 */
	mergeSubtaskOutputs (subtasks) {
		// Batching only supports a single output (enforced by createBatchSubtasks);
		// merging is therefore always into `this.output[0]`.
		let merged = [];
		let completed = [];

		for (let subtask of subtasks) {
			if (subtask.output[0].exists()) {
				merged.push(...toArray(subtask.output[0].contents));
				completed.push(subtask);
			}
		}

		let outputFile = this.output[0];
		let outputPath = outputFile.path;

		if (merged.length === 0) {
			// t.result is assigned by runOne even when undefined; subtasks that were never
			// started (cut off by fail-fast) have neither property set.
			let notRun = subtasks.filter(t => !t.error && t.result === undefined).length;
			let message =
				notRun > 0
					? `First subtask failed; ${notRun} not run (fail-fast) — no outputs to merge`
					: "All subtasks failed — no outputs to merge";
			return {
				outputs: [{ outputPath, size: 0 }],
				sizeUnit: "items",
				error: new AggregateError(
					subtasks
						.filter(t => t.error)
						.map(
							t =>
								new Error(
									`${t.output?.[0]?.filePath ?? t.prefix}: ${t.error.message}`,
									{
										cause: t.error,
									},
								),
						),
					message,
				),
			};
		}

		let allComplete = completed.length === subtasks.length;

		if (!allComplete) {
			// Partial merge writes to a sibling file with a count-based suffix.
			// Remove the stale complete output so it doesn't coexist with the partial one.
			outputFile.delete();
			outputFile = File.get(
				{
					filename: addFilenameSuffix(
						outputFile.filename,
						`-${completed.length}of${subtasks.length}`,
					),
				},
				this,
			);
			outputPath = outputFile.path;
		}

		outputFile.write(merged);

		this.info(
			`Merged ${merged.length} items from ${completed.length}/${subtasks.length} subtasks to ${outputPath}`,
		);

		if (!allComplete) {
			// On partial failure, keep all subtask outputs so a re-run can skip completed ones.
			let incomplete = subtasks.filter(t => !completed.includes(t));
			return {
				outputs: [{ outputPath, size: merged.length }],
				sizeUnit: "items",
				error: new AggregateError(
					incomplete
						.filter(t => t.error)
						.map(
							t =>
								new Error(
									`${t.output?.[0]?.filePath ?? t.prefix}: ${t.error.message}`,
									{
										cause: t.error,
									},
								),
						),
					`${incomplete.length} subtask(s) incomplete. Re-run to retry.`,
				),
			};
		}

		// On full success, clean up any temporary subtask outputs — they're now merged into the final file.
		for (let subtask of completed) {
			if (subtask.output[0].temporary) {
				subtask.output[0].delete();
			}
		}

		return {
			outputs: [{ outputPath, size: merged.length }],
			sizeUnit: "items",
		};
	}

	notImplemented () {
		return new Error("Not implemented in " + this.constructor.name);
	}

	/**
	 * Load a task definition from a source: a file path to import, or an already-loaded
	 * definition object (an inline task) returned as-is. Resolving a query to a path, and
	 * a path to an id, is Config's job — see Config#resolveTask / Config#taskId.
	 * @param {string | object} source A task file path, or a task definition
	 */
	static async load (source) {
		if (typeof source !== "string") {
			return source;
		}

		let module;

		try {
			module = await importCwd(source);
		}
		catch (e) {
			throw new Error(`Task at ${source} is invalid.`, { cause: e });
		}

		if (!module) {
			throw new Error(`Task at ${source} is empty.`);
		}

		return module instanceof Task ? module.task : module;
	}

	/**
	 * Construct a task instance from a resolved source — a task file path to load, or an
	 * inline task definition — under the given config. Applies positional input/output
	 * overrides and dispatches via Task.create; does not run. Resolving a query to a path is
	 * Config's job (see Config#resolveTask) — Task only ever sees paths, never ids.
	 * @param {string | object} source A task file path, or a task definition
	 * @param {{ config: Config }} args
	 */
	static async fromPath (source, { config, ...options } = {}) {
		// Copy the loaded def before stamping its id, so the module cache stays clean.
		let task = { ...(await this.load(source)) };
		if (typeof source === "string") {
			task.id = config.taskId(source);
		}
		normalizeFiles(task);

		// Drop undefined entries so they don't shadow per-task defaults in resolveOptions.
		let rawOptions = {};
		for (let key in options) {
			if (options[key] !== undefined) {
				rawOptions[key] = options[key];
			}
		}

		// Unified positional override for both input and output.
		// Falsy values at a given index skip that position: `-o 0 -o bar` overrides only the second output.
		// This sits outside the option-resolution chain because the value is positionally
		// merged into an array, not assigned wholesale.
		let { input, output, force, dryRun, ...restOptions } = rawOptions;
		for (let [key, override] of Object.entries({ input, output })) {
			if (!override) {
				continue;
			}

			override = toArray(override);
			task[key] ??= [];

			for (let i = 0; i < override.length; i++) {
				if (!override[i]) {
					continue;
				}

				task[key][i] = File.get(File.overrideSource(task[key][i]?.source, override[i]));
			}
		}

		return Task.create(task, { force, dryRun, config, options: restOptions });
	}

	static #registry = new Map();

	/**
	 * Register a task type so Task.create() can dispatch to it by `task.type`.
	 * Reads `SubClass.type` as the registry key.
	 * Each subclass calls this after its own definition to self-register.
	 * @param {typeof Task} SubClass
	 */
	static register (SubClass) {
		Task.#registry.set(SubClass.type, SubClass);
	}

	/**
	 * Union the option schemas declared by a task definition and all its subtasks
	 * (recursively). Used at parse time to make the CLI accept every flag the
	 * task tree might want, and inside the constructor so a compound task's
	 * optionsSchema surfaces its leaves' options.
	 */
	static aggregateSchema (taskDef) {
		let Type = Task.#registry.get(taskDef.type) ?? Task;
		let classOptions = getClassChain(Type)
			.map(c => (Object.hasOwn(c, "options") ? c.options : undefined))
			.filter(Boolean);
		// Aggregate subtasks first (sibling-later wins), then layer this task's own
		// class chain and options on top so the parent's declarations override
		// anything it merely surfaces from its subtree.
		let subtasks = {};
		for (let sub of taskDef.subtasks ?? []) {
			subtasks = mergeSchemas(subtasks, Task.aggregateSchema(sub));
		}
		return assembleOptions(subtasks, ...classOptions, taskDef.options);
	}

	/**
	 * Polymorphic factory: dispatch to the registered subclass for `task.type`.
	 * Subclasses that need a further routing step (e.g., LLMTask resolves `llm` to a
	 * provider) override this to do their own option resolution and call into the
	 * next subclass's create. Each level claims its own options as it routes —
	 * see LLMTask.create in @qualve/ai/core for an example.
	 */
	static create (task, args = {}) {
		let Type = Task.#registry.get(task.type);
		if (!Type) {
			if (task.type) {
				throw new Error(
					`Unknown task type: "${task.type}". Registered types: ${[...Task.#registry.keys()].join(", ") || "(none)"}`,
				);
			}
			return new Task(task, args);
		}
		if (Type.create !== this.create) {
			return Type.create(task, args);
		}
		return new Type(task, args);
	}
}

/**
 * Walk a class's prototype chain returning [Task, ...subclasses, leaf].
 * Used inside the constructor to assemble the chain's `static options`
 * without re-running dispatch logic.
 */
function getClassChain (SubClass) {
	let chain = [];
	let cls = SubClass;
	while (cls && cls !== Function.prototype && cls.name) {
		chain.unshift(cls);
		cls = Object.getPrototypeOf(cls);
	}
	return chain;
}

function normalizeFiles (task) {
	let context = task instanceof Task ? task : undefined;
	let { File } = context?.constructor ?? Task;

	// Dynamic input (function) is resolved later, not at normalization time.
	// Same for function-valued entries — they need task context (postInit).
	if (task.input && typeof task.input !== "function") {
		task.input = toArray(task.input).map(file =>
			typeof file === "function" ? file : File.get(file, context));
	}

	// Dynamic output (function) is resolved later, not at normalization time.
	if (task.output && typeof task.output !== "function") {
		task.output = toArray(task.output).map(file => File.get(file, context));
	}
}
