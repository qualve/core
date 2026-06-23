import { importCwd } from "./util.js";
import Model from "./model.js";
import availableOptions, { mergeSchemas } from "./options.js";

const DEFAULT_CONFIG_FILE = "qualve.config.js";

export default class Config {
	constructor (spec) {
		this.spec = spec;

		for (let key in spec) {
			if (!(key in this)) {
				this[key] = spec[key];
			}
		}

		if (this.model) {
			this.model = Object.fromEntries(
				Object.entries(this.model).map(([name, entry]) => [name, new Model(name, entry)]),
			);
		}

		// Build the available-options schema for this config: the global base plus
		// any per-model `option` entries, deep-merged per field (so a model option
		// that shares a name with a global one only overrides the fields it sets).
		// Localized here because the model→option mapping is a temporary special case
		// — once entity model collapses into a regular options layer (see qualve/core#8
		// future work), this whole block goes away.
		let modelOptions = {};
		for (let name in this.model ?? {}) {
			let model = this.model[name];
			let opt = model.option;
			if (opt) {
				// Attach the model's validator so the CLI's generic "Did you mean…?" path picks it up.
				opt.validate = model.validate.bind(model);
				modelOptions[name] = opt;
			}
		}
		this.availableOptions = mergeSchemas(availableOptions, modelOptions);
	}

	/** Get config instance from source
	 * @param {string | object | Config} source
	 */
	static async from (source) {
		if (source instanceof this) {
			return source;
		}

		let spec = await this.resolveConfig(source);
		return new this(spec);
	}

	/**
	 * Resolves a config source to a plain config object.
	 * - undefined: auto-discovers `qualve.config.js` in process.cwd()
	 * - string: imports the file at that path (relative to cwd)
	 * - object: used as-is
	 * @param {string | object | undefined} source
	 * @returns {Promise<object>}
	 */
	static async resolveConfig (source) {
		if (source === null) {
			return null;
		}

		let wasConfigProvided = !!source;

		if (typeof source === "object") {
			return source;
		}

		source ??= DEFAULT_CONFIG_FILE;

		if (typeof source === "string") {
			try {
				return await importCwd(source);
			}
			catch (e) {
				if (wasConfigProvided) {
					// If user provides a config explicitly, we want to throw if it's not found
					throw new Error(`Could not load config from "${source}": ${e.message}`, {
						cause: e,
					});
				}
			}
		}

		return {};
	}
}
