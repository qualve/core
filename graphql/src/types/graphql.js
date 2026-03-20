import { writeJSONSync } from "../util.js";
import Task from "../task.js";

export default class GraphQLTask extends Task {
	static type = "graphql";
	/** Build the full GraphQL query string from `this.fields` and scope. */
	get query () {
		let query = this.fields;
		let { survey } = this.config;

		if (this.scope === "survey" || this.scope === "question") {
			if (this.scope === "question") {
				query = { [this.question.section]: { [this.question.id]: query } };
			}

			query = { surveys: { [survey.name]: { [survey.id]: query } } };
		}

		return stringifyQuery(query, "query");
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
		let { survey } = this.config;
		let result = await runQuery(query, this.config.graphql?.endpoint);

		if (result) {
			result = result?.data;

			if (this.scope === "survey" || this.scope === "question") {
				result = result.surveys[survey.name][survey.id];

				if (this.scope === "question") {
					result = result[this.question.section][this.question.id];
				}
			}

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
