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

export async function runQuery (query, endpoint) {
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
