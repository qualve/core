import { writeFile, readFile, rm, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import csv from "csvtojson";
import { AsyncParser } from "@json2csv/node";
import logUpdate from "log-update";

export async function csvToJson (filepath) {
	const json = await csv().fromFile(filepath);

	await writeFile(filepath.replace(/\.csv$/, ".json"), JSON.stringify(json, null, 2));
}

export async function jsonToCsv (filepath) {
	const data = JSON.parse(await fs.readFile(filepath, "utf-8"));
	const csv = await new AsyncParser().parse(data).promise();

	await writeFile(filepath.replace(/\.json$/, ".csv"), csv);
}

export async function cleanUpFile (filepath, { exclude = [] } = {}) {
	if (!filepath) {
		console.warn("No file to clean up.");
		return;
	}

	let { dir, name, ext } = path.parse(filepath);
	if (ext !== ".json") {
		console.warn("Can only clean up .json files.");
		return;
	}

	let json = JSON.parse(await readFile(filepath, "utf-8"));
	json = json.map(item =>
		Object.fromEntries(
			Object.entries(item).filter(([key, value]) => value && !exclude.includes(key)),
		));

	// Preserve the original file by adding the "_original" suffix to its name
	await rename(filepath, path.join(dir, name + "_original.json"));

	// We don't pretty-print to minimize the number of bytes we pass to the LLM as much as possible
	await writeFile(filepath, JSON.stringify(json));
}

/**
 * Safely handles an async iterable stream of chunks from an LLM response,
 * writing them to a file with proper error handling and cleanup.
 * @param {AsyncIterable<any>} stream - An async iterable of chunks to be written.
 * @param {string} filepath - The path to the file where chunks will be written.
 * @param {string} [suffix=""] - An optional suffix to append to the filename before the extension.
 * @param {(chunk: any) => string} [transform] - An optional transform function to apply to each chunk before writing.
 */
export async function handleStreamedChunks ({
	stream,
	filepath,
	transform = value => value.toString(),
	suffix = "",
} = {}) {
	let { dir, name } = path.parse(filepath);
	const tmpFile = path.join(dir, name + suffix + ".tmp.json");

	// Open (create if it doesn't exist) file in append mode
	const ws = createWriteStream(tmpFile, { flags: "a" });

	let writeError;
	ws.on("error", err => {
		writeError = err;
	});

	try {
		for await (const chunk of stream) {
			if (writeError) {
				// Something went wrong while writing to disk.
				// That shouldn't happen, but if it does, we stop processing further chunks.
				throw writeError;
			}

			let value = transform(chunk);

			if (!ws.write(value)) {
				// Handle backpressure
				await once(ws, "drain");
			}
		}

		ws.end();
		await once(ws, "finish");

		// Clean up: prettify the result and write it to the final file
		let result = await readFile(tmpFile, "utf-8");
		result = JSON.parse(result.trim());

		// Fix up OpenAI weirdness: if an object has only one property, that property's value is the actual result
		if (!Array.isArray(result) && Object.keys(result).length === 1) {
			let key = Object.keys(result)[0];
			result = result[key];
		}

		await writeFile(path.join(dir, name + suffix + ".json"), JSON.stringify(result, null, 2));
		await rm(tmpFile);
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
