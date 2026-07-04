#!/usr/bin/env node
import { prettyPrint, printError } from "./util/pretty-print.js";
import { printHelp } from "./util/help.js";
import { confirm } from "./util/ask.js";
import { parseArgs } from "./util/args.js";
import { Task } from "../src/index.js";
import Config from "../src/config.js";
import availableOptions, { mergeSchemas } from "../src/options.js";

const argv = process.argv.slice(2);

// Parse against L1 to extract the config flag before loading config; once we have
// config we re-parse against L1+L2 so config-contributed option aliases (e.g., -q
// for --question) are canonicalized.
let options = parseArgs(argv, availableOptions);
const config = await Config.from(options.config, options);

if (!options.taskId) {
	if (options.help) {
		printHelp(config.availableOptions, Task.ids);
		process.exit(0);
	}
	console.info(`Available tasks:\n${Task.ids.join("\n")}`);
	process.exit(1);
}

options = parseArgs(argv, config.availableOptions);

let resolved = await Task.resolve(options.taskId);

// Re-parse against the task tree's aggregated schema so subtask-declared flags
// are canonicalized (e.g. -q → --question) and validated.
let schema = mergeSchemas(config.availableOptions, Task.aggregateSchema(resolved));
options = parseArgs(argv, schema);

// Run each option's validator on the user-provided value. A single suggestion
// triggers a "Did you mean…?" confirmation; anything else (false, empty, or
// multiple matches) is rejected with the suggestions listed in the error.
if (!options.help) {
	for (let key in schema) {
		let option = schema[key];
		if (!option.validate || options[key] === undefined) {
			continue;
		}
		let isArray = Array.isArray(options[key]);
		let values = isArray ? [...options[key]] : [options[key]];
		for (let i = 0; i < values.length; i++) {
			let result = option.validate(values[i]);
			if (result === true) {
				continue;
			}
			if (Array.isArray(result) && result.length === 1) {
				let ok = await confirm({
					prompt: `Did you mean "${result[0]}" instead of "${values[i]}"?`,
				});
				if (!ok) {
					process.exit(1);
				}
				values[i] = result[0];
			}
			else {
				let hint =
					Array.isArray(result) && result.length
						? `. Did you mean: ${result.join(", ")}?`
						: "";
				console.error(
					`Invalid value for --${option.long ?? key}: ${JSON.stringify(values[i])}${hint}`,
				);
				process.exit(1);
			}
		}
		options[key] = isArray ? values : values[0];
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
