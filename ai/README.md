# @qualve/llm

LLM task plugin for [Qualve](https://github.com/qualve/core), with adapters for Gemini, OpenAI, and Claude.

## Setup

Requires **Node.js v23+**.

```sh
npm install @qualve/llm
```

### API Keys

Copy `template.env` to `.env` and add API keys for the LLM providers you want to use:

- Gemini: https://aistudio.google.com/api-keys
- OpenAI: https://platform.openai.com/api-keys
- Claude: https://platform.claude.com/settings/keys

## Usage

```js
import "@qualve/llm";
```

Importing the package registers all three LLM providers (Gemini, OpenAI, Claude) with the Qualve task system.

## LLM Tasks

LLM tasks extend the base Qualve `Task` class, adding:
- Provider dispatch via `task.llm` (e.g., `"gemini"`, `"openai"`, `"claude"`)
- File upload/download for each provider
- Streaming response handling with progress indicators
- Structured output via JSON schemas
- Configurable thinking/reasoning levels

### Options

| Option | Flag | Description |
| --- | --- | --- |
| `llm` | `--llm` | Provider to use (`gemini`, `openai`, `claude`) |
| `model` | `--model` | Model name (see table below) |
| `thinking` | `--thinking` | Reasoning effort level |
| `fresh` | `--fresh` | Force re-upload of input files |

### Models

| LLM | Model | Context window | Max output |
| --- | --- | --- | --- |
| Gemini | `gemini-3.1-pro-preview`\* | 1,048,576 | 65,536 |
| Gemini | `gemini-3.1-flash-preview` | 1,048,576 | 65,536 |
| Gemini | `gemini-3.1-flash-lite-preview` | 1,048,576 | 65,536 |
| OpenAI | `gpt-5.4`\* | 1,050,000 | 128K |
| OpenAI | `gpt-5-mini` | 400K | 128K |
| OpenAI | `gpt-5-nano` | 400K | 128K |
| Claude | `claude-sonnet-4-6`\* | 1M | 64K |
| Claude | `claude-haiku-4-6` | 200K | 64K |
| Claude | `claude-opus-4-6` | 1M | 128K |

\* Default

### Thinking levels

Control reasoning effort via `--thinking <LEVEL>` or the `thinking` task property.

| LLM | Accepted values |
| --- | --- |
| [Gemini](https://ai.google.dev/gemini-api/docs/thinking) | `minimal`, `low`, `medium`, `high`\* |
| [OpenAI](https://platform.openai.com/docs/guides/reasoning) | `none`, `minimal`, `low`, `medium`\*, `high`, `xhigh` |
| [Claude](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) | _(not yet configurable)_ |
