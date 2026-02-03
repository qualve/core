import { writeJSONSync, formatDuration } from "./util.js";
import survey from "../tasks/survey.js";
import Question from "./question.js";

const ENDPOINT = "https://api.devographics.com/graphql";

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

export async function runQuery (query, endpoint = ENDPOINT) {
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

export async function runTask (task, questionId) {
	let question = questionId && task.scope === "question" ? Question.fromId(questionId) : null;

	let query = task.fields;

	if (task.scope === "survey" || task.scope === "question") {
		if (task.scope === "question") {
			query = { [question.section]: { [question.id]: query } };
		}

		query = { surveys: { [survey.name]: { [survey.id]: query } } };
	}

	query = stringifyQuery(query, "query");

	let result = await runQuery(query);

	if (result) {
		result = result?.data;

		if (task.scope === "survey" || task.scope === "question") {
			result = result.surveys[survey.name][survey.id];

			if (task.scope === "question") {
				result = result[question.section][question.id];
			}
		}

		if (task.handleResult) {
			result = task.handleResult(result) ?? result;
		}

		if (task.output) {
			var outputPath = `data/${questionId}/${task.output}`;
			var size = writeJSONSync(outputPath, result)?.length;
		}
	}

	return { result, query, outputPath, size };
}
