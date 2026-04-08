import { toArray } from "../util.js";
import Task from "../task.js";

export default class DataTask extends Task {
	static type = "data";

	async runTask () {
		// Flatten: each input File may have children from glob expansion
		let files = this.input.flatMap(f => f.children?.length > 0 ? f.children : [f]);

		if (this.dryRun) {
			Object.assign(this.debug, { resultType: this.resultType, files: files.map(f => f.debugInfo()) });
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

		// Resolve dynamic output (#28) — call with Task as `this`
		if (typeof this.task.output === "function") {
			let { File } = this.constructor;
			this.output = toArray(this.task.output.call(this, result)).map(o => File.get(o, this));
		}

		// Write to all outputs
		let outputs = toArray(this.output).filter(Boolean);
		let outputPaths = [];
		let sizes = [];

		for (let output of outputs) {
			// Skip if output already exists and not forcing
			if (!this.force && output.exists()) {
				continue;
			}

			let fileData = result;

			if (output.source.handleResult) {
				fileData = output.source.handleResult(result);

				if (fileData === null) {
					continue; // null = skip this file
				}

				fileData ??= result; // undefined = fall back to result
			}

			let size = output.write(fileData);
			outputPaths.push(output.path);
			sizes.push(size);
		}

		return {
			inputs: files,
			result,
			...(outputPaths.length <= 1
				? { outputPath: outputPaths[0], size: sizes[0] }
				: { outputPaths, sizes }),
		};
	}
}

Task.register(DataTask);
