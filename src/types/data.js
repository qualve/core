import { writeJSONSync } from "../util.js";
import Task from "../task.js";

export default class DataTask extends Task {
	static type = "data";

	async runTask () {
		let outputPath = this.output?.filePath;

		// Flatten: each input File may have children from glob expansion
		let files = this.input.flatMap(f => f.children.length > 0 ? f.children : [f]);

		if (this.dryRun) {
			Object.assign(this.debug, { resultType: this.resultType, outputPath, files: files.map(f => f.debugInfo()) });
			return;
		}

		if (files.length === 0) {
			return {};
		}

		let input =
			this.resultType === "array"
				? files.map(f => f.contents)
				: this.resultType === "files"
					? files
					: files[0].contents;
		let result = this.handleResult?.(input) ?? input;

		let size = outputPath ? writeJSONSync(outputPath, result)?.length : undefined;

		return { inputs: files, result, outputPath, size };
	}
}

Task.register(DataTask);
