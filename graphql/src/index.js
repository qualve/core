import Task from "qualve/task";
import { writeJSONSync } from "qualve/util";
import { stringifyQuery, runQuery } from "./util.js";

export default class GraphQLTask extends Task {
	static type = "graphql";

	async postInit () {
		await super.postInit();

		this.debug.endpoint = this.config.graphql?.endpoint;
	}

	get path () {
		let path = this.config.graphql?.getPath?.call(this) ?? [];
		Object.defineProperty(this, "path", { value: path, configurable: true });
		return this.path;
	}

	/** Build the full GraphQL query string by wrapping `this.fields` in `this.path`. */
	get query () {
		let fields = this.path.reduceRight((acc, key) => ({ [key]: acc }), this.fields);
		return stringifyQuery(fields, "query");
	}

	async runTask () {
		let query = this.query;
		let outputPath = this.output?.filePath;

		if (this.dryRun) {
			Object.assign(this.debug, { query, outputPath });
			return;
		}

		let result = await runQuery(query, this.config.graphql?.endpoint);

		if (result) {
			result = this.path.reduce((acc, key) => acc?.[key], result.data);
			result = this.handleResult?.(result) ?? result;

			var size = outputPath ? writeJSONSync(outputPath, result)?.length : undefined;
		}

		return { result, query, outputPath, size };
	}
}

Task.register(GraphQLTask);
