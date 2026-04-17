#!/usr/bin/env node
import { prettyPrint, printError } from "./util/pretty-print.js";
import { printHelp } from "./util/help.js";
import { confirm } from "./util/ask.js";
import ArgsReader from "./util/args.js";
import qualve from "../src/qualve.js";
import { Task } from "../src/index.js";
import Config from "../src/config.js";
import availableOptions from "../src/options.js";

// First pass: base options
const argsReader = new ArgsReader(process.argv.slice(2), availableOptions);
let args = argsReader.args;
const config = await Config.from(args.config);

for (let name in config.model) {
	let model = config.model[name];
	if (model.option) {
		availableOptions[name] = model.option;
	}
}

// Second pass: re-parse with entity options included, if needed
args = argsReader.args;

if (args.help) {
	printHelp(availableOptions, Task.ids);
	process.exit(0);
}

let { _: positional, ...options } = args;
const taskId = positional[0];

if (!taskId) {
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(1);
}

// Resolve truncated ids
for (let name in config.model) {
	let model = config.model[name];
	let rawId = options[name];

	if (rawId) {
		let resolvedId = model.resolveId(rawId);
		if (resolvedId !== rawId) {
			if (
				!(await confirm({ prompt: `Did you mean "${resolvedId}" instead of "${rawId}"?` }))
			) {
				process.exit(1);
			}
		}
		options[name] = resolvedId;
	}
}

let resolved = await Task.resolve(taskId);
let scopes = Task.getScopes(resolved.subtasks ?? resolved);

for (let scope of scopes) {
	let model = config.model?.[scope];
	if (model?.multiple && !options[scope]) {
		// Confirm when running an entity-scoped task for all entities
		let runAll = await confirm({
			prompt: `Are you sure you want to run the task for all ${model.plural}?`,
		});
		if (!runAll) {
			throw new Error(
				`Please provide a ${model.name} ID${model.flag ? ` via the ${model.flag} flag` : ""}. Available ids: ${model.ids.join(", ")}`,
			);
		}

		options[scope] = model.ids;
	}
}

try {
	let result = await qualve(taskId, { ...options, config });
	if (options.dryRun) {
		prettyPrint(result);
	}
	// Print the result to stdout only when no outputs were configured at all.
	// `outputs: []` means outputs WERE configured but every per-file handleResult
	// returned null (explicit skip) — honor that intent and don't dump data.
	else if (result?.outputs === undefined && result?.result !== undefined) {
		prettyPrint(result.result);
	}
}
catch (e) {
	printError(e);
	process.exit(1);
}
