# @qualve/ai

Meta-package for [Qualve](https://npmjs.com/package/qualve) LLM support.
Installs the core LLM framework and all official provider adapters in one go.

## Setup

Requires **Node.js v23+**.

```sh
npm install @qualve/ai
```

This installs:
- [@qualve/llm](https://npmjs.com/package/@qualve/llm) — Core LLM task framework
- [@qualve/anthropic](https://npmjs.com/package/@qualve/anthropic) — Claude provider
- [@qualve/openai](https://npmjs.com/package/@qualve/openai) — OpenAI provider
- [@qualve/googleai](https://npmjs.com/package/@qualve/googleai) — Gemini provider

If you only need specific providers, install them individually instead (each pulls in `@qualve/llm` automatically).

## Usage

```js
import "@qualve/ai";
```

Importing the package registers all three providers with the Qualve task system.

You can also import individual providers via sub-paths:

```js
import "@qualve/ai/anthropic";
import "@qualve/ai/openai";
import "@qualve/ai/googleai";
```

Or import the core framework:

```js
import { LLMTask } from "@qualve/ai/core";
```

## API Keys

Create a `.env` file with API keys for the providers you want to use:

```sh
GEMINI_API_KEY=...     # https://aistudio.google.com/api-keys
OPENAI_API_KEY=...     # https://platform.openai.com/api-keys
ANTHROPIC_API_KEY=...  # https://platform.claude.com/settings/keys
```

## Packages

| Package | Description |
| --- | --- |
| [@qualve/llm](https://npmjs.com/package/@qualve/llm) | Core LLM task framework (`LLMTask` class) |
| [@qualve/anthropic](https://npmjs.com/package/@qualve/anthropic) | Claude adapter |
| [@qualve/openai](https://npmjs.com/package/@qualve/openai) | OpenAI adapter |
| [@qualve/googleai](https://npmjs.com/package/@qualve/googleai) | Gemini adapter |

## Models

| Provider | Model | Context window | Max output |
| --- | --- | --- | --- |
| Gemini | `gemini-3.1-pro-preview`\* | 1,048,576 | 65,536 |
| Gemini | `gemini-3.1-flash-preview` | 1,048,576 | 65,536 |
| Gemini | `gemini-3.1-flash-lite-preview` | 1,048,576 | 65,536 |
| OpenAI | `gpt-5.4`\* | 1,050,000 | 128K |
| OpenAI | `gpt-5-mini` | 400K | 128K |
| OpenAI | `gpt-5-nano` | 400K | 128K |
| Claude | `claude-sonnet-4-6`\* | 1M | 64K |
| Claude | `claude-haiku-4-6` | 200K | 64K |
| Claude | `claude-opus-4-5` | 1M | 128K |

\* Default

## Options

| Option | Flag | Description |
| --- | --- | --- |
| `llm` | `--llm` | Provider to use (`gemini`, `openai`, `claude`) |
| `model` | `--model` | Model name (see table above) |
| `thinking` | `--thinking` | Reasoning effort level |
| `fresh` | `--fresh` | Force re-upload of input files |

### Thinking levels

Control reasoning effort via `--thinking <LEVEL>` or the `thinking` task property.

| Provider | Accepted values |
| --- | --- |
| [Gemini](https://ai.google.dev/gemini-api/docs/thinking) | `minimal`, `low`, `medium`, `high`\* |
| [OpenAI](https://platform.openai.com/docs/guides/reasoning) | `none`, `minimal`, `low`, `medium`\*, `high`, `xhigh` |
| [Claude](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) | _(not yet configurable)_ |
