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
export class Format {
	constructor (options) {
		if (!options) {
			// Defaults
			return;
		}

		let { mimeType, mimeTypes, extension, extensions, parse, serialize, parseOptions, serializeOptions, ...otherOptions } = options;

		this.parseOptions = Object.assign({}, otherOptions, parseOptions, parse && typeof parse === "object" ? parse : undefined);
		this.serializeOptions = Object.assign({}, otherOptions, serializeOptions, serialize && typeof serialize === "object" ? serialize : undefined);

		if (typeof parse === "function") {
			this.parse = parse;
		}

		if (typeof serialize === "function") {
			this.serialize = serialize;
		}

		if (extensions) {
			this.extensions = extensions;
		}
		if (extension) {
			this.extensions.unshift(extension);
		}

		// TODO same with MIME types

		// Register, unless latent
		if (!options.latent) {
			this.register();
		}
	}

	register () {
		let { byExtension, byMimeType } = this.constructor;

		for (let ext of this.extensions) {
			byExtension.set(ext, Class);
		}

		// TODO same for mime types
	}

	/** Extensions this format handles, without dots. Override in subclass. */
	extensions = [];

	get extension () {
		return this.extensions[0];
	}

	/** MIME type. Defaults to text/plain for the generic fallback. */
	mimeTypes = [];

	/** Primary MIME type */
	get mimeType () {
		return this.mimeTypes[0];
	}

	/**
	 * Whether this format works with Buffers (true) or strings (false).
	 * The base Format leaves this undefined so `File` auto-detects on read.
	 */
	binary;

	/** Parse raw bytes/text into a JS value. Identity by default. */
	parse (raw) {
		return raw;
	}

	/**
	 * Serialize a JS value into raw bytes/text.
	 * Passes strings and Buffers through unchanged; throws for other types —
	 * specific formats must override.
	 */
	serialize (data, options) {
		return data;
	}

	/** Registry: extension (without dot) → Format subclass. */
	static byExtension = new Map();

	// TODO
	static byMimeType = new Map();

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
	binary = false;
}

/** Abstract base for binary formats. */
export class BinaryFormat extends Format {
	binary = true;
}
