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
			? value.call(this.context, this.context?.question)
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

	get schema () {
		return this.source.schema;
	}

	get suffix () {
		return this.resolveValue(this.source.suffix) ?? "";
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

		return info;
	}

	/**
	 * Convert an object, function, or string to a File object if it's not already one.
	 * @param {File | object | function | string} source
	 * @param {Task} [context ]
	 * @returns {File}
	 */
	static get (source, context) {
		let file = source instanceof File ? source : new File(source, context);

		if (context) {
			file.context = context;
		}
		return file;
	}
}
