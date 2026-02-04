#!/usr/bin/env node
import Question from "../src/question.js";
import { readDirectorySync, formatDuration, formatSize } from "../src/util.js";
import { readArgs, confirm } from "./util.js";
import { runTask } from "../src/data.js";

const availableOptions = {
	questionId: {
		long: "question",
		short: "q",
	},
	input: {
		short: "i",
	},
	output: {
		short: "o",
	},
};
const args = readArgs(process.argv.slice(2), availableOptions);
let { questionId, input, output } = args;
const taskId = args._[0];

if (!taskId) {
	console.info(
		"Available tasks:",
		readDirectorySync("tasks/data/", { type: "file" })
			.map(file => "\n" + file.replace(".js", ""))
			.join(""),
	);
	process.exit(0);
}

let task = await import(`../tasks/data/${taskId}.js`);
task = task.default ?? task;

if (!task) {
	console.error(
		`The task ID “${taskId}” is not valid. Available tasks:`,
		readDirectorySync("tasks/data/").map(file => file.replace(".js", "")),
	);
	process.exit(1);
}

task = { ...task };
task.input = input ?? task.input;
task.output = output ?? task.output;

// Intentionally assigning [undefined] to questionIds if not a question task, so that the loop still runs once
let questionIds =
	task.scope === "question" ? (questionId ? [questionId] : Question.ids) : [questionId];

const multipleQuestions = questionIds.length > 1;

if (multipleQuestions) {
	let confirmed = await confirm({
		prompt: `Are you sure you want to run the task for ${questionIds.length} questions? (${questionIds.join(", ")})`,
	});
	if (!confirmed) {
		process.exit(1);
	}

	console.info(`Running task “${task.title}” for ${questionIds.length} questions…`);
}

const maxQuestionIdLength =
	task.scope === "question" ? Math.max(...questionIds.map(id => id.length ?? 0)) : 0;
let index = 1;

for (let qid of questionIds) {
	let startTime = performance.now();
	let { outputPath, size } = await runTask(task, qid);

	if (size !== undefined) {
		size = formatSize(size);
	}

	let duration = performance.now() - startTime;

	console.info(
		`${multipleQuestions ? `${qid} (${index++}/${questionIds.length})`.padStart(maxQuestionIdLength + 7) : `${task.title}`} completed in ${formatDuration(duration)}${outputPath ? ` and wrote ${size} to ${outputPath}` : ""}`,
	);
}
