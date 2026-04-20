import {
	readFileSync,
	writeFileSync,
	readdirSync,
} from "node:fs";
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

export function readDirectorySync (directory, { type } = {}) {
	try {
		let ret = readdirSync(directory, { withFileTypes: true });

		if (type) {
			ret = ret.filter(item => item[type === "directory" ? "isDirectory" : "isFile"]());
		}

		return ret.map(item => item.name);
	}
	catch (e) {
		if (e.code === "ENOENT") {
			return [];
		}

		throw e;
	}
}

export function camelCase (str) {
	return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert a camelCase identifier to kebab-case.
 * Splits on camelCase boundaries and at acronym-ends (uppercase run followed by capital+lowercase),
 * then lowercases.
 * @param {string} str
 * @returns {string}
 * @example
 * kebabCase("dryRun")       // "dry-run"
 * kebabCase("itemsPerPage") // "items-per-page"
 * kebabCase("config")       // "config"
 * kebabCase("idV2")         // "id-v2"
 * kebabCase("HTTPSUrl")     // "https-url"
 * kebabCase("openAIKey")    // "open-ai-key"
 */
export function kebabCase (str) {
	return str.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, "-").toLowerCase();
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
