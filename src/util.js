import {
	readFileSync,
	writeFileSync,
	rmSync,
	existsSync,
	readdirSync,
	// statSync,
	// opendirSync,
} from "node:fs";
// import * as path from "node:path";
// import { pathToFileURL } from "node:url";

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
	return writeFileSync(path, JSON.stringify(data, replacer, indent));
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

// export function isDirectoryEmptySync (path) {
// 	const dir = opendirSync(path);
// 	const entry = dir.readSync();
// 	dir.closeSync();
// 	return entry === null;
// }

// export function importCwdRelative (pathFromCwd) {
// 	return import(pathToFileURL(path.resolve(process.cwd(), pathFromCwd)).href);
// }

// /**
//  * Matches a path against a glob pattern or array of glob patterns
//  * Like `path.matchesGlob()`, but supports arrays of patterns.
//  * If array is provided, returns true if any of the patterns match.
//  * @param { string } path - The path to match
//  * @param { string | string[] } glob - The glob pattern or array of patterns
//  * @returns { boolean } Whether the path matches the glob pattern
//  */
// export function matchesGlob (filePath, glob) {
// 	if (Array.isArray(glob)) {
// 		return glob.some(g => path.matchesGlob(filePath, g));
// 	}

// 	return path.matchesGlob(filePath, glob);
// }

import { createWriteStream, renameSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import csv from "csvtojson";
import { AsyncParser } from "@json2csv/node";
import logUpdate from "log-update";

export async function csvToJson (filepath) {
	const json = await csv().fromFile(filepath);

	writeFileSync(filepath.replace(/\.csv$/, ".json"), JSON.stringify(json, null, 2));
}

export async function jsonToCsv (filepath) {
	const data = JSON.parse(readFileSync(filepath, "utf-8"));
	const csv = await new AsyncParser().parse(data).promise();

	writeFileSync(filepath.replace(/\.json$/, ".csv"), csv);
}

export function camelCase (str) {
	return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function toArray (value) {
	return Array.isArray(value) ? value : [value];
}

const UNITS = {
	days: 86_400_000,
	hours: 3_600_000,
	minutes: 60_000,
	seconds: 1_000,
};

function msToUnits (ms) {
	let format = {};

	for (const unit in UNITS) {
		let unitMs = UNITS[unit];
		if (ms >= unitMs) {
			format[unit] = Math.floor(ms / unitMs);
			ms %= unitMs;
		}
	}

	format.milliseconds = ms;
	return format;
}

export function formatDuration (ms, { locale = "en", ...options } = {}) {
	let format = msToUnits(ms);

	// Otherwise Intl.DurationFormat will throw with "Number not integral"
	format.milliseconds = Math.round(format.milliseconds);

	return new Intl.DurationFormat(locale, {
		style: "short",
		maximumFractionDigits: 2,
		...options,
	}).format(format);
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
		let result = readFileSync(tmpFile, "utf-8");
		result = JSON.parse(result.trim());

		if (transformResult) {
			result = transformResult(result);
		}

		writeFileSync(outputPath, JSON.stringify(result, null, 2));
		rmSync(tmpFile);
	}
	finally {
		ws.destroy();
	}
}

export function showProgressIndicator (message) {
	const frames = ["-", "\\", "|", "/"];
	const framesLength = frames.length;
	let index = 0;

	const interval = setInterval(() => {
		const frame = frames[(index = ++index % framesLength)];
		logUpdate(frame + " " + message);
	}, 80);

	function done () {
		clearInterval(interval);
		logUpdate(message);
		logUpdate.done();
	}

	return done;
}
