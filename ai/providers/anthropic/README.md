# @qualve/anthropic

[Anthropic Claude](https://www.anthropic.com/) provider for [Qualve](https://npmjs.com/package/qualve) LLM tasks.

## Setup

Requires **Node.js v23+**.

```sh
npm install @qualve/anthropic
```

Set the `ANTHROPIC_API_KEY` environment variable (or add it to `.env`).
Get a key at https://platform.claude.com/settings/keys.

## Usage

```js
import "@qualve/anthropic";
```

Importing the package registers the `claude` provider with the Qualve task system.

Then use `llm: "claude"` in your task definitions:

```js
export default {
	type: "llm",
	llm: "claude",
	system: "You are a helpful assistant.",
	prompt: "Summarize this data.",
	input: [{ name: "data", schema: mySchema }],
	output: { name: "summary", schema: summarySchema },
};
```

## Models

| Model | Context window | Max output |
| --- | --- | --- |
| `claude-opus-4-8` (default) | 1M | 128K |
| `claude-sonnet-4-6` | 1M | 64K |
| `claude-haiku-4-5` | 200K | 64K |

## Capabilities

| Capability | Supported |
| --- | --- |
| Structured output (JSON schema) | Yes |
| Input file descriptions in prompt | Yes (automatic) |
| Thinking levels | No |
| Token counting | Yes |
