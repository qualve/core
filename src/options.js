// L1: global options. Frozen — extension happens via mergeSchemas in assembleOptions, not mutation.
const availableOptions = Object.freeze({
	taskId: {
		long: "task",
		positional: true,
		description: "Task to run",
	},
	config: {
		short: "c",
		description: "Path to config file",
	},
	force: {
		default: false,
		short: "f",
		description: "Force overwrite of existing output",
	},
	dryRun: {
		long: "dry-run",
		description: "Preview changes without writing files",
	},
	itemsPerPage: {
		long: "items-per-page",
		short: "pp",
		parse: Number,
		// 0 disables batching (overrides task-level default)
		validate: v => Number.isInteger(v) && v >= 0,
		description: "Number of items per batch (0 to disable)",
	},
	fresh: {
		default: false,
		description: "Ignore cached data and reprocess",
	},
	input: {
		short: "i",
		description: "Input file or directory",
	},
	output: {
		short: "o",
		description: "Output file or directory",
	},
	help: {
		description: "Show this help message",
	},
});

/** camelCase → kebab-case */
function camelToKebab (s) {
	return s.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
}

/**
 * Find a value in `bag` for the given option, trying every alias the user might type:
 * canonical key, option.long, option.short, and the camelCase→kebab-case variant.
 * Returns [aliasUsed, value] or [null, undefined] if not found.
 */
export function findValue (bag, key, option) {
	if (key in bag) {
		return [key, bag[key]];
	}
	if (option.long && option.long in bag) {
		return [option.long, bag[option.long]];
	}
	if (option.short && option.short in bag) {
		return [option.short, bag[option.short]];
	}
	let kebab = camelToKebab(key);
	if (kebab !== key && kebab in bag) {
		return [kebab, bag[kebab]];
	}
	return [null, undefined];
}

/**
 * Resolve a single value against a single option schema.
 * Functions pass through unchanged (same idiom as task.output / task.input — caller decides when to call).
 * Strings run through `option.parse` if declared.
 * Throws on parse-NaN, `values` mismatch, or `validate` returning false.
 */
export function resolveValue (option, value) {
	if (typeof value === "function") {
		return value;
	}

	let name = "--" + (option.long ?? camelToKebab(option.key ?? "(unknown)"));

	if (typeof value === "string" && option.parse) {
		let parsed = option.parse(value);
		if (option.parse === Number && Number.isNaN(parsed)) {
			throw new Error(`Invalid value for ${name}: expected a number, got ${JSON.stringify(value)}`);
		}
		value = parsed;
	}

	if (option.values !== undefined) {
		let ok;
		if (Array.isArray(option.values)) {
			ok = option.values.includes(value);
		}
		else if (option.values instanceof RegExp) {
			ok = typeof value === "string" && option.values.test(value);
		}
		else {
			throw new Error(
				`Invalid 'values' constraint on option ${name}: must be array or RegExp, got ${typeof option.values}`,
			);
		}
		if (!ok) {
			let allowed = Array.isArray(option.values)
				? option.values.map(v => JSON.stringify(v)).join(", ")
				: option.values.toString();
			throw new Error(
				`Invalid value for ${name}: ${JSON.stringify(value)}. Allowed: ${allowed}`,
			);
		}
	}

	if (option.validate && !option.validate(value)) {
		throw new Error(`Invalid value for ${name}: ${JSON.stringify(value)}`);
	}

	return value;
}

/**
 * Resolve a schema against an input bag, with optional per-task default fields.
 * Resolution order per option: input bag → taskFields → schema's static `default`.
 * @param {object} schema - Map of optionKey → option definition
 * @param {object} input - Raw bag of values (from CLI or programmatic API)
 * @param {object} taskFields - Task-definition fields acting as per-task defaults
 * @returns {{resolved: object, claimed: Set<string>}} resolved values and the set of input bag keys consumed
 */
export function resolveOptions (schema, input = {}, taskFields = {}) {
	let resolved = {};
	let claimed = new Set();

	for (let key in schema) {
		let option = schema[key];
		option.key ??= key;

		let [aliasUsed, externalValue] = findValue(input, key, option);

		if (externalValue !== undefined) {
			resolved[key] = resolveValue(option, externalValue);
			claimed.add(aliasUsed);
		}
		else if (key in taskFields && taskFields[key] !== undefined) {
			// Task-def field as per-task default. Doesn't claim any input alias.
			resolved[key] = resolveValue(option, taskFields[key]);
		}
		else if ("default" in option) {
			// Schema's static default passes through unvalidated (author-asserted).
			resolved[key] = option.default;
		}
	}

	return { resolved, claimed };
}

/**
 * Deep-merge two schema objects: child wins per field, parent fills missing fields.
 * E.g., parent declares { description }, child declares { default, values } →
 * merged keeps the parent's description and adds child's default + values.
 */
export function mergeSchemas (parent, child) {
	let out = { ...parent };
	for (let key in child) {
		out[key] = parent[key] ? { ...parent[key], ...child[key] } : { ...child[key] };
	}
	return out;
}

/**
 * Assemble the full schema for a (task, config) pair.
 * Walks: L1 (global) → L2 (config.model[*].option) → L3 (the supplied class chain)
 * → L4 (task.options field). Used for --help printing and inside the Task constructor.
 *
 * The caller is responsible for supplying `classChain` — usually either via
 * `Task.getSubclassChain(task, input)` (when no instance exists yet) or by walking
 * `this.constructor`'s prototype chain (when called from inside a Task constructor).
 * @param {object} task - The task definition
 * @param {object} ctx - { config, classChain }
 */
export function assembleOptions (task, { config, classChain = [] } = {}) {
	let schema = { ...availableOptions };

	if (config?.model) {
		for (let name in config.model) {
			let modelOpt = config.model[name].option;
			if (modelOpt) {
				schema = mergeSchemas(schema, { [name]: modelOpt });
			}
		}
	}

	for (let cls of classChain) {
		if (cls.options) {
			schema = mergeSchemas(schema, cls.options);
		}
	}

	if (task?.options) {
		schema = mergeSchemas(schema, task.options);
	}

	return schema;
}

export default availableOptions;
