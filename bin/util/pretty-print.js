import { inspect } from "node:util";

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
