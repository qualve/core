#!/usr/bin/env node
import { prettyPrint, printError } from "./util/pretty-print.js";
import { confirm } from "./util/ask.js";
import ArgsReader from "./util/args.js";
import Task from "../src/index.js";
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

let { dryRun, _: positional, ...overrides } = args;
const taskId = positional[0];

if (!taskId) {
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(1);
}

// Resolve truncated ids
for (let name in config.model) {
	let model = config.model[name];
	let rawId = args[name];

	if (rawId) {
		let resolvedId = model.resolveId(rawId);
		if (resolvedId !== rawId) {
			if (
				!(await confirm({ prompt: `Did you mean "${resolvedId}" instead of "${rawId}"?` }))
			) {
				process.exit(1);
			}
		}
		args[name] = resolvedId;
	}
}

// Confirm when running an entity-scoped task for all entities
let resolved = await Task.resolve(taskId);
let scopes = Task.getScopes(resolved.subtasks ?? resolved);

for (let scope of scopes) {
	let model = config.model?.[scope];
	if (model?.multiple && !args[scope]) {
		let runAll = await confirm({
			prompt: `Are you sure you want to run the task for all ${model.plural}?`,
		});
		if (!runAll) {
			throw new Error(
				`Please provide a ${model.name} ID${model.flag ? ` via the ${model.flag} flag` : ""}. Available ids: ${model.ids.join(", ")}`,
			);
		}
	}
}

let entityIds = {};
for (let name in config.model) {
	if (args[name]) {
		entityIds[name] = args[name];
	}
}

let task = await Task.fromId(taskId, { entityIds, dryRun, config, ...overrides });

try {
	let result = await task.run();
	if (dryRun) {
		prettyPrint(result);
	}
	else if (!result?.outputPath && result?.result !== undefined) {
		prettyPrint(result.result);
	}
}
catch (e) {
	printError(e);
	process.exit(1);
}
