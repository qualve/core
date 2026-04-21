import { readFileSync, writeFileSync } from "node:fs";

/**
 * Represents a data serialization format (JSON, CSV, etc.).
 *
 * `parse(raw) → data` and `serialize(data) → raw`.
 * `raw` is a string for text formats, a Buffer for binary formats — controlled by `binary`.
 *
 * Constructing a Format auto-registers it by extension in `Format.byExtension`.
 * Pass `extensions: []` (or omit) to create an unregistered format (e.g. for specialized
 * variants like compact-JSON used for LLM uploads).
 */
export default class Format {
	/** Public registry: extension (without dot) → Format instance. */
	static byExtension = new Map();

	/**
	 * @param {object} descriptor
	 * @param {string[]} [descriptor.extensions] - Extensions without dots (e.g. ["json"]).
	 *   Omit or pass [] to skip auto-registration.
	 * @param {string} [descriptor.mimeType="application/octet-stream"]
	 * @param {boolean} [descriptor.binary=false] - If true, parse receives a Buffer and serialize returns a Buffer.
	 * @param {(raw: string | Buffer) => *} descriptor.parse
	 * @param {(data: *) => string | Buffer} descriptor.serialize
	 */
	constructor ({ extensions = [], mimeType, binary = false, parse, serialize }) {
		if (!parse || !serialize) {
			throw new Error("Formats must provide both parse and serialize");
		}

		this.extensions = extensions;
		this.mimeType = mimeType ?? "application/octet-stream";
		this.binary = binary;
		this.parse = parse;
		this.serialize = serialize;

		for (let ext of this.extensions) {
			Format.byExtension.set(ext, this);
		}
	}

	/** Read a file in this format. */
	readSync (filePath) {
		return this.parse(readFileSync(filePath, this.binary ? undefined : "utf8"));
	}

	/** Write a JS value to a file in this format. Returns the serialized content. */
	writeSync (filePath, data) {
		let contents = this.serialize(data);
		writeFileSync(filePath, contents);
		return contents;
	}
}

// Built-in JSON format — always available, no separate package needed
export const JsonFormat = new Format({
	extensions: ["json"],
	mimeType: "application/json",
	parse: text => JSON.parse(text),
	serialize: (data, { compact = false, indent, replacer } = {}) => {
		indent ??= compact ? null : "\t";
		replacer ??= compact ? (k, v) => v ?? undefined : null;
		return JSON.stringify(data, replacer, indent);
	},
});
