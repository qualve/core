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

These options can be passed as either CLI flags or as options to the programmatic API.

### All tasks

| Name | Type | Description |
|------|-----------------|-------------|
| `--config`/`-c` | string | The path to the config file. |
| `--dry-run` | boolean | Whether to dry run the task. |
| `--force`/`-f` | boolean | Whether to force the task to run even if the output file already exists. |
| `--items-per-page`/`--pp` | number | The number of items to process per page if batching is desired. |
| `--input`/`-i` | string, array, or object | The input file or glob pattern. |
| `--output`/`-o` | string or object | The output file. |

Note that plugins may add additional options.

### Data tasks

| Name | Type | Description |
|------|-----------------|-------------|
| `--input`/`-i` | string | The input file or glob pattern. |


## Plugins

- [@qualve/graphql](https://www.npmjs.com/package/@qualve/graphql) - GraphQL inputs for Qualve Tasks
