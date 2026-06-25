# @qualve/openai

[OpenAI](https://openai.com/) provider for [Qualve](https://npmjs.com/package/qualve) LLM tasks.

## Setup

Requires **Node.js v23+**.

```sh
npm install @qualve/openai
```

Set the `OPENAI_API_KEY` environment variable (or add it to `.env`).
Get a key at https://platform.openai.com/api-keys.

## Usage

```js
import "@qualve/openai";
```

Importing the package registers the `openai` provider with the Qualve task system.

Then use `llm: "openai"` in your task definitions:

```js
export default {
	type: "llm",
	llm: "openai",
	system: "You are a helpful assistant.",
	prompt: "Summarize this data.",
	input: [{ name: "data", schema: mySchema }],
	output: { name: "summary", schema: summarySchema },
};
```

## Models

| Model | Context window | Max output |
| --- | --- | --- |
| `gpt-5.5` (default) | 1,050,000 | 128K |
| `gpt-5.4-mini` | 400K | 128K |
| `gpt-5.4-nano` | 400K | 128K |

## Capabilities

| Capability | Supported |
| --- | --- |
| Structured output (JSON schema) | Yes |
| Thinking levels | Yes (`none`, `minimal`, `low`, `medium`\*, `high`, `xhigh`) |
| Token counting | No |

\* Default
