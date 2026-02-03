#!/usr/bin/env node
import Question from "../src/question.js";
import { readDirectorySync, formatDuration } from "../src/util.js";
import { readArgs } from "./util.js";
import { runTask } from "../src/graphql.js";

const availableOptions = {
	questionId: {
		long: "question",
		short: "q",
	},
};

const args = readArgs(process.argv.slice(2), availableOptions);
const { questionId } = args;
const taskId = args._[0];

if (!taskId) {
	console.error(
		"Please provide a task ID as the first argument. Available tasks:",
		readDirectorySync("tasks/graphql/").map(file => file.replace(".js", "")),
	);
	process.exit(1);
}

let task = await import(`../tasks/graphql/${taskId}.js`);
task = task.default ?? task;

if (!task) {
	console.error(
		`The task ID “${taskId}” is not valid. Available tasks:`,
		readDirectorySync("tasks/graphql/").map(file => file.replace(".js", "")),
	);
	process.exit(1);
}

if (task.scope === "question") {
	if (!questionId) {
		console.error(
			"Please provide a question ID via the -q/--question flag. Available ids: ",
			Question.ids.join(", "),
		);
		process.exit(1);
	}
	else if (!Question.ids.includes(questionId)) {
		console.error(
			`The question ID “${questionId}” is not valid. Available ids: `,
			Question.ids.join(", "),
		);
		process.exit(1);
	}
}

let startTime = performance.now();
let { outputPath } = await runTask(task, questionId);
let duration = performance.now() - startTime;
console.info(
	`Finished ${task.title} in ${formatDuration(duration)}${outputPath ? ` and wrote the output to ${outputPath}` : ""}`,
);
