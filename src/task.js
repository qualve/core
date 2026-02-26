import Task, * as TaskTypes from "./types/index.js";
import * as LLMProviders from "./llms/index.js";

// Inject provider map into LLMTask.create to avoid a circular import:
// src/types/llm.js → src/llms/index.js → providers → src/types/llm.js
TaskTypes.llm.providers = LLMProviders;

/**
 * Override Task.create to dispatch to the right subclass factory.
 * Types that define their own static create() (like LLMTask) use it for custom factory logic.
 * Types that don't (DataTask, GraphQLTask) fall through to new Type(), which is what
 * the base Task.create does — but we can't call Type.create() on those or we'd recurse
 * infinitely through the inherited dispatch.
 */
Task.create = function (task, ...args) {
	let Type = TaskTypes[task.type] ?? Task;
	if (Type.create !== this.create) {
		// Delegate to subclass factory
		return Type.create(task, ...args);
	}

	return new Type(task, ...args);
};

export default Task;
