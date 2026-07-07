import Task from "../task.js";
import { shapeResult } from "../util.js";

export default class DataTask extends Task {
	static type = "data";

	async runTask () {
		// Flat expansion only feeds the dry-run/empty checks; the resultType
		// shaping (grouping, projection, keying) lives in shapeResult.
		let files = this.input.flatMap(f => (f.glob ? f.children : [f]));

		if (this.dryRun) {
			Object.assign(this.debug, {
				resultType: this.resultType,
				output: this.output?.map?.(f => f.debug),
				files: files.map(f => f.debug),
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

		let args = shapeResult(this.input, this.resultType);
		let input = args.length === 1 ? args[0] : args;
		let result = this.handleResult?.(...args) ?? input;

		// Pure computation: output writing is handled by Task.run().
		return { inputs: files, result };
	}
}

Task.register(DataTask);
