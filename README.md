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
Each task is a JavaScript file that exports an object that defines the task.
By default, Qualve looks for tasks anywhere in the `tasks/` directory of your CWD, skipping files and directories whose name starts with `_` (use those for private helpers).
The [`tasks` config option](#task-discovery) controls where Qualve looks.

### Referencing tasks

You reference a task by any trailing part of its path: the filename alone,
or prefixed by as many parent directories as needed, separated by either `-` or `/`.
A task at `tasks/foo/bar/baz/quux.js` can be run as `quux`, `baz-quux`, `baz/quux`, `bar-baz-quux`, etc.
The extension is normally omitted, but a reference may include it, in which case only files
with that extension match — useful when two tasks differ only by extension (`build.js` vs `build.mjs`).

If a reference matches several tasks, the task whose path it covers most wins:
with `bar/foo.js` and `bar/baz/foo.js`, `foo` runs `bar/foo.js` (and `baz-foo` runs the other).
Remaining ties prefer the more literal match, so `answers-normalize` runs the file `answers-normalize.js`
even if `answers/normalize.js` also exists — reference the latter as `answers/normalize`
(`/` only ever matches a real directory boundary, so it's more specific than `-`).
Anything still ambiguous produces an error listing the matching tasks, so you can be more specific.

Task listings show each task's id: the shortest reference that uniquely identifies it.

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

The optional `resultType` controls the shape of `handleResult`'s input, with the microsyntax `(args|array|object)(-grouped)?(-files)?`:

- `args` (the default) spreads one argument per element; `array` passes them as a single array; `object` keys grouped descriptors by `id` (falling back to name, or the glob pattern) and ungrouped files by their name — colliding names qualify further (filename, then full path), and grouped inputs sharing an `id` group into an array.
- `-grouped` gives one element per input descriptor — a glob contributes its matches as an array. By default, glob matches are spliced inline.
- `-files` passes `File` objects instead of their contents.

Tokens are order-insensitive. Without an explicit type, `files` implies `array` — so `"files"` keeps its legacy meaning (one array of `File` objects) and `"grouped-files"` is its grouped version — while anything else defaults to `args` (`"grouped"` means `args-grouped`).

You can chain tasks together to create custom data processing pipelines.

## Configuration

Qualve can be configured with a `qualve.config.js` file in your CWD.
To use a different config file, you can pass the `--config`/`-c` option to the CLI or the `config` option to the programmatic API.

The config file is a JavaScript file that exports an object with the following properties:
- `tasks`: Where to look for task files (see [Task discovery](#task-discovery)).
- `options`: Additional options to contribute to the global schema. Each entry has the same shape as a task-declared option (`short`, `long`, `multiple`, `present`, `default`, `validate`, etc.). This is where consumers wire up domain-specific flags — e.g. an `--llm` flag for an AI consumer, or a `--question` flag for a survey-analysis consumer.
- (Any plugin-specific config — e.g. `graphql` for the @qualve/graphql plugin)

### Task discovery

The `tasks` config option is a glob (or array of globs) of task files, resolved against your CWD:

```js
export default {
	tasks: "pipelines/**/*.js",
};
```

For full control, pass an object with `include` and `exclude` globs:

```js
export default {
	tasks: {
		include: ["tasks/**/*.js", "shared/tasks/**/*.js"],
		exclude: "**/_*", // `_`-prefixed files and directories are private
	},
};
```

By default, `_`-prefixed files and directories are private and skipped — no matter where `include` points.
Glob shorthands keep this default; set `exclude` explicitly (even to `[]`) to replace it.
`exclude` may be glob(s) or a `(entry) => boolean` predicate over each `Dirent`. Glob excludes are matched against each candidate path relative to your CWD, so when `include` escapes it (e.g. `../tasks/**`) a pattern like `**/_*` matches nothing — use a predicate (as the default does), which is immune to the path prefix.
The globs decide everything, including which extensions qualify (e.g. `tasks/**/*.{js,mjs}`);
directories are never tasks, but any file your globs match becomes one.

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
| `--tasks` | glob(s) or `{include, exclude}` | Where to look for task files (see [Task discovery](#task-discovery)). On the CLI, overrides the config file's value. |

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
- `short` — single-character short flag (e.g., `f` for `-f`).
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

<details>
<summary>Plugins</summary>
	
- [@qualve/graphql](https://www.npmjs.com/package/@qualve/graphql) - GraphQL inputs for Qualve Tasks
- [@qualve/ai](https://www.npmjs.com/package/@qualve/ai) - LLM tasks (core + all official providers)
  - [@qualve/llm](https://www.npmjs.com/package/@qualve/llm) - Core LLM task framework
  - [@qualve/anthropic](https://www.npmjs.com/package/@qualve/anthropic) - Claude provider
  - [@qualve/openai](https://www.npmjs.com/package/@qualve/openai) - OpenAI provider
  - [@qualve/googleai](https://www.npmjs.com/package/@qualve/googleai) - Gemini provider
</details>
