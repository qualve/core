import { formatDuration, formatSize, readDirectorySync, mapAsync } from "../util.js";
import Question from "../question.js";

export default class Task {
	constructor (task, { parent = null, parallelize, questionIds, info } = {}) {
		this.task = task instanceof Task ? task.task : task;

		for (let key in task) {
			if (!(key in this)) {
				this[key] = task[key];
			}
		}

		this.parent = parent;
		this.parallelize = parallelize;
		this.customInfo = info;

		if (questionIds) {
			this.questionIds = questionIds;
		}

		this.subtasks = task.subtasks?.map(t => this.createSubtask(t));
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

	async run () {
		let startTime = performance.now();
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

			result = await mapAsync(subtasks, t => t.run(), { parallelize });
			this.info(this.getMessage({ startTime }));
		}
		else {
			result = await this.runTask();
			let message = this.getMessage({ ...result, startTime });

			if (result.error) {
				throw new Error(message);
			}

			this.info?.(message);
		}

		return result;
	}

	async runTask () {
		throw this.notImplemented();
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
			try {
				task = await import(`../../tasks/${taskId}.js`).then(m => {
					let task = m.default ?? m;
					task.id = taskId;
					return task;
				});
			}
			catch (e) {}

			if (!task) {
				throw new Error(
					`Invalid task ID “${taskId}”. Available tasks: ${this.ids.join(", ")}`,
				);
			}
		}

		if (task instanceof Task) {
			task = task.task;
		}

		task = { ...task };

		for (let key in overrides) {
			// Why not use Object.assign()? Because we want to ignore undefined values.
			task[key] = overrides[key] ?? task[key];
		}

		return Task.create(task, { questionIds });
	}

	// To be overridden
	static create (task, ...args) {
		return new Task(task, ...args);
	}
}
