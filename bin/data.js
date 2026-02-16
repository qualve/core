#!/usr/bin/env node
import { readArgs } from "./util/args.js";
import { confirm } from "./util/ask.js";
import Task from "../src/task.js";
import Question, { ids as questionIds } from "../src/question.js";

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
	process.exit(1);
}

if (questionId) {
	questionId = Question.resolveId(questionId);

	if (questionId !== args.questionId && process.stdin.isTTY) {
		if (
			!(await confirm({
				prompt: `Did you mean "${questionId}" instead of "${args.questionId}"?`,
			}))
		) {
			process.exit(1);
		}
	}
}

let task = await Task.fromId(taskId, { questionIds: questionId || questionIds, ...overrides });

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
				`Please provide a question ID via the -q/--question flag. Available ids: ${questionIds.join(", ")}`,
			);
		}
	}
}

try {
	await task.run();
}
catch (e) {
	console.error(e.stack);

	let depth = 1;
	for (let cause = e.cause; cause; cause = cause.cause, depth++) {
		let indent = "  ".repeat(depth);
		let text = (cause.stack ?? String(cause)).replaceAll("\n", "\n" + indent);
		console.error(indent + "Caused by", text);
	}

	process.exit(1);
}
