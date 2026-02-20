import {
	formatDuration,
	formatSize,
	readDirectorySync,
	mapAsync,
	toArray,
	importCwd,
} from "../util.js";
import Question from "../question.js";
import File from "../file.js";
import { existsSync } from "node:fs";

export default class Task {
	constructor (task, { parent = null, parallelize, questionIds, info, force } = {}) {
		this.task = task instanceof Task ? task.task : task;

		for (let key in task) {
			if (!(key in this)) {
				this[key] = task[key];
			}
		}

		normalizeFiles(this);

		this.parent = parent;
		this.parallelize = parallelize;
		this.customInfo = info;

		if (questionIds) {
			this.questionIds = questionIds;
		}

		if (force !== undefined) {
			this.force = force;
		}

		this.subtasks = task.subtasks?.map(t => this.createSubtask(t));

		this.ready = Promise.resolve()
			.then(() => this.initAsync())
			.then(() => this.postInit());
	}

	createSubtask (subtask = this.task, args = {}) {
		return Task.create(subtask, { parent: this, ...args });
	}

	info (message) {
		message = "\t".repeat(this.level) + message;
		(this.customInfo ?? console.info)(message);
	}

	get scope () {
		if (this.task.scope) {
			return this.task.scope;
		}

		if (this.subtasks) {
			let scopes = new Set(this.subtasks.map(t => t.scope));
			if (scopes.has("question")) {
				return "question";
			}

			if (scopes.has("survey")) {
				return "survey";
			}

			return [...scopes][0];
		}
	}

	get level () {
		return this.parent ? this.parent.level + 1 : 0;
	}

	get prefix () {
		let ret = this.title;

		if (this.scope === "question") {
			ret += " for ";
			if (this.questionIds?.length === 1) {
				if (this.parent && this.parent.questionIds) {
					ret = "";
				}

				ret += this.questionIds[0];
			}
			else {
				ret += `${this.questionIds.length} questions`;
			}
		}

		return ret;
	}

	#questionIds;
	get questionIds () {
		return this.#questionIds ?? this.parent?.questionIds;
	}
	set questionIds (questionIds) {
		questionIds = Array.isArray(questionIds) ? questionIds : [questionIds];
		this.#questionIds = questionIds;
	}

	#force;
	get force () {
		return this.#force ?? this.parent?.force ?? false;
	}
	set force (value) {
		this.#force = value;
	}

	get questionId () {
		return this.scope === "question" && this.questionIds?.length === 1
			? this.questionIds[0]
			: undefined;
	}

	get question () {
		return this.questionId ? Question.fromId(this.questionId) : undefined;
	}

	get multiple () {
		return this.subtasks || (this.scope === "question" && this.questionIds?.length > 1);
	}

	get cwd () {
		return "data/" + (this.questionId ? `${this.questionId}/` : "");
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
		}

		if (this.output) {
			this.output = File.get(this.output, this);
		}
	}

	async run ({ dryRun } = {}) {
		await this.ready;

		let startTime = performance.now();
		let debugInfo = dryRun ? await this.debugInfo() : undefined;
		let result;

		if (this.multiple) {
			this.info(this.getMessage("..."));

			let subtasks = this.subtasks;
			let parallelize = this.parallelize;

			if (!subtasks) {
				subtasks = this.questionIds.map(qid =>
					this.createSubtask(this.task, { questionIds: [qid] }));
				parallelize ??= true;
			}

			result = await mapAsync(subtasks, t => t.run({ dryRun }), { parallelize });

			this.info(this.getMessage({ startTime }));

			if (dryRun) {
				debugInfo.subtasks = result;
				return debugInfo;
			}
		}
		else {
			let outputPath = this.output?.filePath;
			if (!this.force && outputPath && existsSync(outputPath)) {
				this.info(
					this.prefix +
						` skipped (output already exists: ${outputPath}). Use -f to force.`,
				);

				if (dryRun) {
					debugInfo.skipped = true;
					return debugInfo;
				}

				return;
			}

			if (dryRun) {
				return debugInfo;
			}

			result = await this.runTask();
			let message = this.getMessage({ ...result, startTime });

			if (result.error) {
				throw new Error(message, { cause: result.error });
			}

			this.info?.(message);
		}

		return result;
	}

	async runTask () {
		throw this.notImplemented();
	}

	/**
	 * Return the fully resolved state of this task as a plain object.
	 * Base returns common info (title, type, scope, input files, output).
	 * Subclasses override and spread super to add type-specific details.
	 */
	async debugInfo () {
		let info = {
			title: this.prefix,
			type: this.type ?? "compound",
			scope: this.scope,
		};

		if (this.input?.length > 0) {
			info.input = this.input.map(f => f.debugInfo());
		}

		if (this.output) {
			info.output = this.output.debugInfo();
		}

		return info;
	}

	notImplemented () {
		return new Error("Not implemented in " + this.constructor.name);
	}

	/**
	 * Factory method to create the right task subclass based on the task type.
	 */
	static create (task, ...args) {
		return new (TaskTypes[task.type] ?? Task)(task, ...args);
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

	static async fromId (taskId, { questionIds, ...overrides } = {}) {
		let task;

		if (!taskId) {
			throw new Error(`No task provided. Available tasks: ${this.ids.join(", ")}`);
		}

		if (typeof taskId === "object") {
			task = taskId;
			taskId = task.id;
		}
		else {
			let taskPath = `tasks/${taskId}.js`;

			if (!existsSync(taskPath)) {
				throw new Error(
					`Invalid task ID “${taskId}”. Available tasks: ${this.ids.join(", ")}`,
				);
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
		}

		if (task instanceof Task) {
			task = task.task;
		}

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

		return Task.create(task, { questionIds, force });
	}

	// To be overridden
	static create (task, ...args) {
		return new Task(task, ...args);
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
