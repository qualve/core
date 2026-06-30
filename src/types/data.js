import Task from "../task.js";

export default class DataTask extends Task {
	static type = "data";

	async runTask () {
		// Flatten: globs expand to children (empty array if no matches); leaves stay as-is.
		let files = this.input.flatMap(f => f.glob ? f.children : [f]);

		if (this.dryRun) {
			Object.assign(this.debug, {
				resultType: this.resultType,
				output: this.output?.map?.(f => f.debugInfo()),
				files: files.map(f => f.debugInfo()),
			});
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

		// Pure computation: output writing is handled by Task.run().
		return { inputs: files, result };
	}
}

Task.register(DataTask);
