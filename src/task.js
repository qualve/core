import {
	formatDuration,
	formatSize,
	readDirectorySync,
	readJSONSync,
	writeJSONSync,
	addFilenameSuffix,
	mapAsync,
	toArray,
	importCwd,
} from "./util.js";
import File from "./file.js";
import { existsSync, rmSync } from "node:fs";
import { ProgressIndicator } from "./util.js";
import Config from "./config.js";

export default class Task {
	constructor (task, { parent = null, entityIds, info, force, dryRun, config } = {}) {
		this.task = task instanceof Task ? task.task : task;

		for (let key in task) {
			if (!(key in this)) {
				this[key] = task[key];
			}
		}

		this.parent = parent;
		this.config = config ?? this.parent?.config ?? new Config({});

		normalizeFiles(this);
		this.customInfo = info;

		this.rawEntityIds = entityIds ?? this.parent?.rawEntityIds;

		this.force = force ?? this.parent?.force ?? false;
		this.dryRun = dryRun ?? this.parent?.dryRun ?? false;

		this.subtasks = task.subtasks?.map(t => this.createSubtask(t));

		// Resolve after subtasks so this.scope is available for compound tasks
		let ids = this.rawEntityIds;
		if (ids && typeof ids === "object" && !Array.isArray(ids)) {
			ids = ids[this.scope];
		}
		this.entityIds = ids ? toArray(ids) : this.entityModel?.ids;

		this.debug = { title: this.prefix, type: this.type ?? "compound", scope: this.scope };

		this.ready = Promise.resolve()
			.then(() => this.initAsync())
			.then(() => this.postInit());
	}

	get entityModel () {
		return this.config.model?.[this.scope];
	}

