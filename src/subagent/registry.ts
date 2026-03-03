/**
 * Subagent registry — tracks active and completed subagent runs.
 *
 * Responsibilities:
 * 1. Concurrency enforcement — reject spawns when at capacity
 * 2. Stale entry cleanup — force-expire runs that exceed timeout
 * 3. Run lifecycle tracking — register, complete, fail, expire
 */

import type { SubagentConfig, SubagentRun } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

export class SubagentRegistry {
  private runs = new Map<string, SubagentRun>();
  private config: SubagentConfig;

  constructor(config: Partial<SubagentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check whether a new subagent can be spawned.
   * Runs stale cleanup first so expired entries don't block new spawns.
   */
  canSpawn(): { ok: boolean; reason?: string } {
    this.cleanupStale();

    const active = this.getActive();
    if (active.length >= this.config.maxConcurrent) {
      return {
        ok: false,
        reason: `Max ${this.config.maxConcurrent} concurrent subagents. ${active.length} currently running: ${active.map((r) => r.label).join(", ")}. Wait for one to complete.`,
      };
    }

    return { ok: true };
  }

  /** Register a new run. Called at spawn time. */
  register(run: SubagentRun): void {
    this.runs.set(run.id, run);
  }

  /** Mark a run as completed with its result. */
  complete(id: string, result: string, toolsUsed?: string[]): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = "completed";
    run.endedAt = Date.now();
    run.result = result;
    if (toolsUsed) run.toolsUsed = toolsUsed;
  }

  /** Mark a run as failed with an error message. */
  fail(id: string, error: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = "failed";
    run.endedAt = Date.now();
    run.error = error;
  }

  /** Mark a run as expired (timed out). */
  private expire(id: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = "expired";
    run.endedAt = Date.now();
    run.error = `Timed out after ${Math.round(this.config.timeoutMs / 1000)}s`;
  }

  /** Get all currently running subagents. */
  getActive(): SubagentRun[] {
    return Array.from(this.runs.values()).filter((r) => r.status === "running");
  }

  /** Get all runs (for /agents display). Most recent first. */
  getAll(): SubagentRun[] {
    return Array.from(this.runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Force-expire any running subagents that have exceeded the timeout.
   * Returns the number of entries expired.
   */
  cleanupStale(): number {
    const now = Date.now();
    let expired = 0;

    for (const [id, run] of this.runs) {
      if (run.status === "running" && now - run.startedAt > this.config.timeoutMs) {
        this.expire(id);
        expired++;
      }
    }

    return expired;
  }

  /** Reset all state (e.g., on /new). */
  reset(): void {
    this.runs.clear();
  }
}
