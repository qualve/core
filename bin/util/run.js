#!/usr/bin/env node
import { readArgs } from "./args.js";
import { confirm } from "./ask.js";
import runTask from "../../src/run.js";

export async function run (runner, availableOptions) {
	const args = readArgs(process.argv.slice(2), availableOptions);
	let { questionId, _: positional, ...overrides } = args;
	const taskId = positional[0];

	try {
		await runTask(runner, taskId, { questionId, confirm, info: console.info, ...overrides });
	}
	catch (cause) {
		console.error(cause.message, { cause });
		process.exit(1);
	}
}
