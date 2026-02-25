---
name: skill-creator
description: Create new skills for openclaw-mini. Use when the user wants to create, design, or build a custom skill, workflow, or automation.
---

When asked to create a skill, follow these steps:

## 1. Understand

Ask the user:
- What should the skill do? Get 1-2 concrete usage examples.
- Should it be a **user skill** (available in all projects) or **project skill** (shared with the team)?

Default to user skill if not specified.

## 2. Create

A skill is a directory with a single `SKILL.md` file:

```
skill-name/
└── SKILL.md
```

**Naming rules:**
- Lowercase letters, digits, and hyphens only
- No leading, trailing, or consecutive hyphens
- Max 64 characters
- Directory name must match the `name` in frontmatter

**SKILL.md format:**

```yaml
---
name: skill-name
description: What the skill does and WHEN to use it
---

Instructions in Markdown for an AI agent.

1. Step one — which tools to use and how
2. Step two — what to check or analyze
3. Step three — how to present the output
```

**Writing tips:**
- The `description` triggers the skill — be specific about WHEN to use it (max 1024 chars)
- Write in imperative form for another AI agent, not a human
- Reference tools by name: `read`, `write`, `edit`, `bash`, `web_fetch`, `web_search`
- Keep it concise — only include what the agent wouldn't already know

**Write the skill:**

```bash
mkdir -p <skills-dir>/<skill-name>
```

Then use `write` to create `SKILL.md` in that directory.

Paths:
- User skills: `~/.openclaw-mini/agents/main/agent/skills/<skill-name>/SKILL.md`
- Project skills: `<workspace>/.openclaw-mini/skills/<skill-name>/SKILL.md`

## 3. Verify

1. Read back the file to confirm correctness
2. Tell the user the skill is available on the next prompt
