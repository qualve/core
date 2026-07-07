import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addFilenameSuffix, getExtension, isGlob } from "./util.js";
import Format from "./format.js";

export default class File {
	context;

	/** When true, treat filename literally — no glob expansion. Also read from source. */
	get literal () {
		return this.#literal ?? this.source?.literal ?? false;
	}
	set literal (value) {
		this.#literal = value;
	}
	#literal;

	/** Parent File, set on children created by glob expansion. */
	parent;

	/**
	 * The task run that produced this file, when it came from another task's output
	 * (see qualve/core#61). A fact about the file's history, not its current context,
	 * so it survives context re-wraps. Undefined for files with no producing run.
	 */
	producer;

	/** Debug info, populated in context as facts are resolved (see Task#debug). */
	debug = {};

	constructor (source, context) {
		this.source = source;
		this.context = context;
	}

	/** Reentrancy guard: deriving a name may read other files' names, whose chain can lead back here. */
	#resolving = false;

	#resolve (prop) {
		if (!this.source || this.#resolving) {
			return;
		}

		let source;

		this.#resolving = true;
		try {
			if (typeof this.source === "string") {
				source = File.resolveString(this.source);
			}
			else if (typeof this.source === "object") {
				source = {};

				for (let key of ["name", "extension", "filename", "suffix"]) {
					if (!(key in this.source)) {
						continue;
					}

					source[key] = this.resolveValue(this.source[key]);
				}

				// Object sources need the same glob detection string sources get via resolveString()
				// — e.g. `{ name: () => "coding-*" }` should resolve to a glob too. filename wins
				// over name, matching the derivation order below.
				let pattern = source.filename ?? source.name;
				if (pattern && isGlob(pattern)) {
					// Globs have no single name — clear the pattern out so it doesn't leak,
					// matching resolveString()'s contract for string globs.
					source.glob = File.resolveString(pattern).glob;
					source.name = source.filename = source.extension = undefined;
				}
			}

			// Define glob even when absent, so first resolution memoizes it — the getter
			// would otherwise re-run #resolve (and re-derive names) on every .glob access.
			source.glob ??= null;

			// A glob-looking pattern may still name a real file (e.g. `report[1].json`).
			// If it's marked literal or exists on disk, it's a filename, not a glob.
			if (
				source.glob &&
				(this.literal || existsSync(path.join(this.context?.cwd ?? "", source.glob)))
			) {
				source.filename = source.glob;
				source.glob = null;
			}

			if (!source.glob) {
				if (!source.filename && !source.name) {
					// The naming policy for unnamed files belongs to the context (Task.baseName).
					source.name = this.context?.baseName;
				}

				if (source.name) {
					source.filename ??= source.name + "." + (source.extension ?? "json");
				}

				if (this.suffix) {
					source.filename = addFilenameSuffix(source.filename, this.suffix);
				}

				source.extension ??= getExtension(source.filename)?.slice(1) ?? "json";
				// ||= so an explicit empty-string name is rederived too, consistent with
				// the truthy check above.
				source.name ||= source.filename.slice(0, -source.extension.length - 1);
			}
		}
		finally {
			this.#resolving = false;
		}

		this.resolvedSource = source;
		Object.defineProperties(this, Object.getOwnPropertyDescriptors(source));

		if (source.glob) {
			this.debug.glob = source.glob;
		}
		else {
			this.debug.name = source.name;
			this.debug.filename = source.filename;
			if (this.parent) {
				this.debug.glob = this.parent.glob;
			}
		}

