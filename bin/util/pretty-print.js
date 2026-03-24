import { inspect } from "node:util";

/**
 * Recursively print an error to stderr, expanding:
 *   - `cause` chains (any depth)
 *   - `AggregateError.errors[]` entries (each recursed fully)
 *
 * Never throws — falls back to inspect(error) for non-standard shapes.
 * Circular error references are detected and short-circuited.
 *
 * @param {unknown} error - The error to print.
 * @param {object} [options]
 * @param {string} [options.indent=""] - Whitespace prepended to every line of output.
 * @param {string} [options.header=""] - Label prepended to the first line only (e.g. "Caused by ").
 * @param {WeakSet} [options.seen] - Tracks visited errors to prevent circular recursion.
 */
export function printError (error, { indent = "", header = "", seen = new WeakSet() } = {}) {
	if (error && typeof error === "object") {
		if (seen.has(error)) {
			console.error(indent + header + "[Circular error reference]");
			return;
		}

		seen.add(error);
	}

	let lines = (error?.stack ?? inspect(error, { depth: null, colors: true })).split("\n");
	// Label appears only on the first line; subsequent stack-frame lines get indent only.
	console.error(indent + header + lines[0]);
	for (let i = 1; i < lines.length; i++) {
		console.error(indent + lines[i]);
	}

	if (error instanceof AggregateError) {
		console.error(indent + "  Details:");
		for (let inner of error.errors) {
			printError(inner, { indent: indent + "    ", seen });
		}
	}

	if (error?.cause) {
		printError(error.cause, { indent: indent + "  ", header: "Caused by ", seen });
	}
}

export function prettyPrint (obj) {
	console.info(inspect(raw(obj), { depth: null, colors: true }));
}

/**
 * Recursively wrap strings so `inspect` displays them raw
 * (no quotes, no escaped tabs/newlines).
 */
function raw (value) {
	if (typeof value === "string") {
		return { [inspect.custom]: () => value };
	}
	if (Array.isArray(value)) {
		return value.map(raw);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, raw(v)]));
	}
	return value;
}
