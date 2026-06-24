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

/**
 * camelCase → kebab-case, splitting on real word boundaries so acronyms stay together:
 *   "myFlag"     → "my-flag"
 *   "itemsPerPage" → "items-per-page"
 *   "AIFoo"      → "ai-foo"     (acronym kept whole)
 *   "URLPath"    → "url-path"   (acronym kept whole)
 *   "Foo"        → "foo"        (no leading dash from a capitalized first letter)
 *
 * Two zero-width boundaries: non-uppercase → uppercase (entering a new word),
 * or uppercase → uppercase-followed-by-non-uppercase (the last char of an
 * acronym run starts a new capitalized word).
 */
export function camelToKebab (s) {
	return s.replace(/(?<=[^A-Z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][^A-Z])/g, "-").toLowerCase();
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
 * Strings run through `option.parse` if declared.
 * Throws on parse-NaN, `values` mismatch, or `validate` rejecting the value.
 * `validate` may return `true`, `false`, or an array of suggested values; suggestions
 * appear in the error message ("Did you mean…?"). The CLI prompts on suggestions
 * before resolution gets here; programmatic callers see them as a hint.
 *
 * Function values: without `context` they pass through unchanged (caller decides
 * when to call — same idiom as task.output / task.input). With `context`, the
 * function is called with `this` bound to it and the return value flows through
 * the rest of the pipeline.
 */
export function resolveValue (option, value, context) {
	if (typeof value === "function") {
		if (context === undefined) {
			return value;
		}
		value = value.call(context);
	}

	let name = "--" + (option.long ?? camelToKebab(option.key ?? "(unknown)"));

	if (typeof value === "string" && option.parse) {
		let parsed = option.parse(value);
		if (option.parse === Number && Number.isNaN(parsed)) {
			throw new Error(
				`Invalid value for ${name}: expected a number, got ${JSON.stringify(value)}`,
			);
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
			// JSON.stringify quotes string members of the array (so users see "foo", "bar"
			// they can copy/paste); for a RegExp, JSON.stringify returns "{}", so use
			// .toString() to get the canonical /pattern/flags form.
			let allowed = Array.isArray(option.values)
				? option.values.map(v => JSON.stringify(v)).join(", ")
				: option.values.toString();
			throw new Error(
				`Invalid value for ${name}: ${JSON.stringify(value)}. Allowed: ${allowed}`,
			);
		}
	}

	if (option.validate) {
		let result = option.validate(value);
		if (result !== true) {
			let hint =
				Array.isArray(result) && result.length
					? `. Did you mean: ${result.join(", ")}?`
					: "";
			throw new Error(`Invalid value for ${name}: ${JSON.stringify(value)}${hint}`);
		}
	}

	return value;
}

/**
 * Resolve a schema against an input bag, with optional per-task default fields.
 * Resolution order per option: input bag → taskFields → schema's `default`.
 *
 * A function-valued `default` is called with `this` bound to a Proxy that
 * resolves other options on access — so defaults can freely depend on each
 * other regardless of declaration order. Cycles throw.
 * @param {object} schema - Map of optionKey → option definition
 * @param {object} input - Raw bag of values (from CLI or programmatic API)
 * @param {object} taskFields - Task-definition fields acting as per-task defaults
 * @returns {{resolved: object, claimed: Set<string>}} resolved values and the set of input bag keys consumed
 */
export function resolveOptions (schema, input = {}, taskFields = {}) {
	let resolved = {};
	let claimed = new Set();
	let inProgress = new Set();
	// Keys we've attempted (regardless of whether a value landed). Prevents
	// re-running side-effectful function defaults / future required / allowed
	// predicates when an unresolved key is read multiple times.
	let done = new Set();

	// Invoke a field that may be a boolean or a function. Functions run with
	// `this` bound to the dependency-tracking Proxy. Returns undefined if the
	// field isn't set, so callers can distinguish absent from explicit false.
	let call = (field, ctx) => (typeof field === "function" ? field.call(ctx) : field);

	let context = new Proxy(resolved, {
		get (target, key) {
			if (typeof key === "symbol" || key in target || !(key in schema)) {
				return target[key];
			}
			resolveOne(key);
			return target[key];
		},
	});

	function resolveOne (key) {
		if (done.has(key)) {
			return;
		}
		if (inProgress.has(key)) {
			let chain = [...inProgress, key];
			throw new Error(
				`Cycle in option resolution: ${chain.slice(chain.indexOf(key)).join(" → ")}`,
			);
		}
		inProgress.add(key);

		try {
			let option = schema[key];
			option.key ??= key;

			// `required` and `allowed` may be booleans or functions; functions run
			// through the same Proxy as defaults, so they can depend on other options.
			let required = Boolean(call(option.required, context));
			let allowedRaw = call(option.allowed, context);
			let flagName = () => "--" + (option.long ?? camelToKebab(key));

			// `required: true` implies `allowed: true` (config bug if explicitly disallowed).
			if (required && allowedRaw === false) {
				throw new Error(
					`Option ${flagName()} declares required: true and allowed: false — pick one.`,
				);
			}
			let allowed = required || allowedRaw !== false;

			let [aliasUsed, externalValue] = findValue(input, key, option);

			if (!allowed) {
				if (externalValue !== undefined) {
					throw new Error(`Option not allowed for this task: ${flagName()}`);
				}
				// Disallowed and unset: skip default/validate; resolved[key] stays unset.
			}
			else if (externalValue !== undefined) {
				resolved[key] = resolveValue(option, externalValue);
				claimed.add(aliasUsed);
			}
			else if (key in taskFields && taskFields[key] !== undefined) {
				// Task-def field as per-task default. Doesn't claim any input alias.
				resolved[key] = resolveValue(option, taskFields[key]);
			}
			else if ("default" in option) {
				// `context` makes function-valued defaults run eagerly with the resolution
				// Proxy bound to `this`, so they can read other options.
				resolved[key] = resolveValue(option, option.default, context);
			}

			// `key in resolved` instead of `=== undefined` so `default: () => undefined`
			// counts as "user-satisfied" (the option WAS set, just to undefined).
			if (required && !(key in resolved)) {
				throw new Error(`Required option missing: ${flagName()}`);
			}

			// Mark done only on success — on throw, re-reads re-attempt (and re-throw)
			// rather than silently returning a phantom undefined.
			done.add(key);
		}
		finally {
			inProgress.delete(key);
		}
	}

	for (let key in schema) {
		resolveOne(key);
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
 * Match positional values from `_` against options that declare `positional`.
 * `positional: true` is treated as 0; numeric values give explicit ordering.
 * Options already provided via flag are skipped.
 * At most one option can have `multiple: true` (acts like rest params).
 * Pure: returns a new `{ flags, _ }`; the input is not mutated.
 */
export function matchPositionals ({ flags, _ }, schema) {
	let outFlags = { ...flags };
	let remaining = [..._];

	let positionals = Object.entries(schema)
		.filter(
			([key, opt]) =>
				!(key in outFlags) &&
				(opt.positional === true || typeof opt.positional === "number"),
		)
		.map(([key, opt]) => [key, opt, opt.positional === true ? 0 : opt.positional])
		.sort(([, , a], [, , b]) => a - b);

	let multiples = positionals.filter(([, opt]) => opt.multiple);
	if (multiples.length > 1) {
		console.warn(
			`At most one positional option can accept multiple values, but found ${multiples.length} (${multiples.map(([key, opt]) => opt.long ?? key).join(", ")}).` +
				` Specify all but one via flags to resolve the ambiguity.`,
		);
	}

	for (let i = 0; i < positionals.length && remaining.length > 0; i++) {
		let [key, opt] = positionals[i];
		outFlags[key] = opt.multiple
			? remaining.splice(0, remaining.length - positionals.length + (i + 1))
			: remaining.shift();
	}

	return { flags: outFlags, _: remaining };
}

/**
 * Merge a list of option schemas in precedence order, later winning per field.
 * Pass any number of plain `{ optionKey: definition }` objects (or null/undefined for
 * absent layers). Callers decide what counts as a layer — typically the global base,
 * subclass `static options`, and the task's `options` field — and pass them in order.
 */
export function assembleOptions (...schemas) {
	let merged = {};
	for (let schema of schemas) {
		if (schema) {
			merged = mergeSchemas(merged, schema);
		}
	}
	return merged;
}

export default availableOptions;