	createSubtask (subtask = this.task, args = {}) {
		return Task.create(subtask, { parent: this, ...args });
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

	get scope () {
		if (this.task.scope) {
			return this.task.scope;
		}

		if (this.subtasks) {
			let scopes = Task.getScopes(this.subtasks);

			// Prefer scopes with multiple entities — those drive entity selection
			for (let scope of scopes) {
				if (this.config.model?.[scope]?.multiple) {
					return scope;
				}
			}

			return [...scopes][0];
		}
	}

	static getScopes (tasks) {
		if (!Array.isArray(tasks)) {
			let scope = tasks?.scope;
			return new Set(scope ? [scope] : []);
		}

		return new Set(tasks.flatMap(t => t.scope).filter(Boolean));
	}

	get level () {
		return this.parent ? this.parent.level + 1 : 0;
	}

	get prefix () {
		let ret = this.title;

		if (this.entityModel?.multiple) {
			ret += " for ";
			if (this.entityIds?.length === 1) {
				if (this.parent && this.parent.entityIds) {
					ret = "";
				}

				ret += this.entityIds[0];
			}
			else {
				ret += `${this.entityIds.length} ${this.entityModel.plural}`;
			}
		}

		return ret;
	}

	get entityId () {
		return this.entityModel && this.entityIds?.length === 1 ? this.entityIds[0] : undefined;
	}

	get entity () {
		return this.entityId ? this.entityModel?.fromId(this.entityId) : undefined;
	}

	/** Whether this task splits its input into batches (i.e. `itemsPerPage > 0`). */
	get batched () {
		return this.itemsPerPage > 0;
	}

	/**
	 * The effective list of child tasks for this run, regardless of source
	 * (explicit subtasks, per-entity expansion, or batch pagination).
	 * Memoized on first access — subsequent reads return the cached array.
	 * Empty array for leaf tasks.
	 */
	get computedSubtasks () {
		let value;

		if (this.batched) {
			value = this.createBatchSubtasks();
		}
		else if (this.subtasks) {
			value = this.subtasks;
		}
		else if (this.entityModel?.multiple && !this.entityId) {
			value = this.entityIds.map(id => this.createSubtask(this.task, { entityIds: [id] }));
		}
		else {
			value = [];
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

	get cwd () {
		if (!this.entityModel) {
			return "";
		}

		let { path } = this.entityModel;
		return typeof path === "function" ? path(this.entityId) : path;
	}

	getMessage (args = {}) {
		if (typeof args === "string") {
			return this.prefix + args;
		}

		let { outputPath, size, sizeUnit, error, startTime } = args;
		let message = [
			error ? "failed after" : "completed in",
			formatDuration(performance.now() - startTime),
		];

		if (size !== undefined || outputPath) {
			message.push("and wrote");

			if (size !== undefined) {
				message.push(sizeUnit ? `${size} ${sizeUnit}` : formatSize(size));
			}

			if (outputPath) {
				message.push(`to ${outputPath}`);
			}
		}

		return this.prefix + " " + message.join(" ");
	}

	async initAsync () {}

	async postInit () {
		if (this.input) {
			this.input = toArray(this.input).map(input => File.get(input, this));
			this.debug.input = this.input.map(f => f.debugInfo());
		}

		if (this.output) {
			this.output = File.get(this.output, this);
			this.debug.output = this.output.debugInfo();
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

		if (computedSubtasks.some(t => t.output?.temporary)) {
			return this.mergeSubtaskOutputs(computedSubtasks);
		}

		// No merge: re-surface any subtask errors so they don't disappear silently.
		let errors = computedSubtasks.filter(t => t.error);
		if (errors.length > 0) {
			throw new AggregateError(
				errors.map(
					t =>
						new Error(`${t.output?.filePath ?? t.prefix}: ${t.error.message}`, {
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

		// Skip if the output already exists.
		let outputPath = this.output?.filePath;
		if (!this.force && outputPath && existsSync(outputPath)) {
			this.skipped = true;
			this.debug.skipped = true;

			if (this.dryRun) {
				return this.debug;
			}
			else if (this.progressIndicator) {
				this.progressIndicator.status = "Skipped — output exists";
			}
			else {
				this.info(
					this.prefix +
						` skipped (output already exists: ${outputPath}). Use -f to force.`,
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

			let message = this.getMessage({ ...result, startTime });

			if (result.error) {
				throw new Error(message, { cause: result.error });
			}

			this.info(message);
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

		let rawData = readJSONSync(batchableInput.filePath);
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
		let rawInputs = toArray(this.task.input);
		let batchableRaw = rawInputs[this.input.indexOf(batchableInput)];

		for (let start = 0; start < batchableData.length; start += batchSize) {
			let end = Math.min(start + batchSize, batchableData.length) - 1;
			let suffix = `-${start}-${end}`;
			let isFirst = start === 0;

			let sliceFilename = addFilenameSuffix(batchableInput.filename, suffix);

			// Batch slice always gets file-level fresh to avoid stale remote data.
			// Shared inputs have no file-level fresh, so they fall back to the task-level fresh below.
			let batchInput = rawInputs.map(raw =>
				raw === batchableRaw
					? {
							filename: sliceFilename,
							schema: batchableInput.schema,
							description: batchableInput.description,
							contents: batchableData.slice(start, end + 1),
							fresh: true,
						}
					: raw);

			let batchOutputFilename = addFilenameSuffix(this.output.filename, suffix);

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
						schema: this.output.schema,
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
		let merged = [];
		let completed = [];

		for (let subtask of subtasks) {
			if (existsSync(subtask.output.filePath)) {
				merged.push(...toArray(readJSONSync(subtask.output.filePath)));
				completed.push(subtask);
			}
		}

		if (merged.length === 0) {
			// t.result is assigned by runOne even when undefined; subtasks that were never
			// started (cut off by fail-fast) have neither property set.
			let notRun = subtasks.filter(t => !t.error && t.result === undefined).length;
			let message =
				notRun > 0
					? `First subtask failed; ${notRun} not run (fail-fast) — no outputs to merge`
					: "All subtasks failed — no outputs to merge";
			return {
				outputPath: this.output.filePath,
				size: 0,
				sizeUnit: "items",
				error: new AggregateError(
					subtasks
						.filter(t => t.error)
						.map(
							t =>
								new Error(`${t.output?.filePath ?? t.prefix}: ${t.error.message}`, {
									cause: t.error,
								}),
						),
					message,
				),
			};
		}

		let allComplete = completed.length === subtasks.length;
		let outputPath;

		if (allComplete) {
			outputPath = this.output.filePath;
		}
		else {
			outputPath = addFilenameSuffix(
				this.output.filePath,
				`-${completed.length}of${subtasks.length}`,
			);
			// Remove any stale complete output so it doesn't coexist with the partial one.
			if (existsSync(this.output.filePath)) {
				rmSync(this.output.filePath);
			}
		}

		writeJSONSync(outputPath, merged);

		this.info(
			`Merged ${merged.length} items from ${completed.length}/${subtasks.length} subtasks to ${outputPath}`,
		);

		if (!allComplete) {
			// On partial failure, keep all subtask outputs so a re-run can skip completed ones.
			let incomplete = subtasks.filter(t => !completed.includes(t));
			return {
				outputPath,
				size: merged.length,
				sizeUnit: "items",
				error: new AggregateError(
					incomplete
						.filter(t => t.error)
						.map(
							t =>
								new Error(`${t.output?.filePath ?? t.prefix}: ${t.error.message}`, {
									cause: t.error,
								}),
						),
					`${incomplete.length} subtask(s) incomplete. Re-run to retry.`,
				),
			};
		}

		// On full success, clean up any temporary subtask outputs — they're now merged into the final file.
		for (let subtask of completed) {
			if (subtask.output.temporary) {
				rmSync(subtask.output.filePath);
			}
		}

		return {
			outputPath,
			size: merged.length,
			sizeUnit: "items",
		};
	}

	notImplemented () {
		return new Error("Not implemented in " + this.constructor.name);
	}

	static #ids = null;
	static get ids () {
		if (!this.#ids) {
			this.#ids = readDirectorySync(`tasks`, { type: "file" })
				.filter(file => file.endsWith(".js") && !file.startsWith("_"))
				.map(file => file.replace(".js", ""));
		}
		return this.#ids;
	}

	static async resolve (taskId) {
		if (!taskId || typeof taskId === "object") {
			return taskId;
		}

		let task;
		let taskPath = `tasks/${taskId}.js`;

		if (!existsSync(taskPath)) {
			throw new Error(`Invalid task ID “${taskId}”. Available tasks: ${this.ids.join(", ")}`);
		}

		try {
			task = await importCwd(taskPath).then(m => {
				m.id = taskId;
				return m;
			});
		}
		catch (e) {
			throw new Error(`Task ${taskId} at ${taskPath} is invalid.`, { cause: e });
		}

		if (!task) {
			throw new Error(`Task ${taskId} at ${taskPath} is empty.`);
		}

		if (task instanceof Task) {
			task = task.task;
		}

		return task;
	}

	static async fromId (taskId, { entityIds, config, dryRun, ...overrides } = {}) {
		if (!taskId) {
			throw new Error(`No task provided. Available tasks: ${this.ids.join(", ")}`);
		}

		let task = await this.resolve(taskId);

		task = { ...task };

		normalizeFiles(task);

		let { input, output, force, ...otherOverrides } = overrides;

		if (input) {
			input = toArray(input);
			task.input ??= [];

			for (let i = 0; i < input.length; i++) {
				if (!input[i]) {
					// This way we can provide a falsy value to not override the first input
					// `-i -i foo` or `-i '' -i foo` don't seem to work but `-i 0 -i foo` does
					continue;
				}

				if (task.input[i]) {
					task.input[i].source = input[i];
				}
				else {
					task.input[i] = File.get(input[i]);
				}
			}
		}

		if (output) {
			task.output.source = output;
		}

		for (let key in otherOverrides) {
			// Why not use Object.assign()? Because we want to ignore undefined values.
			task[key] = overrides[key] ?? task[key];
		}

		config = await Config.from(config);
		return Task.create(task, { entityIds, force, dryRun, config });
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
	 * Polymorphic factory: dispatch to the registered subclass for `task.type`.
	 * Subclasses that need a further level of dispatch (e.g. LLMTask for providers)
	 * override this; others fall through to `new Type(task, ...args)`.
	 */
	static create (task, ...args) {
		let Type = Task.#registry.get(task.type);
		if (!Type) {
			return new Task(task, ...args);
		}
		if (Type.create !== this.create) {
			return Type.create(task, ...args);
		}
		return new Type(task, ...args);
	}
}

function normalizeFiles (task) {
	let context = task instanceof Task ? task : undefined;

	if (task.input) {
		task.input = toArray(task.input).map(file => File.get(file, context));
	}

	if (task.output) {
		task.output = File.get(task.output, context);
	}
}
