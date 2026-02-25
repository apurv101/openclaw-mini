---
name: summarize
description: Summarize files, directories, or project structure into concise overviews
---

When asked to summarize code or a project:

**Single file**: Read the file and produce:
- Purpose (one sentence)
- Key exports/classes/functions (bulleted list)
- Dependencies (imports from external packages)
- Line count and language

**Directory or project**: List the structure, then produce:
- Overall purpose and architecture
- Directory layout with brief descriptions
- Key entry points
- Tech stack (languages, frameworks, notable dependencies)
- Approximate size (file count, total lines)

**Output format**:
```
## Summary: <name>

**Purpose**: One-line description.

**Structure**:
- dir/ — description
- file — description

**Key components**: Brief explanation of main modules.

**Tech stack**: Languages, frameworks, tools.
```

Keep summaries concise. Use bullet points over paragraphs. Prioritize what an engineer needs to orient themselves quickly.
