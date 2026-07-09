import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export * from "./util/format.js";
export * from "./util/progress-indicator.js";

export function readJSONSync (path) {
	let contents;

	try {
		contents = readFileSync(path, "utf8");
	}
	catch (e) {
		if (e.code === "ENOENT") {
			throw new Error(`JSON file not found in ${path}`, { cause: e });
		}
		else if (e.code === "EISDIR") {
			throw new Error(`${path} is a directory, not a JSON file.`, { cause: e });
		}

		throw e;
	}

	try {
		return JSON.parse(contents);
	}
	catch (e) {
		throw new Error(`Failed to parse JSON from ${path}.`, { cause: e });
	}
}

export function writeJSONSync (path, data, indent = "\t", replacer = null) {
	let contents = JSON.stringify(data, replacer, indent);
	writeFileSync(path, contents);
	return contents;
}

export function camelCase (str) {
	return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function toArray (value) {
	return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
}

export function addFilenameSuffix (filepath, suffix) {
	let ext = getExtension(filepath);

	if (!ext) {
		return filepath + suffix;
	}

	return filepath.slice(0, -ext.length) + suffix + ext;
}

/**
 * Map over an array with concurrency control.
 * @param {Array} arr
 * @param {Function} fn - Async mapping function (element, index, array) => result.
 * @param {object} [options]
 * @param {number} [options.concurrency] - Max concurrent invocations.
 *   Omit or set to `1` for sequential execution. Use `Infinity` for unlimited parallelism.
 */
export async function mapAsync (arr, fn, { concurrency } = {}) {
	if (!concurrency || concurrency <= 1) {
		let results = [];
		for (let i = 0; i < arr.length; i++) {
			results.push(await fn(arr[i], i, arr));
		}
		return results;
	}

	if (concurrency >= arr.length) {
		return Promise.all(arr.map(fn));
	}

	// Worker-pool pattern: N workers pull from a shared index counter.
	// Results are stored by index so output order matches input order.
	let results = new Array(arr.length);
	let next = 0;

	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (next < arr.length) {
				let i = next++;
				results[i] = await fn(arr[i], i, arr);
			}
		}),
	);

	return results;
}

/**
 * Get the file extension from a source string, ignoring purely numeric extensions.
 * @param {string} source
 * @returns {string | undefined} The extension (e.g. ".json") or undefined if none found.
 */
export function getExtension (source) {
	if (typeof source !== "string" || !/\.\w+$/.test(source)) {
		return;
	}

	let ext = path.extname(source);
	if (ext >= 0) {
		// We don't accept purely numeric extensions
		return;
	}

	return ext;
}

export async function importCwd (modulePath) {
	let absPath = path.resolve(process.cwd(), modulePath);
	let url = pathToFileURL(absPath).href;

	let m = await import(url);
	return Object.keys(m).length === 1 && m.default ? m.default : m;
}

export function capitalize (str) {
	if (!str) {
		return str;
	}

	return str[0].toUpperCase() + str.slice(1);
}

export function isGlob (str) {
	return /(?<!\\)[*?\[{]/.test(str);
}

/**
 * camelCase → kebab-case, splitting on real word boundaries so acronyms stay together:
 *   "myFlag"     → "my-flag"
 *   "itemsPerPage" → "items-per-page"
 *   "AIFoo"      → "ai-foo"     (acronym kept whole)
 *   "URLPath"    → "url-path"   (acronym kept whole)
 *   "Foo"        → "foo"        (no leading dash from a capitalized first letter)
 *
 * Two zero-width boundaries: non-uppercase → uppercase (entering a new word),
 * or uppercase → uppercase-followed-by-non-uppercase (the last char of an
 * acronym run starts a new capitalized word).
 */
export function camelToKebab (s) {
	return s.replace(/(?<=[^A-Z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][^A-Z])/g, "-").toLowerCase();
}

/**
 * Parse a `resultType` string — the shape of `handleResult`'s input.
 * Microsyntax: `(args|array)(-grouped)?(-files)?`, order-insensitive.
 * - `args` (default): one positional argument per element; `array`: a single
 *   array.
 * - `grouped`: one element per input (a glob's matches arrive as one
 *   array); default splices glob matches inline.
 * - `files`: `File` objects instead of their contents.
 * The type defaults to `args`: `"grouped"` ≡ `args-grouped`, `"files"` ≡
 * `args-files`.
 * Already-parsed objects pass through, so callers can parse once and forward.
 * @param {string | { type?: string, grouped?: boolean, files?: boolean }} [resultType]
 * @returns {{ type: "args" | "array", grouped: boolean, files: boolean }}
 * @throws On unknown tokens, or more than one type token.
 */
export function parseResultType (resultType) {
	if (resultType && typeof resultType === "object") {
		// Already parsed, just return it.
		return resultType;
	}

	const TYPES = new Set(["args", "array"]);
	const FLAGS = ["grouped", "files"];

	let tokens = [...new Set(resultType?.split("-").filter(Boolean) ?? [])];
	let types = tokens.filter(t => TYPES.has(t));
	let unknown = tokens.filter(t => !TYPES.has(t) && !FLAGS.includes(t));

	if (unknown.length > 0) {
		throw new Error(
			`Invalid resultType token "${unknown.join('", "')}" in "${resultType}". Valid: (args|array)(-grouped)?(-files)?.`,
		);
	}

	if (types.length > 1) {
		throw new Error(`Ambiguous resultType "${resultType}": more than one type token.`);
	}

	return {
		type: types[0] ?? "args",
		...Object.fromEntries(FLAGS.map(f => [f, tokens.includes(f)])),
	};
}

/**
 * Shape Files into `handleResult`'s argument list, per a `resultType`
 * (see {@link parseResultType}). Pure: reads `File#contents` as-is, so await
 * any async contents before calling.
 * Returns the argument list: one spread argument per element for `args`, a
 * single array for `array` — so callers invoke `handleResult(...args)`, and
 * `args.length === 1 ? args[0] : args` is the no-handler fallback value.
 * For keyed access, use `files` — a `File` carries its own identity
 * (`name`, `filename`, `parent`).
 * @param {import("./file.js").default[]} files
 * @param {string | { type?: string, grouped?: boolean, files?: boolean }} [resultType]
 * @returns {unknown[]}
 * @throws On an invalid `resultType` string (see {@link parseResultType}).
 */
export function shapeResult (files, resultType) {
	let rt = parseResultType(resultType);

	let project = value =>
		Array.isArray(value) ? value.map(project) : rt.files ? value : value.contents;

	// Flatten before projecting otherwise flat() would also flatten array-valued file contents
	let elements = files.map(f => (f.glob ? f.children : f));

	if (!rt.grouped) {
		elements = elements.flat();
	}

	elements = elements.map(project);

	// handleResult's argument list: array is a single argument, args one per element.
	return rt.type === "array" ? [elements] : elements;
}
