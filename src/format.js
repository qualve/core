/**
 * Base class for data serialization formats (JSON, CSV, etc.).
 *
 * A Format is a pure encoding spec: it knows how to convert between raw bytes/text
 * and structured JS values, and it carries identity (extensions, MIME type).
 * It does no I/O — reading from disk and producing Blobs lives on {@link File}.
 *
 * Subclasses override static `extensions`, `mimeType`, `binary`, `parse`, and `serialize`,
 * then register via `Format.register(SubClass)` so `Format.byExtension.get(ext)` finds them.
 *
 * The base class itself is usable as a generic text/plain fallback for files with no
 * registered format — its `parse`/`serialize` pass strings and Buffers through unchanged,
 * and `binary` is left undefined so `File` can auto-detect on read.
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
	 * The base Format leaves this undefined so `File` auto-detects on read.
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
		return data;
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

