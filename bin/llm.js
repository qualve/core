#!/usr/bin/env node
/**
 * Main entry point.
 * Dynamically loads the specified LLM adapter and runs the shared LLM orchestrator.
 * @param {string} questionId - The ID of the question to be coded.
 * @param {string} [llm=gemini] - The LLM to use (e.g., "gemini", "openai", "claude").
 * @param {string} [model] - The specific model for the LLM to use (e.g., "gemini-3-pro-preview").
 * @param {string} [task=answers] - The task to perform ("answers" or "codebook").
 * @param {boolean} [fresh] - Whether to force fresh upload of files (yes, if present).
 * @example
 * node index.js browser_apis --llm openai --fresh
 */

import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { readDirectorySync } from "../src/util.js";
import { readArgs } from "./util.js";
import Question from "../src/question.js";

if (existsSync(".env")) {
	loadEnvFile(".env");
}

const availableOptions = {
	llmId: {
		long: "llm",
		default: "gemini",
	},
	model: {
		default: undefined,
	},
	task: {
		default: "answers",
	},
	fresh: {
		default: false,
		short: "f",
	},
	questionId: {
		long: "question",
		short: "q",
	},
};

const args = readArgs(process.argv.slice(2), availableOptions);

const { questionId, llmId, model, fresh } = args;
const taskId = args._[0] ?? "answers";

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

const question = Question.fromId(questionId);

let llmPath = `../llms/${llmId}.js`;
let module;
try {
	module = await import(llmPath);
}
catch (e) {
	console.error(`Failed to load the LLM module from “${llmPath}”.`);
	console.error(e);
	process.exit(1);
}

const LLM = module.default ?? module;
const runner = new LLM({ fresh, model });

let task;
let taskPath = `../tasks/llm/${taskId}/index.js`;
try {
	task = await import(taskPath).then(module => module.default);
}
catch (e) {
	if (!existsSync(taskPath)) {
		console.error(
			`The task ID “${taskId}” is not valid. Available ids: `,
			readDirectorySync("../tasks/llm", { type: "directory" }).join(", "),
		);
		process.exit(1);
	}

	console.error(`Failed to load the task module for “${taskId}” from “${taskPath}”.`);
	console.error(e);
	process.exit(1);
}

await runner.runTask(task, question);
process.exit();
