import Task from "./index.js";
import Config from "./config.js";
import { resolveOptions } from "./options.js";

/**
 * Programmatic entrypoint for running a qualve task.
 * @param {string} taskId - The task ID to run
 * @param {object} [options] - Flat options object (entity IDs as arrays, config, dryRun, force, etc.)
 * @returns {Promise<*>} The task result
 */
export default async function qualve (taskId, { config: configSource, ...options } = {}) {
	let config = await Config.from(configSource);

	options = resolveOptions(options);

	// Separate entity IDs from other options using config.model keys
	let entityIds = {};
	let overrides = {};

	for (let key in options) {
		if (options[key] !== undefined && config.model?.[key]) {
			entityIds[key] = options[key];
		}
		else if (options[key] !== undefined) {
			overrides[key] = options[key];
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

	let task = await Task.fromId(taskId, { entityIds, config, ...overrides });

	return task.run();
}
