import { globSync } from "node:fs";
import path from "node:path";
import { readJSONSync, writeJSONSync } from "../util.js";
import Task from "./task.js";

export default class DataTask extends Task {
	async runTask () {
		let globs = this.input.map(input => input.filename);

		let files = globSync(globs, { cwd: this.cwd, withFileTypes: true })
			.filter(file => file.isFile())
			.map(file => {
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

		let outputPath = this.outputPath;
		let size = outputPath ? writeJSONSync(outputPath, result)?.length : undefined;

		return { inputs: files, result, outputPath, size };
	}
}
