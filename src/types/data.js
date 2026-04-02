import Task from "../task.js";

export default class DataTask extends Task {
	static type = "data";

	async runTask () {
		// Flatten: each input File may have children from glob expansion
		let files = this.input.flatMap(f => f.children?.length > 0 ? f.children : [f]);

		if (this.dryRun) {
			Object.assign(this.debug, { resultType: this.resultType, outputPath: this.output?.path, files: files.map(f => f.debugInfo()) });
			return;
		}

		if (files.length === 0) {
			return {};
		}

		// Await any async contents (e.g. from function sources returning promises)
		let thenables = files.filter(f => f?.contents?.then).map(f => f.contents);

		if (thenables.length > 0) {
			await Promise.all(thenables);
		}

		let input =
			this.resultType === "array"
				? files.map(f => f.contents)
				: this.resultType === "files"
					? files
					: files[0].contents;
		let result = this.handleResult?.(input) ?? input;

		let size = this.output?.write(result);

		return { inputs: files, result, outputPath: this.output?.path, size };
	}
}

Task.register(DataTask);