		return source[prop];
	}

	resolveValue (value) {
		return typeof value === "function" ? value.call(this.context) : value;
	}

	get glob () {
		return this.#resolve("glob");
	}

	get name () {
		return this.#resolve("name");
	}

	get filename () {
		return this.#resolve("filename");
	}

	/** File extension (e.g. ".json", ".txt") or undefined if none. */
	get extension () {
		return this.#resolve("extension");
	}

	/**
	 * The Format for this file's extension. Falls back to the generic Format base class
	 * for unknown extensions (handles text/plain with binary auto-detection).
	 */
	get format () {
		return Format.byExtension(this.extension) ?? Format.default;
	}

	get suffix () {
		return this.#getMemoizedOrInherit("suffix");
	}

	get filePath () {
		if (this.glob) {
			return;
		}

		let value = path.join(this.context?.cwd ?? "", this.filename);
		Object.defineProperty(this, "filePath", { value, writable: true, configurable: true });
		this.debug.filePath = value;
		return value;
	}

	/** Alias for filePath. */
	get path () {
		return this.filePath;
	}

	/**
	 * Child File objects from glob expansion.
	 * - `null` for leaf files (not a glob — including glob-looking names that
	 *   `#resolve` found to exist literally on disk)
	 * - `File[]` for globs (may be empty if no matches)
	 * @returns {File[] | null}
	 */
	get children () {
		let value = null;

		if (this.glob && this.context) {
			let cwd = this.context.cwd || ".";

			// Glob expansion — all matches become children
			value = globSync(this.glob, { cwd, withFileTypes: true })
				.filter(entry => entry.isFile())
				.map(entry => {
					let full = path.join(entry.parentPath, entry.name);
					let fn = path.relative(cwd, full);
					let child = File.get({ filename: fn }, this.context);
					child.parent = this;
					child.literal = true;
					return child;
				});
		}

		Object.defineProperty(this, "children", { value, writable: true, configurable: true });
		if (value) {
			this.debug.children = value.length;
		}
		return value;
	}

	/**
	 * Number of files this File represents.
	 * 1 for leaf files, children.length for parents.
	 */
	get length () {
		return this.children?.length ?? 1;
	}

	/**
	 * Array of contents from children (for parents) or just this file's contents (for leaves).
	 * @returns {Array}
	 */
	toArray () {
		if (this.glob) {
			return this.children.map(c => c.contents);
		}
		return [this.contents];
	}

	/**
	 * Object mapping names to contents. Leverages the JSON.stringify protocol —
	 * JSON.stringify(file) produces this object.
	 * @returns {Object}
	 */
	toJSON () {
		if (this.glob) {
			return Object.fromEntries(this.children.map(c => [c.name, c.contents]));
		}
		return { [this.name]: this.contents };
	}

	/** @param {boolean} [debug] Record the resolved value into `this.debug` (for dry-run output). */
	#getMemoizedOrInherit (prop, debug = false) {
		let value = this.source[prop] ? this.resolveValue(this.source[prop]) : this.parent?.[prop];

		if (this.source[prop]) {
			Object.defineProperty(this, prop, { value, writable: true, configurable: true });
		}

		if (debug && value) {
			this.debug[prop] = value;
		}

		return value;
	}

	/**
	 * Optional stable key for this file, used by `resultType: "object"` where a
	 * glob has no single name. Inherited by glob children like schema/description
	 * — on a child it names the input family it came from.
	 */
	get id () {
		return this.#getMemoizedOrInherit("id");
	}

	get description () {
		return this.#getMemoizedOrInherit("description", true);
	}

	get schema () {
		return this.#getMemoizedOrInherit("schema", true);
	}

	/**
	 * Optional per-output transform. Receives the task's main result and returns
	 * the data to write for this file. Returning `null` skips writing this file;
	 * returning `undefined` falls back to the main result.
	 */
	get handleResult () {
		return this.source?.handleResult;
	}

	/**
	 * Apply this file's `handleResult` to the task result, returning the data to write.
	 * Owns the null-skips / undefined-falls-back contract so every write path (the base
	 * task loop, LLM streaming) applies it identically. Returns `null` to signal "skip".
	 * @param {*} result The task's main result.
	 */
	process (result) {
		if (!this.handleResult) {
			return result;
		}
		let data = this.handleResult(result);
		// null is the skip signal; only undefined falls back to the main result.
		return data === null ? null : (data ?? result);
	}

	/**
	 * If truthy, this file's data can be paginated when the task sets `itemsPerPage`.
	 * - `true` means the top-level value is the array.
	 * - An array of strings (e.g. `["responses", "items"]`) is a property path to the nested array.
	 */
	get paginate () {
		return this.#getMemoizedOrInherit("paginate", true);
	}

	/**
	 * Whether this file is a temporary intermediate (e.g. a batch slice output)
	 * that should be deleted after its contents are merged into the parent's output.
	 * This is a file lifecycle marker, not a general scoping system.
	 * A broader file scope mechanism (survey-wide, per-question, per-task) could
	 * supersede this in the future if more granular cleanup/caching policies are needed.
	 */
	get temporary () {
		return this.#getMemoizedOrInherit("temporary");
	}

	/**
	 * Whether this file may be absent on disk. If true and the file does not exist,
	 * it is dropped from the task's `input` array entirely. No-op for globs, which
	 * already degrade gracefully (an unmatched glob expands to zero children).
	 */
	get optional () {
		return this.#getMemoizedOrInherit("optional");
	}

	/**
	 * Normalizes the two schema formats (`{ type: "array" }` vs `{ schema: { type: "array" } }`)
	 * to a plain type string.
	 */
	get schemaType () {
		return this.schema?.schema?.type ?? this.schema?.type;
	}

	#contents = {};
	get contents () {
		if (this.glob) {
			return;
		}

		if ("value" in this.#contents) {
			return this.#contents.value;
		}

		if ("pending" in this.#contents) {
			return this.#contents.pending;
		}

		let ret = this.resolveValue(this.source?.contents);

		// Fallback: read from disk if no contents provided and file has a path
		if (ret == null && (this.filename || this.name)) {
			ret = this.readSync();
		}

		if (typeof ret?.then === "function") {
			// Async, update when resolved
			return (this.#contents.pending = ret.then(resolvedContents => {
				delete this.#contents.pending;
				return (this.#contents.value = this.resolveValue(resolvedContents));
			}));
		}

		return (this.#contents.value = ret);
	}

	/** Check if this file exists on disk. */
	exists () {
		return existsSync(this.path);
	}

	/**
	 * Read this file from disk and parse it via its format.
	 */
	readSync () {
		let { format } = this;
		let raw = File.readSync(this.path, this.format.binary);
		return format.parse(raw);
	}

	/**
	 * Read a file from disc
	 * @param {string} path
	 * @param {boolean} [binary] Whether the file is binary or text.
	 * If not provided, it is auto-detected:
	 * bytes containing a null byte → binary, otherwise text
	 * @returns {Buffer | string} string if text, Buffer if binary
	 */
	static readSync (path, binary) {
		if (binary === false) {
			return readFileSync(path, "utf8");
		}

		let buffer = readFileSync(path);

		if (binary === undefined) {
			// Auto-detect binary vs text:
			return buffer.includes(0) ? buffer : buffer.toString("utf8");
		}

		return buffer;
	}

	/**
	 * Write data to this file on disk via its format.
	 * Updates the contents cache and returns the serialized byte length.
	 * @param {*} data
	 * @returns {number | undefined} byte length of the written content
	 */
	write (data) {
		let contents = this.format.serialize(data);
		mkdirSync(path.dirname(this.path), { recursive: true });
		writeFileSync(this.path, contents);
		this.#contents.value = data;
		return contents?.length;
	}

	/** Remove this file from disk. */
	delete () {
		rmSync(this.path, { force: true });
		delete this.#contents.value;
	}

	/** MIME type for this file, from its format. */
	get mimeType () {
		return this.format.mimeType;
	}

	/** Serialize contents to string using the file's format. Binary formats throw — use {@link toBlob} instead. */
	toString () {
		let contents = this.contents;

		if (typeof contents === "string") {
			return contents;
		}

		let { format } = this;

		if (format.binary) {
			throw new Error(
				`toString() is not supported for binary format ".${this.extension}". Use toBlob() instead.`,
			);
		}

		return format.serialize(contents);
	}

	/**
	 * Get a Blob representation of this file's contents with its MIME type, suitable for upload.
	 * Strings and Buffers pass through unchanged; other types go through the format's `serialize`.
	 */
	toBlob () {
		let { format } = this;
		let data = this.contents;
		let serialized =
			typeof data === "string" || Buffer.isBuffer(data) ? data : format.serialize(data);
		return new Blob([serialized], { type: format.mimeType });
	}

	/** @return {{glob: string | null, filename: string | undefined, name: string | undefined, extension: string | undefined}} */
	static resolveString (value) {
		if (typeof value !== "string") {
			return value;
		}

		let source = { glob: null, filename: undefined, name: undefined, extension: undefined };

		let ext = value.match(/\.([^\/]+)$/)?.[1];

		if (isGlob(value)) {
			source.glob = value;

			// Has extension?
			if (!ext) {
				source.glob += ".json";
			}
		}
		else {
			if (ext) {
				source.filename = value;
				source.name = path.basename(value, "." + ext);
				source.extension = ext ?? "json";
			}
			else {
				source.name = value;
				source.extension = "json";
				source.filename = source.name + "." + source.extension;
			}
		}

		return source;
	}

	static overrideSource (source, override) {
		if (!override) {
			return source;
		}

		let resolvedOverride = this.resolveString(override);

		if (!source || typeof source === "string") {
			return resolvedOverride;
		}

		if (source.contents) {
			delete source.contents;
		}

		return { ...source, ...resolvedOverride };
	}

	/**
	 * Convert an object, function, or string to a File object if it's not already one.
	 * @param {File | object | function | string} source
	 * @param {Task} [context ]
	 * @returns {File}
	 */
	static get (source, context) {
		if (source instanceof File) {
			if (!context || source.context === context) {
				// No context or same context
				return source;
			}

			// Clone when context differs to avoid shared mutable state
			let raw = typeof source.source === "object" ? { ...source.source } : source.source;
			let file = new this(raw, context);
			file.producer = source.producer;
			return file;
		}

		return new this(source, context);
	}
}
