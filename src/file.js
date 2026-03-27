import { existsSync, globSync } from "node:fs";
import path from "node:path";
import { addFilenameSuffix, getExtension, readJSONSync } from "./util.js";

export default class File {
	#source;
	context;

	/** When true, treat filename literally — no glob expansion. */
	literal = false;

	/** Original glob pattern, set on children and collapsed single-match globs. */
	fromGlob;

	#children; // undefined = not resolved, null = leaf, [] = glob with 0-1 matches, File[] = glob with >1 matches

	constructor (source, context) {
		this.source = source;
		this.context = context;
	}

	get source () {
		return this.#source;
	}
	set source (source) {
		if (!source) {
			return;
		}

		if (typeof source === "object") {
			this.#source = { ...source };
			return;
		}

		let type = getExtension(source) ? "filename" : "name";

		if (this.#source) {
			// Override, we want to preserve schema, description, etc.
			delete this.#source.name;
			delete this.#source.filename;
			this.#source[type] = source;
		}
		else {
			this.#source = { [type]: source };
		}
	}

	resolveValue (value) {
		return typeof value === "function"
			? value.call(this.context, this.context?.entity)
			: value;
	}

	get name () {
		if (this.source.name) {
			return this.resolveValue(this.source.name);
		}

		if (this.source.filename) {
			let { name, ext } = path.parse(this.source.filename);
			return ext ? name : this.source.filename;
		}

		if (this !== this.context?.input?.[0]) {
			return this.context?.input?.[0]?.name;
		}

		return this.context?.id;
	}
	set name (value) {
		this.source.name = value;

		if (this.source.filename) {
			delete this.source.filename;
		}
	}

	get filename () {
		if (this.source.filename) {
			let filename = this.resolveValue(this.source.filename);

			if (this.suffix) {
				filename = addFilenameSuffix(filename, this.suffix);
			}

			return filename;
		}

		return this.name + this.suffix + ".json";
	}
	set filename (value) {
		this.source.filename = value;

		if (this.source.name) {
			delete this.source.name;
		}

		if (this.source.suffix) {
			delete this.source.suffix;
		}
	}

	get filePath () {
		return path.join(this.context?.cwd ?? "", this.filename);
	}

	/** Alias for filePath. */
	get path () {
		return this.filePath;
	}

	/**
	 * Whether this filename looks like a glob pattern.
	 * Based on syntax only (unescaped *, ?, [, {) — does not trigger resolution.
	 * Note: may report true for literal filenames with special chars (e.g., `report[1].json`).
	 * The children getter handles this by trying the literal path first.
	 */
	get isGlob () {
		if (this.literal) {
			return false;
		}
		return /(?<!\\)[*?\[{]/.test(this.filename);
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
		if (this.#children !== undefined) {
			return this.#children;
		}

		if (!this.isGlob || !this.context) {
			this.#children = null;
			return this.#children;
		}

		this.#children = [];

		let cwd = this.context.cwd || ".";

		// Try literal path first — a filename with special chars (e.g., `report[1].json`)
		// may not actually be a glob
		if (existsSync(path.join(cwd, this.filename))) {
			return this.#children;
		}

		// Literal doesn't exist — try glob expansion
		let matches = globSync(this.filename, { cwd, withFileTypes: true })
			.filter(entry => entry.isFile())
			.map(entry => {
				let full = path.join(entry.parentPath, entry.name);
				return path.relative(cwd, full);
			});

		let originalPattern = this.filename;

		if (matches.length <= 1) {
			// Collapse: adopt matched filename (if any), no children
			if (matches.length === 1) {
				this.source = { ...this.source, filename: matches[0] };
				this.fromGlob = originalPattern;
			}
			return this.#children;
		}

		// Multiple matches → create child Files
		this.#children = matches.map(fn => {
			let childSource = { ...this.source, filename: fn };
			let child = File.get(childSource, this.context);
			child.fromGlob = originalPattern;
			child.literal = true;
			return child;
		});

		return this.#children;
	}

	/**
	 * Number of files this File represents.
	 * 1 for leaf files, children.length for parents.
	 */
	get length () {
		return this.children?.length || 1;
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
		return this.resolveValue(this.source.description);
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
		if (ret == null && this.source?.filename) {
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
		return this.resolveValue(this.source.suffix) ?? "";
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

	debugInfo () {
		let info = {
			name: this.name,
			filename: this.filename,
			filePath: this.filePath,
		};

		if (this.fromGlob) {
			info.fromGlob = this.fromGlob;
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
			return new File(source.source, context);
		}

		return new File(source, context);
	}
}
