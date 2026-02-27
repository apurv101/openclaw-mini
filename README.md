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

## Part 3: The Meta Skill

Part 3 adds a meta skill — a bundled `skill-creator` that lets the agent create new skills on the fly during a conversation. It also adds hot-reload so newly created skills are available immediately without restarting.

### What you get

- **`skill-creator` bundled skill** — ask the agent "create a skill that does X" and it writes a complete `SKILL.md` for you, placed in the right directory.
- **Hot-reload** — skills are re-discovered on every prompt. A skill created mid-session is available on the very next prompt, no restart needed.

### How it works

1. Tell the agent what you want: *"create a skill that generates changelog entries"*
2. The `skill-creator` skill activates and asks clarifying questions (what it should do, user vs project scope)
3. The agent writes the `SKILL.md` to your skills directory using `bash` + `write`
4. On your next prompt, the new skill is discovered and ready to use

### Try it

```
> create a skill that generates release notes from git history

I'll create a "release-notes" skill for you.

What scope should it have?
- User skill (available in all projects) — default
- Project skill (shared with the team)

Creating user skill...
[tools: bash, write, read]
✓ Created ~/.openclaw-mini/agents/main/agent/skills/release-notes/SKILL.md

The skill is available now. Try: "generate release notes for the last 5 commits"

> /skills
Loaded skills (6):
  [bundled]  git-commit — Create well-structured git commits with conventional commit messages
  [bundled]  code-review — Review code changes for bugs, style issues, and improvement opportunities
  [bundled]  skill-creator — Create new skills for openclaw-mini
  [bundled]  summarize — Summarize files, directories, or project structure into concise overviews
  [bundled]  weather — Fetch current weather and forecasts for any location
  [user]     release-notes — Generate release notes from git commit history
```

### What changed

| File | Change |
|---|---|
| `skills/skill-creator/SKILL.md` | New bundled skill — guides the agent through creating skills |
| `src/entry.ts` | Skills re-discovered each prompt for hot-reload (~4 lines moved into the REPL loop) |

### Branch

```
git checkout part-3/meta-skill
```

---

## Part 4: Tool Loop Detection

Part 4 adds a circuit breaker that detects when the agent is stuck in a tool loop and stops it, plus a `/verbose` command for real-time observability.

### What you get

- **Tool loop circuit breaker** — a sliding window of the last 30 tool calls with four pattern detectors that catch repeated calls, no-progress streaks, and ping-pong alternation. Progressive escalation: warn at 10 repetitions, block at 20, hard circuit breaker at 30.
- **`/verbose` toggle** — real-time logging of every tool call, execution time, thinking events, and turn boundaries. Logs to stderr so it doesn't interfere with agent output.

### How it works

1. Every tool's `execute()` is wrapped with a decorator that runs a pre-flight check before each call
2. A stable hasher (sorted keys, recursive) creates deterministic keys for tool calls and their results
3. Four detectors scan the sliding window:
   - **Generic repeat** — same tool + args called 10+ times → warning
   - **No-progress** — same tool + args + identical result 20+ times → blocked
   - **Ping-pong** — two tools alternating with stable results 10+ times → warning, 20+ → blocked
   - **Global circuit breaker** — any pattern hitting 30 → hard stop
4. Warnings print to the terminal; blocks throw an error the LLM reads and adjusts to

### REPL commands (Part 4 — new)

| Command | Description |
|---|---|
| `/verbose` | Toggle real-time tool call logging on/off |

All previous commands continue to work.

### Try it

```
> /verbose
Verbose logging: on

> read the package.json and tell me what this project does
[turn 1]
  [deciding tool call...]
  [tool] read {"file_path":"/Users/you/project/package.json"}
  [tool] read ✓ 0.1s
[turn 2]
This project is a terminal-based AI coding agent called openclaw-mini...
(3.2s)
```

### What changed

| File | Change |
|---|---|
| `src/tool-loop-detection.ts` | New — `ToolLoopDetector` class (~150 lines): stable hashing, sliding window, 4 detectors, progressive escalation, warning dedup, tool wrapper |
| `src/entry.ts` | ~50 lines added — import detector, wrap all tools, `/verbose` command with `session.subscribe()`, reset on `/new` |

### Branch

```
git checkout part-4/the-tool-loop
```

---

## Part 5: Context Compaction

Part 5 adds context management — a `/compact` command for manual and automatic conversation compaction, plus context overflow recovery. Sessions are kept alive between prompts so you can compact at any time.

### What you get

- **`/compact` command** — three modes: `/compact` triggers manual compaction on the current session, `/compact on` and `/compact off` toggle auto-compaction (on by default).
- **Auto-compaction** — enabled by default. The SDK monitors context size and automatically summarizes conversation history when approaching the model's context limit.
- **Compaction event visibility** — compaction start/end events are always printed to the terminal (not gated by `/verbose`) so you always know when the context is being summarized.
- **Context overflow recovery** — when the conversation exceeds the model's context window, a helpful error message suggests `/compact` to summarize history or `/new` to start fresh (instead of a raw API error).
- **Session lifecycle** — sessions are kept alive between prompts (disposed at the start of the next prompt or on `/new`), allowing `/compact` to access the active session.

### REPL commands (Part 5 — new)

| Command | Description |
|---|---|
| `/compact` | Manually compact the current session (shows token count and summary preview) |
| `/compact on` | Enable auto-compaction (default) |
| `/compact off` | Disable auto-compaction |

All previous commands continue to work. `/status` now also shows auto-compact state.

### Try it

```
> /status
Model: anthropic/claude-sonnet-4-20250514
Session: mini-1719432000000
Thinking: off
Workspace: /Users/you/project
Context files: CLAUDE.md
Skills: git-commit, code-review, summarize, weather
Auto-compact: on

> /compact off
Auto-compaction: off

> /compact on
Auto-compaction: on

> explain this entire codebase in detail
[long response...]
(12.4s)

> /compact
Compacting...
Compacted: 8432 tokens summarized.
Summary: The codebase is a terminal AI coding agent called openclaw-mini built on the PI SDK...

> /status
Auto-compact: on
```

When the context overflows:

```
> [after many long exchanges]
Context overflow: conversation too large for model.
Try /compact to summarize history, or /new to start fresh.
```

### What changed

| File | Change |
|---|---|
| `src/entry.ts` | ~75 lines added — `/compact` command handler, `autoCompact`/`lastSession` state, session kept alive between prompts, compaction events always visible, context overflow error recovery |

### Branch

```
git checkout part-5/context-compaction
```

---

## Project Structure

```
src/
├── entry.ts                # Main REPL, session management, skill discovery
├── system-prompt.ts        # System prompt builder with context and skill injection
├── tool-loop-detection.ts  # Circuit breaker for stuck tool loops
└── tools/
    ├── web-fetch.ts        # URL content fetching via Mozilla Readability
    └── web-search.ts       # Web search (Brave Search / Perplexity)
skills/
├── git-commit/        # Conventional commit workflow
│   └── SKILL.md
├── code-review/       # Structured code review checklist
│   └── SKILL.md
├── skill-creator/     # Meta skill — creates new skills on the fly
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
