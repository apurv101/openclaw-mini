/**
 * spawn_subagent tool definition.
 *
 * Exposes subagent spawning as an LLM-callable tool. The parent agent
 * can delegate focused tasks to child agents with isolated context windows.
 */

import type { SpawnContext } from "./spawn.js";
import { spawnSubagent } from "./spawn.js";

export function createSubagentToolDefinition(ctx: SpawnContext) {
  return {
    name: "spawn_subagent",
    label: "Spawn Subagent",
    description: [
      "Delegate a task to a subagent with its own isolated context window.",
      "The subagent runs to completion and returns its result.",
      "Use for tasks that benefit from a fresh context: research, file analysis, focused implementation.",
      `Max ${ctx.config.maxConcurrent} concurrent subagents. Subagents cannot spawn further subagents.`,
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The task for the subagent to complete. Be specific — the subagent has no prior context.",
        },
        label: {
          type: "string",
          description:
            "Short label for tracking this subagent (e.g., 'research auth patterns'). Default: first 40 chars of task.",
        },
      },
      required: ["task"],
    },
    execute: async (
      _toolCallId: string,
      args: unknown,
    ): Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }> => {
      const params = (args ?? {}) as Record<string, unknown>;
      const task = String(params.task ?? "").trim();
      if (!task) {
        return {
          content: [{ type: "text", text: "Error: task is required." }],
        };
      }

      const label = typeof params.label === "string" ? params.label.trim() : undefined;

      try {
        const result = await spawnSubagent(ctx, task, label);

        const header = [
          `Subagent completed in ${(result.durationMs / 1000).toFixed(1)}s`,
          result.toolsUsed.length > 0 ? `Tools used: ${result.toolsUsed.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        return {
          content: [{ type: "text", text: `[${header}]\n\n${result.result}` }],
          details: {
            id: result.id,
            durationMs: result.durationMs,
            toolsUsed: result.toolsUsed,
          },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Subagent error: ${err.message}` }],
        };
      }
    },
  };
}
