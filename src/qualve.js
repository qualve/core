import { Task } from "./index.js";

/**
 * Programmatic entrypoint: construct a task by id and run it.
 * For construction without running (e.g., to read `task.optionsSchema`), call `Task.fromId` directly.
 */
export default async function qualve (taskId, opts) {
	let task = await Task.fromId(taskId, opts);
	return task.run();
}
