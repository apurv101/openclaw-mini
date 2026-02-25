# openclaw-mini

A terminal-only AI coding agent built on the PI SDK. Provides an interactive REPL for reading, writing, and editing code, running shell commands, performing web search/fetch, and executing reusable skill workflows — all from your terminal.

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

3. Run the agent:

```bash
pnpm dev
```

---

## Part 1: The Agent Core

Part 1 covers the foundational agent — REPL loop, tool calling, web tools, context files, and session management.

### What you get

- **Tool-calling REPL** — type a prompt, the LLM calls tools (`read`, `write`, `edit`, `bash`, `web_fetch`, `web_search`), results feed back, loop continues until the task is done.
- **Multi-provider LLM support** — Anthropic, OpenAI, Google, Groq, XAI, Mistral, OpenRouter, Cerebras, Ollama.
- **Web tools** — `web_fetch` extracts readable content from URLs (Mozilla Readability), `web_search` queries Brave Search or Perplexity.
- **Context-aware prompts** — auto-loads `CONTEXT.md`, `CLAUDE.md`, `SOUL.md`, `INSTRUCTIONS.md`, `.github/copilot-instructions.md` from your project root.
- **Session persistence** — conversations stored in `~/.openclaw-mini/state/sessions/mini/`.

### REPL commands (Part 1)

| Command | Description |
|---|---|
| `/quit` | Exit the agent |
| `/new` | Start a new session |
| `/model` | Show current model and provider |
| `/think [off\|minimal\|low\|medium\|high\|xhigh]` | Toggle or set extended thinking level |
| `/status` | Display session status (model, session, thinking, workspace, context) |

### Try it

```bash
pnpm dev
```

```
┌ openclaw-mini
│ model: anthropic/claude-sonnet-4-20250514
│ workspace: /Users/you/project
│ session: mini-1719432000000
│ context: CLAUDE.md
│ tools: read, bash, edit, write, web_fetch, web_search
└ /new /think /model /quit

> read src/entry.ts and explain what it does

> search the web for "node.js 22 new features" and summarize

> /think medium
Thinking: medium

> create a hello world express server in server.ts

> /status
Model: anthropic/claude-sonnet-4-20250514
Session: mini-1719432000000
Thinking: medium
Workspace: /Users/you/project
Context files: CLAUDE.md

> /new
New session: mini-1719432060000

> /quit
Bye.
```

### Branch

```
git checkout part-1/loop-and-tools
```

---

## Part 2: Skill Plugin System

Part 2 adds an extensible skill system — reusable workflows defined as Markdown files that teach the agent new behaviors without writing any code.

### What you get

- **Skill discovery** — skills are automatically loaded from three locations (user > project > bundled), with higher-priority sources overriding lower ones.
- **Progressive disclosure** — only skill names and descriptions are injected into the system prompt. Full instructions load on-demand when a skill is invoked.
- **4 bundled skills** — `git-commit`, `code-review`, `summarize`, `weather`.
- **Extensibility** — drop a `SKILL.md` file in the right folder and the agent picks it up on next launch.

### REPL commands (Part 2 — new)

| Command | Description |
|---|---|
| `/skills` | List all loaded skills with source and description |
| `/skill:<name>` | Invoke a skill (e.g. `/skill:git-commit`, `/skill:weather what's the weather in NYC?`) |

All Part 1 commands (`/quit`, `/new`, `/model`, `/think`, `/status`) continue to work. `/status` now also shows loaded skills.

### Try it

```bash
pnpm dev
```

```
┌ openclaw-mini
│ model: anthropic/claude-sonnet-4-20250514
│ workspace: /Users/you/project
│ session: mini-1719432000000
│ context: CLAUDE.md
│ tools: read, bash, edit, write, web_fetch, web_search
│ skills: git-commit, code-review, summarize, weather
└ /new /think /model /skills /quit

> /skills
Loaded skills (4):
  [bundled]  git-commit — Create well-structured git commits with conventional commit messages
  [bundled]  code-review — Review code changes for bugs, style issues, and improvement opportunities
  [bundled]  summarize — Summarize files, directories, or project structure into concise overviews
  [bundled]  weather — Fetch current weather and forecasts for any location

> /skill:git-commit
[tools: bash, bash, bash, bash]
feat(skills): add plugin system with 4 bundled skills
(8.2s)

> /skill:code-review review the last commit

> /skill:summarize summarize this project

> /skill:weather what's the weather in San Francisco?
```

### Bundled skills

| Skill | Tools used | What it does |
|---|---|---|
| `git-commit` | `bash` | Runs `git status` → `git diff --staged` → picks conventional commit type → commits |
| `code-review` | `bash`, `read` | Reviews code against a checklist (correctness, security, performance, readability, errors) and outputs a structured report |
| `summarize` | `bash`, `read` | Summarizes a file, directory, or full project with structure, tech stack, and key components |
| `weather` | `web_search` | Searches for current weather and presents temperature, conditions, humidity, wind |

### Creating your own skill

```bash
mkdir -p ~/.openclaw-mini/agents/main/agent/skills/my-skill
```

Create `SKILL.md` inside that folder:

```yaml
---
name: my-skill
description: One-line description of what this skill does
---

Instructions for the agent, written in Markdown.

1. First step — use `tool_name` to do X
2. Second step — analyze the result
3. Present output in this format:
   ...
```

Restart openclaw-mini — your skill appears automatically.

### Skill priority

Skills are discovered from three directories. If the same skill name exists in multiple locations, the highest-priority source wins:

| Priority | Location | Use case |
|---|---|---|
| 1 (highest) | `~/.openclaw-mini/agents/main/agent/skills/` | Your personal skills, override anything |
| 2 | `{project}/.openclaw-mini/skills/` | Project-specific team skills |
| 3 (lowest) | `skills/` (repo root) | Bundled defaults |

### Branch

```
git checkout part-2/skill-plugin-system
```

---

## Project Structure

```
src/
├── entry.ts           # Main REPL, session management, skill discovery
├── system-prompt.ts   # System prompt builder with context and skill injection
└── tools/
    ├── web-fetch.ts   # URL content fetching via Mozilla Readability
    └── web-search.ts  # Web search (Brave Search / Perplexity)
skills/
├── git-commit/        # Conventional commit workflow
│   └── SKILL.md
├── code-review/       # Structured code review checklist
│   └── SKILL.md
├── summarize/         # File/project summarization
│   └── SKILL.md
└── weather/           # Weather via web search
    └── SKILL.md
```

## Configuration

Defaults to Anthropic as the provider and `claude-sonnet-4-20250514` as the model. Override with:

- `OPENCLAW_MINI_PROVIDER` — LLM provider (e.g. `anthropic`, `openai`, `google`)
- `OPENCLAW_MINI_MODEL` — Model identifier

Sessions are stored in `~/.openclaw-mini/state/sessions/mini/`.
