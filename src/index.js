/**
 * Main entry point.
 * Dynamically loads the specified LLM adapter and runs the shared LLM orchestrator.
 * @param {string} questionId - The ID of the question to be coded.
 * @param {string} [llm=gemini] - The LLM to use (e.g., "gemini", "openai", "claude").
 * @param {string} [model] - The specific model for the LLM to use (e.g., "gemini-3-pro-preview").
 * @param {string} [step=answers] - The step to perform ("answers" or "codebook").
 * @param {boolean} [fresh] - Whether to force fresh upload of files (yes, if present).
 * @example
 * node index.js browser_apis --llm openai --fresh
 */

import { argv, loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import LLM from "./llm.js";
import Question from "./question.js";

if (existsSync(".env")) {
	loadEnvFile(".env");
}

const questionId = argv[2];
if (!questionId) {
	console.error("Please provide a question ID as the first argument. For example, browser_apis.");
	process.exit(1);
}

const question = Question.fromId(questionId);

let llm = argv.includes("--llm") ? argv[argv.indexOf("--llm") + 1] : "gemini";
let model = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : undefined;
let step = argv.includes("--step") ? argv[argv.indexOf("--step") + 1] : "answers";
let fresh = argv.includes("--fresh") || undefined;

let llmPath = `../llms/${llm}.js`;
let module;
try {
	module = await import(llmPath);
}
catch (e) {
	console.error(`Failed to load the LLM adapter from “${llmPath}”.`);
	console.error(e);
	process.exit(1);
}

const adapter = module.default ?? module;
const runner = new LLM(adapter, { fresh, model });

let task = await import(`../tasks/${step}/index.js`).then(module => module.default);

await runner.runTask(task, question);
process.exit();
