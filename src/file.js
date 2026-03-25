import path from "node:path";
import { addFilenameSuffix, getExtension } from "./util.js";

export default class File {
	#source;
	context;

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

	get description () {
		return this.resolveValue(this.source.description);
	}

	#contents = {};
	get contents () {
		if ("value" in this.#contents) {
			return this.#contents.value;
		}

		if ("pending" in this.#contents) {
			return this.#contents.pending;
		}

		let ret = this.resolveValue(this.source?.contents);

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
