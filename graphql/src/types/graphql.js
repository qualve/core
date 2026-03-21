import { writeJSONSync } from "../util.js";
import Task from "../task.js";

export default class GraphQLTask extends Task {
	static type = "graphql";
	path = [];

	async postInit () {
		await super.postInit();

		if (this.scope === "survey" || this.scope === "question") {
			const { survey } = this.config;

			this.path.push("surveys", survey.name, survey.id);

			if (this.scope === "question") {
				this.path.push(this.question.section, this.question.id);
			}
		}
	}

	/** Build the full GraphQL query string by wrapping `this.fields` in `this.path`. */
	get query () {
		let fields = this.path.reduceRight((acc, key) => ({ [key]: acc }), this.fields);
		return stringifyQuery(fields, "query");
	}

	async debugInfo () {
		return {
			...(await super.debugInfo()),
			endpoint: this.config.graphql?.endpoint,
			query: this.query,
		};
	}

	async runTask () {
		let query = this.query;
		let result = await runQuery(query, this.config.graphql?.endpoint);

		if (result) {
			result = this.path.reduce((acc, key) => acc[key], result.data);
			result = this.handleResult?.(result) ?? result;

			var outputPath = this.output?.filePath;
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
