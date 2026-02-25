/**
 * System prompt builder for openclaw-mini.
 *
 * Adapted from openclaw-mini's buildAgentSystemPrompt — stripped of channel-specific
 * sections (messaging, reactions, TTS, heartbeats, silent replies) and focused
 * purely on coding intelligence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Context file loading ────────────────────────────────────────────────────

const CONTEXT_FILE_NAMES = [
  "CONTEXT.md",
  "INSTRUCTIONS.md",
  "INSTRUCTIONS.txt",
  "SOUL.md",
  "CLAUDE.md",
  ".openclaw-mini/CONTEXT.md",
  ".github/copilot-instructions.md",
];

export type ContextFile = { path: string; content: string };

export function loadContextFiles(workspaceDir: string): ContextFile[] {
  const files: ContextFile[] = [];
  for (const name of CONTEXT_FILE_NAMES) {
    const filePath = path.join(workspaceDir, name);
    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content) {
        files.push({ path: name, content });
      }
    } catch {
      // File doesn't exist
    }
  }
  return files;
}

// ─── Runtime info ────────────────────────────────────────────────────────────

export type RuntimeInfo = {
  host: string;
  os: string;
  arch: string;
  node: string;
  shell: string;
  model: string;
  provider: string;
};

export function detectRuntime(provider: string, modelId: string): RuntimeInfo {
  return {
    host: os.hostname(),
    os: process.platform,
    arch: process.arch,
    node: process.version,
    shell: path.basename(process.env.SHELL ?? "bash"),
    model: modelId,
    provider,
  };
}

// ─── Tool summaries ──────────────────────────────────────────────────────────

const CORE_TOOL_SUMMARIES: Record<string, string> = {
  read: "Read file contents",
  write: "Create or overwrite files",
  edit: "Make precise edits to files",
  bash: "Run shell commands",
  apply_patch: "Apply multi-file patches",
  grep: "Search file contents for patterns",
  find: "Find files by glob pattern",
  ls: "List directory contents",
  exec: "Run shell commands (pty available for TTY-required CLIs)",
  process: "Manage background exec sessions",
  web_search: "Search the web (Brave/Perplexity/Grok)",
  web_fetch: "Fetch and extract readable content from a URL",
  browser: "Control web browser",
  image: "Analyze an image with the configured image model",
};

// ─── System prompt builder ───────────────────────────────────────────────────

export function buildSystemPrompt(params: {
  workspaceDir: string;
  runtime: RuntimeInfo;
  toolNames: string[];
  contextFiles: ContextFile[];
  thinkingLevel?: string;
  skillsPrompt?: string;
}): string {
  const { workspaceDir, runtime, toolNames, contextFiles, thinkingLevel, skillsPrompt } = params;

  const availableTools = new Set(toolNames.map((t) => t.toLowerCase()));

  // Tool lines
  const toolLines = toolNames
    .map((name) => {
      const summary = CORE_TOOL_SUMMARIES[name];
      return summary ? `- ${name}: ${summary}` : `- ${name}`;
    })
    .filter(Boolean);

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const currentTime = now.toLocaleString("en-US", {
    timeZone: userTimezone,
    dateStyle: "full",
    timeStyle: "long",
  });

  const lines = [
    "You are a personal coding assistant running inside openclaw-mini.",
    "",
    "## Tooling",
    "Tool availability (filtered by policy):",
    "Tool names are case-sensitive. Call tools exactly as listed.",
    toolLines.join("\n"),
    "For long waits, avoid rapid poll loops: use exec with enough yieldMs or process(action=poll, timeout=<ms>).",
    "",
    "## Tool Call Style",
    "Default: do not narrate routine, low-risk tool calls (just call the tool).",
    "Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
    "Keep narration brief and value-dense; avoid repeating obvious steps.",
    "Use plain human language for narration unless in a technical context.",
    "",
    "## Safety",
    "You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.",
    "Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards.",
    "Do not manipulate or persuade anyone to expand access or disable safeguards.",
    "",
    "## Workspace",
    `Your working directory is: ${workspaceDir}`,
    "Treat this directory as the single global workspace for file operations unless explicitly instructed otherwise.",
    "",
    "## Current Date & Time",
    `Time zone: ${userTimezone}`,
    `Current time: ${currentTime}`,
    "",
  ];

  // llms.txt discovery
  if (availableTools.has("web_fetch")) {
    lines.push(
      "## llms.txt Discovery",
      "When exploring a new domain or website (via web_fetch or browser), check for an llms.txt file that describes how AI agents should interact with the site:",
      "- Try `/llms.txt` or `/.well-known/llms.txt` at the domain root",
      "- If found, follow its guidance for interacting with that site's content and APIs",
      "- llms.txt is an emerging standard (like robots.txt for AI) — not all sites have one, so don't warn if missing",
      "",
    );
  }

  // Skills catalog
  if (skillsPrompt) {
    lines.push("## Skills", skillsPrompt, "");
  }

  // Context files
  if (contextFiles.length > 0) {
    const hasSoulFile = contextFiles.some(
      (f) => path.basename(f.path).toLowerCase() === "soul.md",
    );
    lines.push(
      "# Project Context",
      "",
      "The following project context files have been loaded:",
    );
    if (hasSoulFile) {
      lines.push(
        "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      );
    }
    lines.push("");
    for (const file of contextFiles) {
      lines.push(`## ${file.path}`, "", file.content, "");
    }
  }

  // Runtime
  const runtimeParts = [
    runtime.host ? `host=${runtime.host}` : "",
    runtime.os ? `os=${runtime.os} (${runtime.arch})` : "",
    runtime.node ? `node=${runtime.node}` : "",
    runtime.model ? `model=${runtime.provider}/${runtime.model}` : "",
    runtime.shell ? `shell=${runtime.shell}` : "",
    `thinking=${thinkingLevel ?? "off"}`,
  ].filter(Boolean);

  lines.push("## Runtime", `Runtime: ${runtimeParts.join(" | ")}`);

  return lines.filter((line) => line !== undefined).join("\n");
}
