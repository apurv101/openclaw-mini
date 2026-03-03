/**
 * Subagent system types and configuration defaults.
 *
 * A subagent is a child agent session spawned by the parent to handle
 * a focused task in its own isolated context window.
 */

export interface SubagentRun {
  id: string;
  task: string;
  label: string;
  status: "running" | "completed" | "failed" | "expired";
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
  toolsUsed?: string[];
}

export interface SubagentConfig {
  /** Max subagents running simultaneously (default: 3) */
  maxConcurrent: number;
  /** Max nesting depth — 1 means no grandchildren (default: 1) */
  maxDepth: number;
  /** Force-expire running subagents after this many ms (default: 5 min) */
  timeoutMs: number;
}

export const DEFAULT_CONFIG: SubagentConfig = {
  maxConcurrent: 3,
  maxDepth: 1,
  timeoutMs: 5 * 60_000,
};
