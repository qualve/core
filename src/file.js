import { existsSync, globSync, rmSync } from "node:fs";
import path from "node:path";
import { addFilenameSuffix, getExtension, readJSONSync, writeJSONSync } from "./util.js";

export default class File {
	#source;
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

	get source () {
		if (this.parent) {
			let { name, filename, contents, ...inherited } = this.parent.source;
			return { ...inherited, ...this.#source };
		}
		return this.#source;
	}
	set source (source) {
		if (!source) {
			return;
		}

		if (typeof source === "object") {
			this.#source = { ...source };
		}
		else {
			let type = getExtension(source) ? "filename" : "name";
			this.#source = { [type]: source };
		}
	}

	resolveValue (value) {
		return typeof value === "function"
			? value.call(this.context, this.context?.entity)
			: value;
	}

	get name () {
		let value;

		if (this.source.name) {
			value = this.resolveValue(this.source.name);
		}
		else if (this.source.filename) {
			// Safe to call this.filename here — when source.filename is set,
			// the filename getter returns directly without calling name.
			let { name, ext } = path.parse(this.filename);
			value = ext ? name : this.filename;
		}
		else if (this !== this.context?.input?.[0]) {
			value = this.context?.input?.[0]?.name;
		}
		else {
			value = this.context?.id;
		}

		Object.defineProperty(this, "name", { value, writable: true, configurable: true });
		return value;
	}

	get filename () {
		let value;

		if (this.source.filename) {
			value = this.resolveValue(this.source.filename);

			if (this.suffix) {
				value = addFilenameSuffix(value, this.suffix);
			}
		}
		else {
			value = this.name + this.suffix + ".json";
		}

		Object.defineProperty(this, "filename", { value, writable: true, configurable: true });
		return value;
	}

	get filePath () {
		let value = path.join(this.context?.cwd ?? "", this.filename);
		Object.defineProperty(this, "filePath", { value, writable: true, configurable: true });
		return value;
	}

	/** Alias for filePath. */
	get path () {
		return this.filePath;
	}

	/**
	 * The glob pattern for this file, or null if not a glob.
	 * Can be set explicitly in source (`{ glob: "coding-*" }`) or auto-detected
	 * from string sources (which become source.name).
	 * Object sources should use `glob` instead of putting patterns in `filename`.
	 * @returns {string | null}
	 */
	get glob () {
		let value = null;

		if (!this.literal) {
			// Explicit glob in source, or auto-detect from source.name (string sources only).
			// source.filename is always treated as literal — use source.glob for object definitions.
			value = this.source?.glob
				?? (this.source?.name && /(?<!\\)[*?\[{]/.test(this.source.name) ? this.filename : null);
		}

		Object.defineProperty(this, "glob", { value, writable: true, configurable: true });
		return value;
	}

	/**
	 * Child File objects from glob expansion.
	 * - `null` for leaf files (not a glob)
	 * - `[]` for globs that matched 0-1 files (collapsed)
	 * - `File[]` for globs with multiple matches
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
			if (existsSync(path.join(cwd, this.filename))) {
				value = [];
			}
			else {
				// Literal doesn't exist — try glob expansion
				let matches = globSync(this.glob, { cwd, withFileTypes: true })
					.filter(entry => entry.isFile())
					.map(entry => {
						let full = path.join(entry.parentPath, entry.name);
						return path.relative(cwd, full);
					});

				if (matches.length <= 1) {
					// Collapse: adopt matched filename, no children
					if (matches.length === 1) {
						Object.defineProperty(this, "filename", { value: matches[0], writable: true, configurable: true });
						this.literal = true;
					}
					value = [];
				}
				else {
					// Multiple matches → create child Files
					value = matches.map(fn => {
						let child = File.get({ filename: fn }, this.context);
						child.parent = this;
						child.literal = true;
						return child;
					});
				}
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
		if (this.children?.length > 0) {
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
		if (this.children?.length > 0) {
			return Object.fromEntries(this.children.map(c => [c.name, c.contents]));
		}
		return { [this.name]: this.contents };
	}

	get description () {
		let value = this.resolveValue(this.source.description);
		Object.defineProperty(this, "description", { value, writable: true, configurable: true });
		return value;
	}

	#contents = {};
	get contents () {
		// Files with children don't have their own contents
		if (this.children?.length > 0) {
			return undefined;
		}

		if ("value" in this.#contents) {
			return this.#contents.value;
		}

		if ("pending" in this.#contents) {
			return this.#contents.pending;
		}

		let ret = this.resolveValue(this.source?.contents);

		// Fallback: read from disk if no contents provided and file has a path
		if (ret == null && (this.source?.filename || this.source?.name)) {
			ret = readJSONSync(this.path);
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

	get schema () {
		return this.source.schema;
	}

	/**
	 * Normalizes the two schema formats (`{ type: "array" }` vs `{ schema: { type: "array" } }`)
	 * to a plain type string.
	 */
	get schemaType () {
		return this.schema?.schema?.type ?? this.schema?.type;
	}

	/** Whether this file should be re-uploaded fresh, bypassing the provider cache. */
	get fresh () {
		return this.source.fresh;
	}

	get suffix () {
		let value = this.resolveValue(this.source.suffix) ?? "";
		Object.defineProperty(this, "suffix", { value, writable: true, configurable: true });
		return value;
	}

	/**
	 * If truthy, this file's data can be paginated when the task sets `itemsPerPage`.
	 * - `true` means the top-level value is the array.
	 * - An array of strings (e.g. `["responses", "items"]`) is a property path to the nested array.
	 */
	get paginate () {
		return this.source.paginate ?? false;
	}

	/**
	 * Whether this file is a temporary intermediate (e.g. a batch slice output)
	 * that should be deleted after its contents are merged into the parent's output.
	 * This is a file lifecycle marker, not a general scoping system.
	 * A broader file scope mechanism (survey-wide, per-question, per-task) could
	 * supersede this in the future if more granular cleanup/caching policies are needed.
	 */
	get temporary () {
		return this.source.temporary ?? false;
	}

	/** Serialize contents to string. For JSON files, returns JSON.stringify. */
	toString () {
		let contents = this.contents;
		return typeof contents === "string" ? contents : JSON.stringify(contents);
	}

	debugInfo () {
		let info = {
			name: this.name,
			filename: this.filename,
			filePath: this.filePath,
		};

		if (this.parent) {
			info.glob = this.parent.glob;
		}
		else if (this.glob) {
			info.glob = this.glob;
		}

		if (this.children?.length > 0) {
			info.children = this.children.length;
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

	/**
	 * Convert an object, function, or string to a File object if it's not already one.
	 * @param {File | object | function | string} source
	 * @param {Task} [context ]
	 * @returns {File}
	 */
	static get (source, context) {
		if (source instanceof File) {
			if (!context || source.context === context) {
				return source;
			}

			// Clone when context differs to avoid shared mutable state
			return new this(source.source, context);
		}

		return new this(source, context);
	}
}
