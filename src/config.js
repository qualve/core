import { globSync } from "node:fs";
import { join, relative } from "node:path";
import { importCwd } from "./util.js";
import availableOptions, { mergeSchemas, resolveOptions } from "./options.js";
import { resolveTask, taskId } from "./task-discovery.js";

const DEFAULT_CONFIG_FILE = "qualve.config.js";

export default class Config {
	/**
	 * @param {object} spec Config file contents
	 * @param {object} [options] Normalized option values (see Config.from), stored as-is
	 */
	constructor (spec, options = {}) {
		this.spec = spec;

		for (let key in spec) {
			if (!(key in this)) {
				this[key] = spec[key];
			}
		}

		// Configs may contribute additional options to the global schema.
		this.availableOptions = mergeSchemas(availableOptions, spec.options ?? {});

		// Option values arrive already resolved through the pipeline (Config.from); just store them.
		Object.assign(this, options);
	}

	/**
	 * Paths of all task files this config can see (its `tasks` globs decide which
	 * extensions qualify). Computed on first access, then overwrites itself —
	 * task files added later in the process are not picked up.
	 * @type {string[]} CWD-relative paths
	 */
	get taskPaths () {
		let { include, exclude } = this.tasks;

		// Directories are never tasks — broad patterns like `tasks/**` also match them.
		// Paths are normalized to /-separated.
		let paths = globSync(include, { exclude, withFileTypes: true })
			.filter(entry => entry.isFile())
			.map(entry =>
				relative(process.cwd(), join(entry.parentPath, entry.name))
					.split(/[\\/]/)
					.join("/"));

		Object.defineProperty(this, "taskPaths", { value: paths });
		return paths;
	}

	/** Ids of all tasks this config can see, sorted. @type {string[]} */
	get taskIds () {
		return this.taskPaths.map(path => this.taskId(path)).sort();
	}

	/**
	 * Resolve a task query to the path of the single closest matching task.
	 * @param {string} query
	 * @returns {string}
	 * @throws If no task matches, or several match equally well
	 */
	resolveTask (query) {
		return resolveTask(query, this.taskPaths);
	}

	/**
	 * The id of a task under this config: the shortest query that uniquely identifies it.
	 * @param {string} path
	 * @returns {string}
	 */
	taskId (path) {
		return taskId(path, this.taskPaths);
	}

	/** Get config instance from source
	 * @param {string | object | Config} source
	 * @param {object} [overrides] Raw option values from CLI/programmatic args, highest precedence
	 */
	static async from (source, overrides) {
		if (source instanceof this) {
			return source;
		}

		let spec = await this.resolveConfig(source);

		// Resolve the config options (those marked `config: true`) through the options
		// pipeline — override (CLI/programmatic) > config file > default — so they reach the
		// constructor normalized. Task options are left to resolve per-run at task construction.
		let schema = mergeSchemas(availableOptions, spec?.options ?? {});
		let configSchema = {};
		for (let key in schema) {
			if (schema[key].config) {
				configSchema[key] = schema[key];
			}
		}
		let { resolved } = resolveOptions(configSchema, overrides, spec ?? {});

		return new this(spec, resolved);
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
