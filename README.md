# openclaw-mini

A terminal-only AI coding agent built on the PI SDK. Provides an interactive REPL for reading, writing, and editing code, running shell commands, and performing web search/fetch — all from your terminal.

## Prerequisites

- Node.js >= 22.12.0
- pnpm 10+

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy the environment file and add your API key:

```bash
cp .env.example .env
```

At minimum, set `ANTHROPIC_API_KEY` in `.env`. Optionally add keys for other LLM providers (OpenAI, Google, Groq, Mistral, etc.) and search providers (Brave Search, Perplexity) — see `.env.example` for the full list.

## Usage

Development (runs directly from source):

```bash
pnpm dev
```

Production (build first, then run):

```bash
pnpm build
pnpm start
```

### REPL Commands

| Command | Description |
|---|---|
| `/quit` | Exit the agent |
| `/new` | Start a new session |
| `/model` | Show current model and provider |
| `/think [off\|on\|stream]` | Toggle extended thinking |
| `/status` | Display session status |

## Project Structure

```
src/
├── entry.ts           # Main REPL entry point and session management
├── system-prompt.ts   # System prompt builder with context detection
└── tools/
    ├── web-fetch.ts   # URL content fetching via Mozilla Readability
    └── web-search.ts  # Web search (Brave Search / Perplexity)
```

## Configuration

Defaults to Anthropic as the provider and `claude-sonnet-4-20250514` as the model. Override with:

- `OPENCLAW_MINI_PROVIDER` — LLM provider (e.g. `anthropic`, `openai`, `google`)
- `OPENCLAW_MINI_MODEL` — Model identifier

Sessions are stored in `~/.openclaw-mini/state/sessions/mini/`.
