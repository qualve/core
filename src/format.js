import { readFileSync, writeFileSync } from "node:fs";

/**
 * Base class for data serialization formats (JSON, CSV, etc.).
 *
 * Subclasses override static `extensions`, `mimeType`, `binary`, `parse`, and `serialize`,
 * then register via `Format.register(SubClass)` so `Format.byExtension.get(ext)` finds them.
 *
 * The base class itself is usable as a generic text/plain fallback for files with no
 * registered format — its `readSync` auto-detects binary (null bytes → Buffer) vs text
 * (UTF-8 string), and `parse`/`serialize` pass strings and Buffers through unchanged.
 *
 * Text formats should extend {@link TextFormat}, binary formats {@link BinaryFormat}.
 */
export default class Format {
	/** Registry: extension (without dot) → Format subclass. */
	static byExtension = new Map();

	/** Extensions this format handles, without dots. Override in subclass. */
	static extensions = [];

	/** MIME type. Defaults to text/plain for the generic fallback. */
	static mimeType = "text/plain";

	/**
	 * Whether this format works with Buffers (true) or strings (false).
	 * The base Format leaves this undefined so `readSync` auto-detects.
	 */
	static binary;

	/** Parse raw bytes/text into a JS value. Identity by default. */
	static parse (raw) {
		return raw;
	}

	/**
	 * Serialize a JS value into raw bytes/text.
	 * Passes strings and Buffers through unchanged; throws for other types —
	 * specific formats must override.
	 */
	static serialize (data, options) {
		if (typeof data === "string" || Buffer.isBuffer(data)) {
			return data;
		}
		throw new Error(
			`${this.name}: cannot serialize ${typeof data}. Register a format for the file's extension.`,
		);
	}

	/**
	 * Read a file in this format.
	 * When `binary` is undefined (on the base Format), auto-detects binary vs text.
	 */
	static readSync (filePath) {
		let raw;
		if (this.binary === undefined) {
			// Auto-detect — null bytes → Buffer, otherwise UTF-8
			let buffer = readFileSync(filePath);
			raw = buffer.includes(0) ? buffer : buffer.toString("utf8");
		}
		else {
			raw = readFileSync(filePath, this.binary ? undefined : "utf8");
		}
		return this.parse(raw);
	}

	/** Write a JS value to a file in this format. Returns the serialized content. */
	static writeSync (filePath, data, options) {
		let contents = this.serialize(data, options);
		writeFileSync(filePath, contents);
		return contents;
	}

	/**
	 * Wrap a JS value in a Blob using this format's MIME type.
	 * Strings and Buffers pass through unchanged; other types go through `serialize`.
	 * Binary formats put the raw Buffer into the Blob — no base64 detour.
	 */
	static toBlob (data, options) {
		let serialized =
			typeof data === "string" || Buffer.isBuffer(data)
				? data
				: this.serialize(data, options);
		return new Blob([serialized], { type: this.mimeType });
	}

	/**
	 * Register a Format subclass for its declared extensions.
	 * Subclasses with `extensions = []` are not registered.
	 */
	static register (Class) {
		for (let ext of Class.extensions) {
			Format.byExtension.set(ext, Class);
		}
	}
}

/** Abstract base for text formats. */
export class TextFormat extends Format {
	static binary = false;
}

/** Abstract base for binary formats. */
export class BinaryFormat extends Format {
	static binary = true;
}

/** Built-in JSON format. */
class JsonFormat extends TextFormat {
	static extensions = ["json"];
	static mimeType = "application/json";

	static parse (text) {
		return JSON.parse(text);
	}

	static serialize (data, { compact = false, indent, replacer } = {}) {
		indent ??= compact ? null : "\t";
		replacer ??= compact ? (k, v) => v ?? undefined : null;
		return JSON.stringify(data, replacer, indent);
	}
}

Format.register(JsonFormat);

export { JsonFormat as json };
