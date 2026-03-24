import {
	rmSync,
	renameSync,
	createWriteStream,
} from "node:fs";
import { once } from "node:events";
import { addFilenameSuffix, readJSONSync, writeJSONSync } from "qualve/util";

export { default as dedent } from "dedent";

/**
 * @typedef {Object} StreamResult
 * @property {boolean} complete - Whether the stream completed normally.
 * @property {string} reason - Normalized stop reason (@see LLM.stopReasons).
 * @property {string|null} reasonRaw - Provider-specific stop reason, for low-level handling.
 */

/**
 * Safely handles an async iterable stream of chunks from an LLM response,
 * writing them to a file with proper error handling and cleanup.
 * When no outputPath is provided, collects the response text in memory and returns it.
 * @param {Object} options
 * @param {AsyncIterable<Object>} options.stream - An async iterable of chunks to be written.
 * @param {string} [options.outputPath] - The path to the file where chunks will be written. If omitted, text is collected in memory.
 * @param {(chunk: Object) => string} [options.transformChunk] - An optional transform function to apply to each chunk before writing.
 * @param {(result: Object) => Object} [options.transformResult] - An optional transform function to apply to the final result after all chunks have been written and read back.
 * @param {(chunk: Object) => void} [options.onChunk] - An optional callback to handle each chunk as it is processed (e.g. for progress updates).
 * @param {() => (StreamResult | null | undefined)} [options.onFinish] - An optional callback invoked after the stream ends, before file promotion. Return a StreamResult with complete: false to prevent file promotion and throw.
 * @returns {Promise<string|undefined>} The collected text when no outputPath is given, otherwise undefined.
 */
export async function handleStream ({
	stream,
	outputPath,
	transformChunk,
	transformResult,
	onChunk = () => {},
	onFinish = () => {},
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

	const ws = createWriteStream(tmpFile);

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

		// var (not let) hoists `streamResult` out of the try block so it's accessible below.
		var streamResult = onFinish();
	}
	catch (e) {
		throw new Error(`Stream handling failed for ${outputPath}`, { cause: e });
	}
	finally {
		ws.destroy();
	}

	// Checked after stream I/O so the error isn't buried under "Stream handling failed".
	// Callers can inspect error.cause.streamResult.reason (normalized) and error.cause.streamResult.reasonRaw (provider-specific).
	if (streamResult && !streamResult.complete) {
		let cause = new Error(`Provider stop reason: ${streamResult.reasonRaw}`);
		cause.streamResult = streamResult;
		throw new Error(`An error occurred while generating the response: ${streamResult.reason}`, {
			cause,
		});
	}

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
