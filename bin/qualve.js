#!/usr/bin/env node
import { prettyPrint, printError } from "./util/pretty-print.js";
import { printHelp } from "./util/help.js";
import { confirm } from "./util/ask.js";
import ArgsReader from "./util/args.js";
import { Task } from "../src/index.js";
import Config from "../src/config.js";
import availableOptions from "../src/options.js";

const argsReader = new ArgsReader(process.argv.slice(2));

// First pass: canonicalize and match L1 positionals so we know taskId before loading
// config / resolving the task.
argsReader.canonicalize(availableOptions);
argsReader.matchPositionals(availableOptions);

const config = await Config.from(argsReader.flags.config);

let { taskId, help } = argsReader.flags;

if (!taskId) {
	if (help) {
		printHelp(config.availableOptions, Task.ids);
		process.exit(0);
	}
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(1);
}

// Pick up entity-model option aliases now that we have config
argsReader.canonicalize(config.availableOptions);

let { _: _u, taskId: _t, help: _h, ...options } = argsReader.args;

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

// Construct the task without running. The constructor walks the dispatch chain
// and builds the merged schema on the instance — read it for --help and for
// matching any task-declared positionals.
let task = await Task.fromId(taskId, { ...options, config });

argsReader.canonicalize(task.optionsSchema);
argsReader.matchPositionals(task.optionsSchema);

if (help) {
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
