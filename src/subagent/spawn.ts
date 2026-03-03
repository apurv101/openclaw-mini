/**
 * Subagent spawner — creates and runs child agent sessions.
 *
 * Each subagent gets:
 * - Its own isolated context window (in-memory session)
 * - Restricted tools (coding tools only — no spawn_subagent)
 * - A focused system prompt
 * - An AbortController-based timeout
 *
 * The parent's auth, model, and workspace are reused.
 */

import crypto from "node:crypto";
import {
  createAgentSession,
  createCodingTools,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { SubagentConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { SubagentRegistry } from "./registry.js";
import { buildSubagentPrompt } from "./prompt.js";

export interface SpawnContext {
  workspaceDir: string;
  agentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<Api>;
  registry: SubagentRegistry;
  config: SubagentConfig;
}

export interface SpawnResult {
  id: string;
  result: string;
  toolsUsed: string[];
  durationMs: number;
}

/**
 * Spawn a subagent to handle a focused task.
 *
 * Flow:
 * 1. Cleanup stale entries
 * 2. Check concurrency limits
 * 3. Register the run
 * 4. Create an isolated session with restricted tools
 * 5. Run the task with timeout enforcement
 * 6. Collect and return results
 */
export async function spawnSubagent(
  ctx: SpawnContext,
  task: string,
  label?: string,
): Promise<SpawnResult> {
  // 1. Pre-flight checks
  const check = ctx.registry.canSpawn();
  if (!check.ok) {
    throw new Error(check.reason);
  }

  // 2. Register the run
  const id = crypto.randomUUID();
  const displayLabel = label || task.slice(0, 40) + (task.length > 40 ? "..." : "");

  ctx.registry.register({
    id,
    task,
    label: displayLabel,
    status: "running",
    startedAt: Date.now(),
  });

  // 3. Set up timeout via AbortController
  const timeoutMs = ctx.config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let session: any = null;

  try {
    // 4. Create isolated child session
    const settingsManager = SettingsManager.create(ctx.workspaceDir, ctx.agentDir);

    // Restricted tools: coding tools only (read, write, edit, bash)
    // No spawn_subagent — this is how we enforce max depth = 1
    const childTools = createCodingTools(ctx.workspaceDir);

    const { session: childSession } = await createAgentSession({
      cwd: ctx.workspaceDir,
      agentDir: ctx.agentDir,
      authStorage: ctx.authStorage,
      modelRegistry: ctx.modelRegistry,
      model: ctx.model,
      tools: childTools,
      customTools: [],
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });
    session = childSession;

    // Override system prompt with focused subagent prompt
    const subagentPrompt = buildSubagentPrompt(ctx.workspaceDir);
    session.agent.setSystemPrompt(subagentPrompt);

    session.agent.streamFn = streamSimple;

    // 5. Run the task
    if (controller.signal.aborted) {
      throw new Error("Subagent timed out before execution");
    }

    // Listen for abort to cancel the session
    const onAbort = () => session?.abort();
    controller.signal.addEventListener("abort", onAbort, { once: true });

    await session.prompt(task);

    controller.signal.removeEventListener("abort", onAbort);

    // 6. Collect results
    const resultText = session.getLastAssistantText() ?? extractAssistantText(session.messages);
    const toolsUsed = extractToolNames(session.messages);
    const durationMs = Date.now() - ctx.registry.getAll().find((r) => r.id === id)!.startedAt;

    ctx.registry.complete(id, resultText || "(no output)", toolsUsed);

    return { id, result: resultText || "(no output)", toolsUsed, durationMs };
  } catch (err: any) {
    const isTimeout = controller.signal.aborted;
    const errorMsg = isTimeout
      ? `Timed out after ${Math.round(timeoutMs / 1000)}s`
      : err.message || String(err);

    ctx.registry.fail(id, errorMsg);

    throw new Error(`Subagent failed: ${errorMsg}`);
  } finally {
    clearTimeout(timer);
    if (session) {
      try { session.dispose(); } catch { /* ignore */ }
    }
  }
}

/** Extract final assistant text from message history. */
function extractAssistantText(messages: any[]): string {
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

/** Extract unique tool names used during the session. */
function extractToolNames(messages: any[]): string[] {
  const names = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool_use" && part.name) {
        names.add(part.name);
      }
    }
  }
  return Array.from(names);
}
