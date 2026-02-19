import {
	readFileSync,
	writeFileSync,
	rmSync,
	readdirSync,
	renameSync,
	createWriteStream,
} from "node:fs";
import path from "node:path";
import { pathToFileURL, URL } from "node:url";
import { once } from "node:events";

export { default as dedent } from "dedent";
export * from "./util/csv.js";
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
 * Safely handles an async iterable stream of chunks from an LLM response,
 * writing them to a file with proper error handling and cleanup.
 * When no outputPath is provided, collects the response text in memory and returns it.
 * @param {Object} options
 * @param {AsyncIterable<Object>} options.stream - An async iterable of chunks to be written.
 * @param {string} [options.outputPath] - The path to the file where chunks will be written. If omitted, text is collected in memory.
 * @param {(chunk: Object) => string} [options.transformChunk] - An optional transform function to apply to each chunk before writing.
 * @param {(result: Object) => string} [options.transformResult] - An optional transform function to apply to the final result after all chunks have been written and read back.
 * @param {(chunk: Object) => void} [options.onChunk] - An optional callback to handle each chunk as it is processed (e.g. for progress updates).
 * @returns {Promise<string|undefined>} The collected text when no outputPath is given, otherwise undefined.
 */
export async function handleStream ({
	stream,
	outputPath,
	transformChunk,
	transformResult,
	onChunk = () => {},
} = {}) {
	// No output file — collect text in memory
	if (!outputPath) {
		let chunks = [];
		for await (let chunk of stream) {
			onChunk(chunk);
			chunks.push(transformChunk ? transformChunk(chunk) : chunk);
		}
		return chunks.join("");
	}

	const tmpFile = addFilenameSuffix(outputPath, ".tmp");

	// Open (create if it doesn't exist) file in append mode
	const ws = createWriteStream(tmpFile, { flags: "a" });

	let writeError;
	ws.on("error", err => {
		writeError = err;
	});

	try {
		for await (let chunk of stream) {
			if (writeError) {
				// Something went wrong while writing to disk.
				// That shouldn't happen, but if it does, we stop processing further chunks.
				throw writeError;
			}

			onChunk(chunk);

			if (transformChunk) {
				chunk = transformChunk(chunk);
			}

			if (!ws.write(chunk)) {
				// Handle backpressure
				await once(ws, "drain");
			}
		}

		ws.end();
		await once(ws, "finish");

		// Clean up: prettify the result and write it to the final file

		if (transformResult) {
			let result = readJSONSync(tmpFile);
			result = transformResult(result);
			writeJSONSync(outputPath, result);
			rmSync(tmpFile);
		}
		else {
			renameSync(tmpFile, outputPath);
		}
	}
	catch (e) {
		throw new Error(`Stream handling failed for ${outputPath}`, { cause: e });
	}
	finally {
		ws.destroy();
	}
}

export async function mapAsync (arr, fn, { parallelize = false } = {}) {
	if (parallelize) {
		return Promise.all(arr.map(fn));
	}

	let results = [];
	for (let i = 0; i < arr.length; i++) {
		results.push(await fn(arr[i], i, arr));
	}
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
