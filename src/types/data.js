import { globSync } from "node:fs";
import path from "node:path";
import { readJSONSync, writeJSONSync } from "../util.js";
import Task from "./task.js";

export default class DataTask extends Task {
	async runTask (question) {
		if (this.input) {
			var inputPath = question ? `${question.id}/${this.input}` : this.input;
		}

		let inputs = globSync(inputPath, { cwd: "data", withFileTypes: true })
			.filter(file => file.isFile())
			.map(file => {
				let ret = { path: path.join(file.parentPath, file.name), name: file.name };
				ret.contents = readJSONSync(ret.path);
				return ret;
			});

		let input =
			this.resultType === "array"
				? inputs.map(input => input.contents)
				: this.resultType === "files"
					? inputs
					: inputs[0].contents;
		let result = this.handleResult?.(input, question) ?? input;

		if (this.output) {
			var outputPath = `data${this.scope === "question" ? "/" + question.id : ""}/${this.output}`;
			var size = writeJSONSync(outputPath, result)?.length;
		}

		return { inputs, result, inputPath, outputPath, size };
	}
}
