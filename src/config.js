import { importCwd } from "./util.js";
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

		// Configs may contribute additional options to the global schema.
		this.availableOptions = mergeSchemas(availableOptions, spec.options ?? {});
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
