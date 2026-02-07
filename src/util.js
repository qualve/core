import {
	readFileSync,
	writeFileSync,
	rmSync,
	existsSync,
	readdirSync,
	renameSync,
	createWriteStream,
} from "node:fs";
import path from "node:path";
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
	return Array.isArray(value) ? value : [value];
}

/**
 * Minify a JSON file
 * @param {*} filepath
 * @param {*} param1
 * @returns
 */
export function minifyJSONSync (filepath, { force } = {}) {
	if (!filepath) {
		console.error("Empty filepath provided to minifyJSONSync().");
		return filepath;
	}

	let filepathMinified = addFilenameSuffix(filepath, ".min");
	if (!force && existsSync(filepathMinified)) {
		// TODO also discard if source file has been modified since the minified file was created
		return filepathMinified;
	}

	let json = readJSONSync(filepath);

	// value ?? undefined coerces nulls to undefined as well, and undefined values are omitted
	writeJSONSync(filepathMinified, json, "", (key, value) => value ?? undefined);
	return filepathMinified;
}

export function addFilenameSuffix (filepath, suffix) {
	let { dir, name, ext } = path.parse(filepath);
	return path.join(dir, name + suffix + ext);
}

/**
 * Safely handles an async iterable stream of chunks from an LLM response,
 * writing them to a file with proper error handling and cleanup.
 * @param {AsyncIterable<any>} stream - An async iterable of chunks to be written.
 * @param {string} outputPath - The path to the file where chunks will be written.
 * @param {(chunk: any) => string} [transform] - An optional transform function to apply to each chunk before writing.
 */
export async function handleStreamedChunks ({
	stream,
	outputPath,
	transformChunk,
	transformResult,
} = {}) {
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
	finally {
		ws.destroy();
	}
}

export async function mapAsync (arr, fn, { parallelize = false } = {}) {
	if (parallelize) {
		return Promise.allSettled(arr.map(fn)).map(result => result.value);
	}

	let results = [];
	for (let i = 0; i < arr.length; i++) {
		results.push(await fn(arr[i], i, arr));
	}
	return results;
}
