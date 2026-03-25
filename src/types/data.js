import { globSync } from "node:fs";
import path from "node:path";
import { readJSONSync, writeJSONSync } from "../util.js";
import Task from "../task.js";

export default class DataTask extends Task {
	static type = "data";

	async runTask () {
		let outputPath = this.output?.filePath;

		let files = this.input.flatMap(input =>
			globSync(input.filename, { cwd: this.cwd, withFileTypes: true }).filter(file =>
				file.isFile()));

		if (this.dryRun) {
			Object.assign(this.debug, { resultType: this.resultType, outputPath, files });
			return;
		}

		if (files.length === 0) {
			// No files matched — not an error, just a no-op
			return {};
		}

		files = files.map(file => {
			let ret = { path: path.join(file.parentPath, file.name), name: file.name };
			ret.contents = readJSONSync(ret.path);
			return ret;
		});

		let input =
			this.resultType === "array"
				? files.map(file => file.contents)
				: this.resultType === "files"
					? files
					: files[0].contents;
		let result = this.handleResult?.(input) ?? input;

		let size = outputPath ? writeJSONSync(outputPath, result)?.length : undefined;

		return { inputs: files, result, outputPath, size };
	}
}

Task.register(DataTask);
