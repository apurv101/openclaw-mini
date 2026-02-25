#!/usr/bin/env node
/**
 * openclaw-mini: Terminal-only AI agent with full coding intelligence.
 *
 * Uses the PI SDK directly — same engine as openclaw-mini, no channel overhead.
 * Enhanced with: rich system prompt, web tools, context file loading.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  loadSkillsFromDir,
  formatSkillsForPrompt,
  type Skill,
} from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  buildSystemPrompt,
  detectRuntime,
  loadContextFiles,
} from "./system-prompt.js";
import { createWebFetchToolDefinition } from "./tools/web-fetch.js";
import { createWebSearchToolDefinition } from "./tools/web-search.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const OPENCLAW_HOME = path.join(os.homedir(), ".openclaw-mini");
const AGENT_ID = process.env.OPENCLAW_MINI_AGENT ?? "main";
const AGENT_DIR = path.join(OPENCLAW_HOME, "agents", AGENT_ID, "agent");
const MODELS_JSON = path.join(AGENT_DIR, "models.json");
const AUTH_PROFILES_JSON = path.join(AGENT_DIR, "auth-profiles.json");
const SESSION_DIR = path.join(OPENCLAW_HOME, "state", "sessions", "mini");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_SKILLS_DIR = path.join(__dirname, "..", "skills");
const USER_SKILLS_DIR = path.join(AGENT_DIR, "skills");

const DEFAULT_PROVIDER = process.env.OPENCLAW_MINI_PROVIDER ?? "anthropic";
const DEFAULT_MODEL = process.env.OPENCLAW_MINI_MODEL ?? "claude-sonnet-4-20250514";

// ─── Ensure directories ─────────────────────────────────────────────────────

function ensureDirs() {
  for (const dir of [OPENCLAW_HOME, AGENT_DIR, SESSION_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

type AuthProfile = { type: string; provider: string; token?: string };
type AuthProfiles = {
  profiles?: Record<string, AuthProfile>;
  lastGood?: Record<string, string>;
};

function loadApiKeyFromProfiles(provider: string): string | undefined {
  try {
    const raw = fs.readFileSync(AUTH_PROFILES_JSON, "utf-8");
    const data: AuthProfiles = JSON.parse(raw);
    const profiles = data.profiles ?? {};

    const lastGoodKey = data.lastGood?.[provider];
    if (lastGoodKey && profiles[lastGoodKey]?.token) {
      return profiles[lastGoodKey]!.token;
    }

    for (const profile of Object.values(profiles)) {
      if (profile.provider === provider && profile.token) {
        return profile.token;
      }
    }
  } catch {
    // File doesn't exist or can't be parsed
  }
  return undefined;
}

const ENV_KEY_MAP: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
};

function ensureApiKeyInEnv(provider: string): boolean {
  const envKeys = ENV_KEY_MAP[provider] ?? [`${provider.toUpperCase()}_API_KEY`];

  for (const envKey of envKeys) {
    if (process.env[envKey]) return true;
  }

  const apiKey = loadApiKeyFromProfiles(provider);
  if (apiKey && envKeys[0]) {
    process.env[envKeys[0]] = apiKey;
    return true;
  }

  return false;
}

// ─── Model resolution ────────────────────────────────────────────────────────

function resolveModelAndAuth(provider: string, modelId: string) {
  const authJsonPath = path.join(AGENT_DIR, "auth.json");
  const authStorage = new AuthStorage(authJsonPath);
  const modelRegistry = new ModelRegistry(authStorage, MODELS_JSON);

  let model = modelRegistry.find(provider, modelId) as Model<Api> | null;

  if (!model) {
    const apiType = resolveApiType(provider);
    model = {
      id: modelId,
      name: modelId,
      api: apiType,
      provider,
      input: ["text", "image"],
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 64_000,
    } as Model<Api>;
  }

  return { model, authStorage, modelRegistry };
}

function resolveApiType(provider: string): string {
  const apiMap: Record<string, string> = {
    anthropic: "anthropic",
    openai: "openai-responses",
    google: "google",
    ollama: "ollama",
    groq: "openai",
    xai: "openai",
    mistral: "openai",
    openrouter: "openai",
    cerebras: "openai",
  };
  return apiMap[provider] ?? "openai";
}

// ─── Session management ──────────────────────────────────────────────────────

function resolveSessionFile(sessionId: string): string {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

// ─── Custom tools ────────────────────────────────────────────────────────────

function buildCustomTools() {
  const tools: any[] = [];

  // Always add web_fetch — it's useful regardless of API keys
  tools.push(createWebFetchToolDefinition());

  // Add web_search — works with BRAVE_API_KEY, PERPLEXITY_API_KEY, or OPENROUTER_API_KEY
  tools.push(createWebSearchToolDefinition());

  return tools;
}

// ─── Skill discovery ────────────────────────────────────────────────────────

function discoverSkills(workspaceDir: string): { skills: Skill[]; diagnostics: string[] } {
  const skillMap = new Map<string, Skill>();
  const diagnostics: string[] = [];

  const sources: Array<{ dir: string; source: string }> = [
    { dir: USER_SKILLS_DIR, source: "user" },
    { dir: path.join(workspaceDir, ".openclaw-mini", "skills"), source: "project" },
    { dir: BUNDLED_SKILLS_DIR, source: "bundled" },
  ];

  for (const { dir, source } of sources) {
    try {
      const result = loadSkillsFromDir({ dir, source });
      for (const diag of result.diagnostics) {
        diagnostics.push(`[${source}] ${diag.message}`);
      }
      for (const skill of result.skills) {
        if (!skillMap.has(skill.name)) {
          skillMap.set(skill.name, skill);
        }
      }
    } catch {
      // Directory doesn't exist — skip silently
    }
  }

  return { skills: Array.from(skillMap.values()), diagnostics };
}

// ─── System prompt override ──────────────────────────────────────────────────

function applySystemPromptToSession(
  session: any,
  systemPrompt: string,
) {
  session.agent.setSystemPrompt(systemPrompt);
  // Override internal SDK system prompt to prevent it from being rebuilt
  const mutable = session as unknown as {
    _baseSystemPrompt?: string;
    _rebuildSystemPrompt?: (toolNames: string[]) => string;
  };
  mutable._baseSystemPrompt = systemPrompt;
  mutable._rebuildSystemPrompt = () => systemPrompt;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("");
      if (text) return text;
    }
  }
  return "";
}

function extractToolCalls(messages: AgentMessage[]): string[] {
  const toolCalls: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if ((part as any).type === "tool_use") {
        toolCalls.push((part as any).name ?? "unknown");
      }
    }
  }
  return toolCalls;
}

// ─── REPL ────────────────────────────────────────────────────────────────────

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

async function main() {
  ensureDirs();

  const provider = DEFAULT_PROVIDER;
  const modelId = DEFAULT_MODEL;
  const workspaceDir = process.cwd();
  let sessionId = `mini-${Date.now()}`;
  let sessionFile = resolveSessionFile(sessionId);
  let thinkingLevel: ThinkingLevel = "off";

  // Ensure API key is available
  const hasKey = ensureApiKeyInEnv(provider);
  if (!hasKey) {
    const envKey = ENV_KEY_MAP[provider]?.[0] ?? `${provider.toUpperCase()}_API_KEY`;
    console.error(`No API key found for ${provider}.`);
    console.error(`Set ${envKey} or run "openclaw-mini configure" to set up auth.`);
    process.exit(1);
  }

  const { model, authStorage, modelRegistry } = resolveModelAndAuth(provider, modelId);

  // Build system prompt
  const runtime = detectRuntime(provider, modelId);
  const contextFiles = loadContextFiles(workspaceDir);
  const customTools = buildCustomTools();
  const customToolNames = customTools.map((t: any) => t.name);

  // The PI SDK provides these built-in tools (read, bash, edit, write are default active)
  const builtInToolNames = ["read", "bash", "edit", "write"];
  const allToolNames = [...builtInToolNames, ...customToolNames];

  // Discover skills (initial load for startup banner; re-discovered each prompt for hot-reload)
  let { skills } = discoverSkills(workspaceDir);
  let skillsPrompt = skills.length > 0 ? formatSkillsForPrompt(skills) : undefined;

  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    runtime,
    toolNames: allToolNames,
    contextFiles,
    thinkingLevel,
    skillsPrompt,
  });

  console.log(`\x1b[2m┌ openclaw-mini\x1b[0m`);
  console.log(`\x1b[2m│ model: ${provider}/${modelId}\x1b[0m`);
  console.log(`\x1b[2m│ workspace: ${workspaceDir}\x1b[0m`);
  console.log(`\x1b[2m│ session: ${sessionId}\x1b[0m`);
  console.log(
    `\x1b[2m│ context: ${contextFiles.length > 0 ? contextFiles.map((f) => f.path).join(", ") : "none"}\x1b[0m`,
  );
  console.log(`\x1b[2m│ tools: ${allToolNames.join(", ")}\x1b[0m`);
  console.log(`\x1b[2m│ skills: ${skills.length > 0 ? skills.map((s) => s.name).join(", ") : "none"}\x1b[0m`);
  console.log(`\x1b[2m└ /new /think /model /skills /quit\x1b[0m`);
  console.log();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  while (true) {
    let input: string;
    try {
      input = await rl.question("\x1b[1m> \x1b[0m");
    } catch {
      break; // EOF
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // Slash commands
    if (trimmed === "/quit" || trimmed === "/exit") break;
    if (trimmed === "/new") {
      sessionId = `mini-${Date.now()}`;
      sessionFile = resolveSessionFile(sessionId);
      console.log(`\x1b[2mNew session: ${sessionId}\x1b[0m\n`);
      continue;
    }
    if (trimmed.startsWith("/model")) {
      console.log(`\x1b[2mCurrent: ${provider}/${modelId}\x1b[0m`);
      console.log(
        `\x1b[2mChange via OPENCLAW_MINI_PROVIDER and OPENCLAW_MINI_MODEL env vars.\x1b[0m\n`,
      );
      continue;
    }
    if (trimmed === "/think" || trimmed.startsWith("/think ")) {
      const arg = trimmed.slice("/think".length).trim().toLowerCase();
      const validLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
      if (validLevels.includes(arg as ThinkingLevel)) {
        thinkingLevel = arg as ThinkingLevel;
      } else if (!arg) {
        thinkingLevel = thinkingLevel === "off" ? "medium" : "off";
      } else {
        console.log(`\x1b[2mValid levels: ${validLevels.join(", ")}\x1b[0m\n`);
        continue;
      }
      console.log(`\x1b[2mThinking: ${thinkingLevel}\x1b[0m\n`);
      continue;
    }
    if (trimmed === "/status") {
      console.log(`\x1b[2mModel: ${provider}/${modelId}\x1b[0m`);
      console.log(`\x1b[2mSession: ${sessionId}\x1b[0m`);
      console.log(`\x1b[2mThinking: ${thinkingLevel}\x1b[0m`);
      console.log(`\x1b[2mWorkspace: ${workspaceDir}\x1b[0m`);
      console.log(
        `\x1b[2mContext files: ${contextFiles.length > 0 ? contextFiles.map((f) => f.path).join(", ") : "none"}\x1b[0m`,
      );
      console.log(`\x1b[2mSkills: ${skills.length > 0 ? skills.map((s) => s.name).join(", ") : "none"}\x1b[0m\n`);
      continue;
    }
    if (trimmed === "/skills") {
      if (skills.length === 0) {
        console.log(`\x1b[2mNo skills loaded.\x1b[0m\n`);
      } else {
        console.log(`\x1b[2mLoaded skills (${skills.length}):\x1b[0m`);
        for (const skill of skills) {
          const src = `[${skill.source}]`.padEnd(10);
          console.log(`\x1b[2m  ${src} ${skill.name} — ${skill.description}\x1b[0m`);
        }
        console.log();
      }
      continue;
    }

    // Run agent
    const startTime = Date.now();
    try {
      const sessionManager = SessionManager.open(sessionFile);
      const settingsManager = SettingsManager.create(workspaceDir, AGENT_DIR);

      // Re-discover skills each prompt to pick up newly created ones (hot-reload)
      const freshSkills = discoverSkills(workspaceDir);
      skills = freshSkills.skills;
      skillsPrompt = skills.length > 0 ? formatSkillsForPrompt(skills) : undefined;

      // Build resource loader with skill paths for SDK's /skill:name expansion
      const resourceLoader = new DefaultResourceLoader({
        cwd: workspaceDir,
        agentDir: AGENT_DIR,
        settingsManager,
        additionalSkillPaths: [USER_SKILLS_DIR, path.join(workspaceDir, ".openclaw-mini", "skills"), BUNDLED_SKILLS_DIR],
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await resourceLoader.reload();

      // Rebuild system prompt with current thinking level
      const currentSystemPrompt = buildSystemPrompt({
        workspaceDir,
        runtime,
        toolNames: allToolNames,
        contextFiles,
        thinkingLevel,
        skillsPrompt,
      });

      const { session } = await createAgentSession({
        cwd: workspaceDir,
        agentDir: AGENT_DIR,
        authStorage,
        modelRegistry,
        model,
        thinkingLevel,
        customTools,
        sessionManager,
        settingsManager,
        resourceLoader,
      });

      // Override the SDK's default system prompt with our enriched one
      applySystemPromptToSession(session, currentSystemPrompt);

      session.agent.streamFn = streamSimple;

      await session.prompt(trimmed);

      // Check for silent errors
      const agentError = session.agent.state.error;
      if (agentError) {
        console.error(`\x1b[31mAgent error: ${agentError}\x1b[0m`);
      }

      // Extract and display results
      const toolCalls = extractToolCalls(session.messages);
      if (toolCalls.length > 0) {
        console.log(
          `\x1b[2m[tools: ${toolCalls.join(", ")}]\x1b[0m`,
        );
      }

      const text = session.getLastAssistantText() ?? extractAssistantText(session.messages);
      if (text) {
        console.log(text);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\x1b[2m(${elapsed}s)\x1b[0m\n`);

      session.dispose();
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      if (err.cause) {
        console.error(`\x1b[2m${String(err.cause)}\x1b[0m`);
      }
      console.log();
    }
  }

  rl.close();
  console.log("\x1b[2mBye.\x1b[0m");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
