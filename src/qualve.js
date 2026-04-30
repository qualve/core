import { Task } from "./index.js";
import Config from "./config.js";
import { findValue } from "./options.js";

/**
 * Programmatic entrypoint for running a qualve task.
 * Splits entity IDs (keys matching `config.model`) from the rest of the options;
 * passes the rest unresolved into Task.fromId, where the per-level option chain
 * (defined in src/options.js) does the actual resolution inside Task.create / the constructor.
 * @param {string} taskId - The task ID to run
 * @param {object} [options] - Flat options object (entity IDs as arrays, config, dryRun, force, declared task options, etc.)
 * @returns {Promise<*>} The task result
 */
export default async function qualve (taskId, { config: configSource, ...options } = {}) {
	let config = await Config.from(configSource);

	// Extract entity IDs (keys matching a config.model entry, looked up via the model's
	// option schema so aliases like `--q` and kebab-case work). They flow into Task.fromId
	// via the dedicated entityIds arg; everything else flows through the rest object
	// for the chain to resolve.
	let entityIds = {};
	let rest = { ...options };

	for (let name in config.model ?? {}) {
		let modelOpt = config.model[name].option ?? {};
		let [aliasUsed, value] = findValue(options, name, modelOpt);
		if (aliasUsed && value !== undefined) {
			entityIds[name] = value;
			delete rest[aliasUsed];
		}
	}

	for (let key of Object.keys(rest)) {
		if (rest[key] === undefined) {
			delete rest[key];
		}
	}

	// Validate that scoped tasks have explicit entity IDs
	let resolved = await Task.resolve(taskId);
	let scopes = Task.getScopes(resolved.subtasks ?? resolved);

	for (let scope of scopes) {
		let model = config.model?.[scope];
		if (model?.multiple && !entityIds[scope]) {
			throw new Error(
				`Entity IDs required for scope "${scope}". Available: ${model.ids.join(", ")}`,
			);
		}
	}

	let task = await Task.fromId(taskId, { entityIds, config, ...rest });

	return task.run();
}
