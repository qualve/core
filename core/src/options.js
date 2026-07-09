import { toArray, camelToKebab } from "./util.js";

const DEFAULT_TASKS = { include: "tasks/**/*.js", exclude: entry => entry.name.startsWith("_") };

/**
 * @typedef {Object} Option
 * An option's schema: how a value for it is aliased, parsed, defaulted, validated, and displayed.
 * All fields are optional; a bare `{}` is a valid string option.
 * @property {string} [long] Long flag name; defaults to the kebab-cased key.
 * @property {string} [short] Single-character flag alias.
 * @property {boolean | number} [positional] Accept a positional arg — `true` for index 0, or an explicit index.
 * @property {boolean} [multiple] Accept several values (resolves to an array); as a positional, acts as rest args.
 * @property {boolean | (() => boolean)} [present] Tri-state presence: `true` = required, `false` = not
 *   applicable to this task (hidden from help, not resolved here — a supplied value still propagates to
 *   subtasks that declare it), omitted = optional. A function is evaluated with `this` bound to the other
 *   resolved options.
 * @property {* | (() => *)} [default] Value when unset. A function is called with `this` bound to the other
 *   resolved options, so defaults may depend on each other (resolution order doesn't matter; cycles throw).
 * @property {(value: *) => *} [parse] Normalize/coerce a provided value (e.g. `Number`).
 * @property {(value: *) => (boolean | string[])} [validate] Return `true` to accept, `false` to reject, or an
 *   array of suggestions surfaced in the error ("Did you mean…?").
 * @property {*[] | RegExp} [values] Constrain accepted values to a list of members or a pattern.
 * @property {"cli" | "root" | "config" | "task"} [for] Who consumes this option. `"cli"`: the CLI bin
 *   only — presentation flags with no programmatic meaning (`--help`, `--version`); rejected by `qualve()`.
 *   `"root"`: the orchestrator (`qualve()` / the bin) — which config and which task to run; valid in both
 *   APIs but never passed to task logic. `"config"`: resolved by `Config.from` (see Config).
 *   `"task"` (default): resolved per-run at task construction.
 * @property {string} [description] Help text.
 * @property {string} [key] The canonical key; set internally during resolution, not by authors.
 */

/**
 * L1: global options. Frozen — extension happens via mergeSchemas in assembleOptions, not mutation.
 * @type {Readonly<Record<string, Option>>}
 */
const availableOptions = Object.freeze({
	taskId: {
		for: "root",
		long: "task",
		positional: true,
		description: "Task to run",
	},
	tasks: {
		for: "config",
		default: DEFAULT_TASKS,
		parse: tasks => {
			let { include = DEFAULT_TASKS.include, exclude = DEFAULT_TASKS.exclude } =
				typeof tasks === "string" || Array.isArray(tasks) ? { include: tasks } : tasks;

			if (typeof exclude !== "function") {
				// globSync() does not support string for exclude
				exclude = toArray(exclude);
			}

			return { include, exclude };
		},
		description: "Glob(s) of task files, or { include, exclude } (exclude may be a predicate)",
	},
	config: {
		for: "root",
		short: "c",
		description: "Path to config file",
	},
	force: {
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
	input: {
		short: "i",
		description: "Input file or directory",
	},
	output: {
		short: "o",
		description: "Output file or directory",
	},
	help: {
		for: "cli",
		description: "Show this help message",
	},
});

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
 * Values run through `option.parse` if declared (normalization, not just string coercion).
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

	if (option.parse && value !== undefined) {
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
 * @returns {{resolved: object, claimed: Set<string>}} resolved values and the set of input bag keys handled
 *   (consumed as a value, or explicitly not-applicable via `present: false`) so callers can tell the rest apart
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

			// `present` is a tri-state: true = must be present (required),
			// false = must not be present (forbidden), undefined = optional.
			// May be a function evaluated through the same Proxy as defaults.
			let present = call(option.present, context);
			let flagName = () => "--" + (option.long ?? camelToKebab(key));

			let [aliasUsed, externalValue] = findValue(input, key, option);

			if (present === false) {
				// Not applicable to this task: skip default/validate; resolved[key] stays unset.
				// A supplied value isn't rejected — mark it handled so the escape hatch doesn't
				// absorb it as an undeclared field. It still rides down to subtasks that declare
				// it via rawOptions.
				if (aliasUsed !== null) {
					claimed.add(aliasUsed);
				}
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
			if (present === true && !(key in resolved)) {
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
