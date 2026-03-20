import { importCwd } from "./util.js";

const DEFAULT_CONFIG_FILE = "qualve.config.js";

/**
 * Resolves a config source to a plain config object.
 * - undefined: auto-discovers `qualve.config.js` in process.cwd()
 * - string: imports the file at that path (relative to cwd)
 * - object: used as-is
 * @param {string | object | undefined} source
 * @returns {Promise<object>}
 */
export async function resolveConfig (source) {
	let wasConfigProvided = !!source;
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
