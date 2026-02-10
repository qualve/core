import LLM from "../llm.js";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import Task from "./task.js";
import { minifyJSONSync, dedent } from "../util.js";
import { inputFiles, outputFile } from "../../tasks/_prompts-common.js";

export default class LLMTask extends Task {
	constructor (task, args) {
		super(task, args);

		if (existsSync(".env")) {
			loadEnvFile(".env");
		}

		this.llmId = this.llm ?? "gemini";
		this.llm = undefined;

		// We do not yet support parallelizing LLM tasks
		// Since we use logUpdate() to display the progress of the task, it would create a total mess
		let t = this;
		while (t) {
			t.parallelize = false;
			t = t.parent;
		}
	}

	async initAsync () {
		this.llm = await LLM.create(this.llmId, { fresh: this.fresh, model: this.model });
	}

	normalizePrompts (prompts) {
		if (typeof prompts === "function") {
			prompts = prompts(this.question);
		}

		// Do not convert to else if, function may return a string or an array
		if (typeof prompts === "string") {
			prompts = dedent(prompts);
		}
		else if (Array.isArray(prompts)) {
			return prompts.flatMap(prompt => this.normalizePrompts(prompt));
		}

		return [prompts];
	}

	async postInit () {
		await super.postInit();

		if (this.input) {
			for (let entry of this.input) {
				entry.filePath = minifyJSONSync(entry.filePath);
			}
		}

		this.system = this.normalizePrompts(this.system);
		this.prompt = this.normalizePrompts(this.prompt);

		const capabilities = this.llm.constructor.capabilities;

		if (
			this.input?.length > 0 &&
			!capabilities.inputSchema &&
			!capabilities.inputDescriptions
		) {
			// Incorporate file descriptions and schemas into the prompt
			this.prompt.push(inputFiles.call(this, this.input));
		}

		if (this.output) {
			this.prompt.push(outputFile.call(this, this.output));
		}
	}

	async runTask () {
		return this.llm.runTask(this);
	}
}
