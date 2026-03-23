import { writeJSONSync } from "../util.js";
import Task from "../task.js";

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
			result = this.path.reduce((acc, key) => acc[key], result.data);
			result = this.handleResult?.(result) ?? result;

			var size = outputPath ? writeJSONSync(outputPath, result)?.length : undefined;
		}

		return { result, query, outputPath, size };
	}
}

export function stringifyQuery (value, key) {
	if (key) {
		if (typeof value === "object") {
			return `${key} { ${stringifyQuery(value)} }`;
		}
		else if (typeof value === "string") {
			return `${key} { ${value} }`;
		}

		return key;
	}

	if (Array.isArray(value)) {
		return value.map(item => stringifyQuery(item)).join(" ");
	}
	if (typeof value === "object") {
		return Object.entries(value)
			.map(([key, value]) => stringifyQuery(value, key))
			.join(" ");
	}

	return value;
}

async function runQuery (query, endpoint) {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query }),
	});

	try {
		var json = await response.json();
	}
	catch (e) {
		var text = await response.text();
	}

	if (!response.ok) {
		let errors = json?.errors ?? [{ message: text }];
		for (const error of errors) {
			console.error(`GraphQL error: ${error.message}. Query: ${query}`);
		}
		return null;
	}

	return json;
}

Task.register(GraphQLTask);
