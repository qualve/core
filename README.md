# Qualve

A pluggable data processing framework.
Focus on the insights you want to figure out and let Qualve handle the rest.

## Installation

```sh
npm install qualve
```

## Usage

Via the CLI:

```sh
npx qualve <task-id> [...options]
```

Programmatically:
```js
import qualve from "qualve";

const { task, output } = await qualve("<task-id>", { /* options */ });
```

## Tasks

Tasks are the core building blocks of Qualve.
By default, Qualve will look for tasks in the `tasks/` directory of your CWD.
Each task is a JavaScript file that exports an object that defines the task.

Broadly, a task object describes how to transform data from one or more inputs to one or more outputs.

Each task has a different `type`, such as `data`, `graphql`, `llm`, etc. that determines how it works and what parameters it accepts.
Qualve Core ships with only `data` tasks, and then you add the types you need with plugins (see [Plugins](#plugins)).

The most basic type of task is a `data` task.
It `data` task accepts one or more input files and produces a single output file.
For example, suppose you wanted to create a single JSON file with the names of all packages in a project.
The task could look like this:

```js
export default {
	type: "data",
	input: ["node_modules/**/package.json"],
	resultType: "array",
	handleResult: packages => {
		return packages.map(pkg => pkg.name);
	},
	output: "packages.json",
};
```

You can chain tasks together to create custom data processing pipelines.

## Configuration

Qualve can be configured with a `qualve.config.js` file in your CWD.
To use a different config file, you can pass the `--config`/`-c` option to the CLI or the `config` option to the programmatic API.

The config file is a JavaScript file that exports an object with the following properties:
- `model`: An object that defines any entities specific to the use case (e.g. a qualtiative analysis tool for a survey may have a `survey` entity and a `question` entity)
- (Any plugin-specific options)

Also, the config file is the place to import any plugins you need.

## Options

Options can be passed as either CLI flags or as options to the programmatic API. Aliases (long, short, kebab/camel) work the same in both modes.

### Built-in options

| Name | Type | Description |
|------|-----------------|-------------|
| `--config`/`-c` | string | The path to the config file. |
| `--dry-run` | boolean | Whether to dry run the task. |
| `--force`/`-f` | boolean | Whether to force the task to run even if the output file already exists. |
| `--items-per-page`/`--pp` | number | The number of items to process per page if batching is desired. |
| `--input`/`-i` | string, array, or object | The input file or glob pattern. |
| `--output`/`-o` | string or object | The output file. |

Plugins may add additional options. Tasks themselves may declare their own (see below).

### Declaring task-specific options

A task can declare its own parameters by adding an `options` field to its definition. The schema shape is the same as the built-ins:

```js
export default {
	type: "llm",
	scope: "question",
	options: {
		completeness: {
			default: "partial",
			values: ["partial", "full", "codes-only"],
			description: "How complete the starting codebook is",
		},
		mode: {
			default: "hybrid",
			values: ["deductive", "inductive", "hybrid"],
			description: "Coding approach",
		},
	},
	prompt (question) {
		return `Develop a codebook using ${this.mode} coding from a ${this.completeness} starting set ...`;
	},
};
```

Resolved values become **direct properties on the task instance** (e.g., `this.completeness`, `this.mode`). The task body must use a regular function (not an arrow) to read `this`.

CLI: `qualve mytask --question=q1 --completeness=full --mode=inductive`. Programmatic: `qualve("mytask", { question: "q1", completeness: "full", mode: "inductive" })`.

#### Schema fields

- `default` — the value used when no other source provides one.
- `short` — short flag (e.g., `pp` for `--pp`).
- `long` — long flag (defaults to the option's key, kebab-cased; only set if you want a different name).
- `parse` — function applied to **string** values (CLI input). Typed values from the programmatic API skip this. If `parse: Number` returns `NaN`, the resolver throws.
- `values` — array (member-of check) or `RegExp` (pattern match). Throws on mismatch.
- `validate` — predicate; throws if it returns false.
- `description` — appears in `--help`.

Function values pass through unchanged — the resolver does not call them. Read function-typed options via `this.resolveOption("key")` or call them directly when you're ready.

#### Resolution order (highest to lowest priority)

1. CLI flag or programmatic value.
2. Task-definition field of the same name (so `model: "gpt-5"` at the top level acts as the per-task default for the `model` option).
3. The schema's static `default`.

#### Subclasses can declare options too

A `Task` subclass declares its options as `static options = {...}` on the class. The framework merges them into the schema for any task whose `type` (or further dispatch keys like `llm`) lands in that subclass.

```js
class LLMTask extends Task {
	static options = {
		llm: { default: "gemini", description: "LLM provider" },
		model: { description: "Model name (provider-specific)" },
	};
}
```

Overlapping keys across levels (global → config → subclass chain → task) **deep-merge per field** with the more specific level winning. A subclass declares `description`, a specific task adds `default` and `values` — both end up on the merged schema.

### Unknown options

Options that aren't declared anywhere both apply as task-field overrides (so `--prompt='...'` mutates `task.prompt` even if undeclared) and surface in `this.unknownOptions` for introspection.


## Plugins

- [@qualve/graphql](https://www.npmjs.com/package/@qualve/graphql) - GraphQL inputs for Qualve Tasks
- [@qualve/ai](https://www.npmjs.com/package/@qualve/ai) - LLM tasks (core + all official providers)
  - [@qualve/llm](https://www.npmjs.com/package/@qualve/llm) - Core LLM task framework
  - [@qualve/anthropic](https://www.npmjs.com/package/@qualve/anthropic) - Claude provider
  - [@qualve/openai](https://www.npmjs.com/package/@qualve/openai) - OpenAI provider
  - [@qualve/googleai](https://www.npmjs.com/package/@qualve/googleai) - Gemini provider
