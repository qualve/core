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
qualve <task-id> [...options]
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

## Running tasks

There are two ways to run tasks:
1. Via the CLI tool
2. Programmatically
