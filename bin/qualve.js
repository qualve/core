#!/usr/bin/env node
import { prettyPrint, printError } from "./util/pretty-print.js";
import { printHelp } from "./util/help.js";
import { confirm } from "./util/ask.js";
import ArgsReader from "./util/args.js";
import qualve from "../src/qualve.js";
import { Task } from "../src/index.js";
import Config from "../src/config.js";
import availableOptions, { assembleOptions, findValue } from "../src/options.js";

const argsReader = new ArgsReader(process.argv.slice(2));

// First pass: canonicalize and match L1 positionals so we know taskId before loading
// config / resolving the task.
argsReader.canonicalize(availableOptions);
argsReader.matchPositionals(availableOptions);

const config = await Config.from(argsReader.flags.config);

let { taskId, help } = argsReader.flags;

if (help && !taskId) {
	// No task → print top-level help with just the config-extended global schema.
	printHelp(config.availableOptions, Task.ids);
	process.exit(0);
}

if (!taskId) {
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(1);
}

// Resolve the task and build the full schema for it: config-extended global +
// each subclass's static options + the task's own options.
let resolved = await Task.resolve(taskId);
let classOptions = Task.getSubclassChain(resolved, argsReader.flags)
	.map(c => c.options)
	.filter(Boolean);
let schema = assembleOptions(config.availableOptions, ...classOptions, resolved.options);

// Second pass: pick up any aliases newly recognized by the full schema (entity-model
// options, subclass options, task options) and match any task-declared positionals.
argsReader.canonicalize(schema);
argsReader.matchPositionals(schema);

if (help) {
	printHelp(schema, Task.ids);
	process.exit(0);
}

let { _: _unused, ...options } = argsReader.args;
delete options.taskId;
delete options.help;

// Resolve truncated entity IDs (with confirmation prompt)
for (let name in config.model) {
	let model = config.model[name];
	let [aliasUsed, rawId] = findValue(options, name, model.option ?? {});

	if (rawId) {
		let resolvedId = model.resolveId(rawId);
		if (resolvedId !== rawId) {
			if (
				!(await confirm({ prompt: `Did you mean "${resolvedId}" instead of "${rawId}"?` }))
			) {
				process.exit(1);
			}
		}
		// Normalize to canonical key so qualve.js can split by config.model
		if (aliasUsed && aliasUsed !== name) {
			delete options[aliasUsed];
		}
		options[name] = resolvedId;
	}
}

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
