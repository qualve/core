import { existsSync, globSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { addFilenameSuffix, getExtension, readJSONSync, writeJSONSync, isGlob } from "./util.js";

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

	constructor (source, context) {
		this.source = source;
		this.context = context;
	}

	#resolve (prop) {
		if (!this.source) {
			return;
		}

		let source;

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

			if (!source.glob) {
				if (!source.filename && !source.name) {
					source.name = this.context?.id;
				}

				if (source.name) {
					source.filename ??= source.name + "." + (source.extension ?? "json");
				}

				if (this.suffix) {
					source.filename = addFilenameSuffix(source.filename, this.suffix);
				}

				source.extension ??= getExtension(source.filename)?.slice(1) ?? "json";
				source.name ??= source.filename.slice(0, -source.extension.length - 1);
			}
		}

		this.resolvedSource = source;
		Object.defineProperties(this, Object.getOwnPropertyDescriptors(source));

		return source[prop];
	}

	resolveValue (value) {
		return typeof value === "function"
			? value.call(this.context, this.context?.entity)
			: value;
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

	get suffix () {
		return this.#getMemoizedOrInherit("suffix");
	}

	get filePath () {
		if (this.glob) {
			return;
		}

		let value = path.join(this.context?.cwd ?? "", this.filename);
		Object.defineProperty(this, "filePath", { value, writable: true, configurable: true });
		return value;
	}

	/** Alias for filePath. */
	get path () {
		return this.filePath;
	}

	/**
	 * Child File objects from glob expansion.
	 * - `null` for leaf files (not a glob)
	 * - `File[]` for globs (may be empty if no matches)
	 * Tries the literal filename first (in case special chars aren't actually glob syntax),
	 * then falls back to glob expansion.
	 * @returns {File[] | null}
	 */
	get children () {
		let value;

		if (!this.glob || !this.context) {
			value = null;
		}
		else {
			let cwd = this.context.cwd || ".";

			// Try literal path first — a filename with special chars (e.g., `report[1].json`)
			// may not actually be a glob
			if (existsSync(path.join(cwd, this.glob))) {
				this.glob = null;
				this.literal = true;
				value = null;
			}
			else {
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
		}

		Object.defineProperty(this, "children", { value, writable: true, configurable: true });
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

	#getMemoizedOrInherit (prop) {
		if (this.source[prop]) {
			let value = this.resolveValue(this.source[prop]);
			Object.defineProperty(this, prop, { value, writable: true, configurable: true });
			return value;
		}

		return this.parent?.[prop];
	}

	get description () {
		return this.#getMemoizedOrInherit("description");
	}

	get schema () {
		return this.#getMemoizedOrInherit("schema");
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
	 * If truthy, this file's data can be paginated when the task sets `itemsPerPage`.
	 * - `true` means the top-level value is the array.
	 * - An array of strings (e.g. `["responses", "items"]`) is a property path to the nested array.
	 */
	get paginate () {
		return this.#getMemoizedOrInherit("paginate");
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

	/** Whether this file should be re-uploaded fresh, bypassing the provider cache. */
	get fresh () {
		return this.#getMemoizedOrInherit("fresh");
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
			ret = this.extension === "json" ? readJSONSync(this.path) : readFileSync(this.path, "utf8");
		}

		if (typeof ret?.then === "function") {
			// Async, update when resolved
			return this.#contents.pending = ret.then(resolvedContents => {
				delete this.#contents.pending;
				return this.#contents.value = this.resolveValue(resolvedContents);
			});
		}

		return this.#contents.value = ret;
	}

	/** Check if this file exists on disk. */
	exists () {
		return existsSync(this.path);
	}

	/**
	 * Write data to this file on disk.
	 * Updates the contents cache and returns the serialized byte length.
	 * @param {*} data
	 * @returns {number | undefined} byte length of the written content
	 */
	write (data) {
		let size = writeJSONSync(this.path, data)?.length;
		this.#contents.value = data;
		return size;
	}

	/** Remove this file from disk. */
	delete () {
		rmSync(this.path, { force: true });
		delete this.#contents.value;
	}

	/** Serialize contents to string. For JSON files, returns JSON.stringify. */
	toString () {
		let contents = this.contents;
		return typeof contents === "string" ? contents : JSON.stringify(contents);
	}

	debugInfo () {
		let info = {};

		if (this.glob) {
			info.glob = this.glob;
			info.children = this.children?.length ?? 0;
		}
		else {
			info.name = this.name;
			info.filename = this.filename;
			info.filePath = this.filePath;

			if (this.parent) {
				info.glob = this.parent.glob;
			}
		}

		if (this.description) {
			info.description = this.description;
		}

		if (this.schema) {
			info.schema = this.schema;
		}

		if (this.paginate) {
			info.paginate = this.paginate;
		}

		return info;
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
			source = typeof source.source === "object" ? { ...source.source } : source.source;
		}

		return new this(source, context);
	}
}
