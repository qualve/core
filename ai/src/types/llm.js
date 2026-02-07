import LLM from "../llm.js";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import Task from "./task.js";
import { camelCase, minifyJSONSync, dedent } from "../util.js";

export default class LLMTask extends Task {
	constructor (task, args) {
		super(task, args);

		if (existsSync(".env")) {
			loadEnvFile(".env");
		}

		// We do not yet support parallelizing LLM tasks
		// Since we use logUpdate() to display the progress of the task, it would create a total mess
		let t = this;
		while (t) {
			t.parallelize = false;
			t = t.parent;
		}
	}

	async runTask (question) {
		if (this.input) {
			this.files = Object.fromEntries(
				this.input.map(file => {
					let { name, schema } = file;
					// TODO incorporate file schema into the prompt or send it to LLM if it supports this
					return [
						camelCase(name),
						{
							filePath: minifyJSONSync(`${question.filePath}/${name}.json`),
							schema,
						},
					];
				}),
			);

			delete this.input;
		}

		this.system = handlePrompts(this.system, question);
		this.prompt = handlePrompts(this.prompt, question);

		this.llm ??= "gemini";
		const llm = await LLM.create(this.llm, { fresh: this.fresh, model: this.model });

		if (this.output) {
			let suffix = "";

			if (this.output.suffix) {
				suffix = `-${llm.id}` + (this.output.suffix === "model" ? `-${llm.model}` : "");
			}

			this.outputPath = `${question.filePath}/${this.output.name}${suffix}.json`;
			this.responseSchema = this.output.schema;

			delete this.output;
		}

		return llm.runTask(this, question);
	}
}

function handlePrompts (prompts, question) {
	if (typeof prompts === "function") {
		prompts = prompts(question);
	}

	// Do not convert to else if, function may return a string or an array
	if (typeof prompts === "string") {
		prompts = dedent(prompts);
	}
	else if (Array.isArray(prompts)) {
		return prompts.flatMap(prompt => handlePrompts(prompt, question));
	}

	return [prompts];
}
