#!/usr/bin/env node
import { prettyPrint, printError } from "./util/pretty-print.js";
import { printHelp } from "./util/help.js";
import { confirm } from "./util/ask.js";
import { parseArgs } from "./util/args.js";
import { Task } from "../src/index.js";
import Config from "../src/config.js";
import availableOptions from "../src/options.js";

const argv = process.argv.slice(2);

// Parse against L1 to extract the config flag before loading config; once we have
// config we re-parse against L1+L2 so entity-model option aliases (e.g., -q for
// --question) are canonicalized.
let options = parseArgs(argv, availableOptions);
const config = await Config.from(options.config);

if (!options.taskId) {
	if (options.help) {
		printHelp(config.availableOptions, Task.ids);
		process.exit(0);
	}
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(1);
}

options = parseArgs(argv, config.availableOptions);

// Resolve truncated entity IDs (with confirmation prompt)
for (let name in config.model) {
	let rawId = options[name];
	if (!rawId) {
		continue;
	}
	let resolvedId = config.model[name].resolveId(rawId);
	if (resolvedId !== rawId) {
		if (!(await confirm({ prompt: `Did you mean "${resolvedId}" instead of "${rawId}"?` }))) {
			process.exit(1);
		}
	}
	options[name] = resolvedId;
}

let resolved = await Task.resolve(options.taskId);
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

// Construct the task. Task-declared positional options are matched inside the
// constructor against the leftover `_` from this parse — each task does that
// against its own schema.
let task = await Task.fromId(options.taskId, { ...options, config });

if (options.help) {
	printHelp(task.optionsSchema, Task.ids);
	process.exit(0);
}

try {
	let result = await task.run();
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
