import { formatDuration, formatSize, readDirectorySync } from "./util.js";
import Question from "./question.js";

/**
 * Runs a task.
 * @param {string | object} taskId The task ID or a task object.
 * @param { {questionId?: string, confirm?: function, info?: function, ...overrides?: object}} [options]
 * @returns {Promise<object>} The result of the task.
 */
export default async function runTask (taskId, { questionId, confirm, info, ...overrides } = {}) {
	let task = await getTask(taskId);

	if (Array.isArray(task)) {
		// Run tasks sequentially
		// TODO we should probably resolve question ids only once instead of asking each time
		let results = [];
		for (let t of task) {
			results.push(await runTask(t, { questionId, confirm, info, ...overrides }));
		}
		return results;
	}

	task = { ...task };

	for (let key in overrides) {
		task[key] = overrides[key] ?? task[key];
	}

	// No need to handle errors since we currently only set this internally
	let runner = await import(`./run/${task.type ?? "data"}.js`).then(m => m.default ?? m);

	if (task.scope === "question") {
		if (!questionId) {
			if (runner.noMultipleQuestions) {
				throw new Error(
					`Please provide a question ID via the -q/--question flag. Available ids: ${Question.ids.join(", ")}`,
				);
			}
		}
		else if (questionId && !Question.ids.includes(questionId)) {
			throw new Error(
				`The question ID “${questionId}” is not valid. Available ids: ${Question.ids.join(", ")}`,
			);
		}
	}

	// Intentionally assigning [undefined] to questionIds if not a question task, so that the loop still runs once
	let questionIds =
		task.scope === "question" ? (questionId ? [questionId] : Question.ids) : [questionId];

	const multipleQuestions = questionIds.length > 1;

	if (multipleQuestions) {
		let confirmed = confirm
			? await confirm({
					prompt: `Are you sure you want to run the task for ${questionIds.length} questions? (${questionIds.join(", ")})`,
				})
			: true;
		if (!confirmed) {
			throw new Error("User cancelled");
		}

		info?.(`Running task “${task.title}” for ${questionIds.length} questions…`);
	}

	let maxQuestionIdLength;
	let index = 1;
	let results = [];

	for (let qid of questionIds) {
		let startTime = performance.now();
		let question = task.scope === "question" ? Question.fromId(qid) : null;
		let result = await runner.runTask(task, question);
		let prefix = task.title;

		if (multipleQuestions) {
			maxQuestionIdLength ??= Math.max(...questionIds.map(id => id.length ?? 0));
			prefix = `${qid} (${index++}/${questionIds.length})`.padStart(maxQuestionIdLength + 7);
		}

		let message = prefix + " " + getMessage(result, startTime);

		if (result.error) {
			throw new Error(message);
		}

		info?.(message);

		results.push(result);
	}

	return multipleQuestions ? results : results[0];
}

export async function getTask (taskId) {
	let task;

	if (!taskId) {
		throw new Error(`No task provided. Available tasks: ${getTaskIds().join(", ")}`);
	}

	if (typeof taskId === "object") {
		task = taskId;
		taskId = task.id;
	}
	else {
		try {
			task = await import(`../tasks/${taskId}.js`).then(m => {
				let task = m.default ?? m;
				task.id = taskId;
				return task;
			});
		}
		catch (e) {}

		if (!task) {
			throw new Error(
				`The task ID “${taskId}” is not valid. Available tasks: ${getTaskIds().join(", ")}`,
			);
		}
	}
}

export function getTaskIds () {
	return readDirectorySync(`tasks/`, { type: "file" })
		.filter(file => file.endsWith(".js") && !file.startsWith("_"))
		.map(file => file.replace(".js", ""));
}

function getMessage (result, startTime) {
	let { outputPath, size, sizeUnit, error } = result;
	let message = [
		error ? "failed after" : "completed in",
		formatDuration(performance.now() - startTime),
	];

	if (size !== undefined) {
		message.push(`and wrote ${sizeUnit ? `${size} ${sizeUnit}` : formatSize(size)}`);
	}

	if (outputPath) {
		message.push(` to ${outputPath}`);
	}

	return message.join(" ");
}
