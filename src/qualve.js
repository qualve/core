import { Task } from "./index.js";
import Config from "./config.js";

/**
 * Programmatic entrypoint: resolve a task reference under the effective config and run it.
 * This is the orchestrator — it owns the config (defaulting to `qualve.config.js`, or a bare
 * default if none) and resolves an id/query to a path; Task only ever loads paths.
 * For construction without running (e.g. to read `task.optionsSchema`), resolve the path via
 * `config.resolveTask` and call `Task.fromPath` directly.
 * @param {string | object} ref A task id/query, or an inline task definition
 * @param {object} [opts] Option values, plus `config` (a path, spec, or Config instance)
 */
export default async function qualve (ref, { config, ...options } = {}) {
	config = await Config.from(config, options);

	if (!ref) {
		throw new Error(`No task provided. Available tasks: ${config.taskIds.join(", ")}`);
	}

	// Config resolves a query to a path; an inline definition object skips resolution.
	let source = typeof ref === "string" ? config.resolveTask(ref) : ref;
	let task = await Task.fromPath(source, { config, ...options });
	return task.run();
}
