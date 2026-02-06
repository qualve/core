#!/usr/bin/env node
import { readArgs } from "./util/args.js";
import { confirm } from "./util/ask.js";
import runTask, { getTaskIds } from "../src/run.js";

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
		short: "f",
	},
};

const args = readArgs(process.argv.slice(2), availableOptions);
let { questionId, _: positional, ...overrides } = args;
const taskId = positional[0];

if (!taskId) {
	console.info(`Available tasks: ${getTaskIds().join("\n")}`);
	process.exit(0);
}

try {
	await runTask(taskId, { questionId, confirm, info: console.info, ...overrides });
}
catch (cause) {
	console.error(cause.message);
	process.exit(1);
}
