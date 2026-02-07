import Task, * as TaskTypes from "./types/index.js";

/**
 * Factory method to create the right task subclass based on the task type.
 */
Task.create = function (task, ...args) {
	return new (TaskTypes[task.type] ?? Task)(task, ...args);
};

export default Task;
