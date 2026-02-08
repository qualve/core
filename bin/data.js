#!/usr/bin/env node
import { readArgs } from "./util/args.js";
import { confirm } from "./util/ask.js";
import Task from "../src/task.js";
import Question from "../src/question.js";

const availableOptions = {
	questionId: {
		long: "question",
		short: "q",
	},

	// Options specific to data tasks
	input: {
		short: "i",
	},
	output: {
		short: "o",
	},

	// Options specific to LLM tasks
	llm: {},
	model: {},
	fresh: {
		default: false,
	},
	force: {
		default: false,
		short: "f",
	},
};

const args = readArgs(process.argv.slice(2), availableOptions);
let { questionId, _: positional, ...overrides } = args;
const taskId = positional[0];

if (!taskId) {
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(0);
}

let task = await Task.fromId(taskId, { questionIds: questionId, ...overrides });

if (task.scope === "question") {
	if (!questionId) {
		let allQuestions =
			task.type === "llm"
				? false
				: confirm
					? await confirm({
							prompt: `Are you sure you want to run the task for all questions?`,
						})
					: true;
		if (!allQuestions) {
			throw new Error(
				`Please provide a question ID via the -q/--question flag. Available ids: ${Question.ids.join(", ")}`,
			);
		}

		task.questionIds = Question.ids;
	}
}

try {
	await task.run();
}
catch (cause) {
	console.error(cause.message, cause.stack);
	process.exit(1);
}
