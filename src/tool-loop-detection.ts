/**
 * Tool Loop Detection — circuit breaker for stuck AI agents.
 *
 * Detects 4 patterns with progressive escalation (warn → block):
 *   1. Generic Repeat:      same tool+params called ≥10x → warning
 *   2. No-Progress Critical: same tool+params+result ≥20x → block
 *   3. Ping-Pong:           alternating A→B→A→B ≥10x warn, ≥20x block
 *   4. Global Circuit Breaker: any tool ≥30x identical outcomes → block
 *
 * Simplified from openclaw's 624-line implementation to ~150 lines.
 * Every production concept preserved: stable hashing, sliding window,
 * progressive escalation, warning dedup, tool wrapping decorator.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

type ToolCallRecord = {
  key: string; // toolName:stableStringify(params)
  toolName: string;
  resultKey?: string; // stableStringify(result) or "error:message"
};

type DetectionResult =
  | { stuck: false }
  | { stuck: true; level: "warning" | "critical"; message: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const HISTORY_SIZE = 30;
const WARNING_THRESHOLD = 10;
const CRITICAL_THRESHOLD = 20;
const CIRCUIT_BREAKER_THRESHOLD = 30;
const WARNING_BUCKET_SIZE = 10;

// ─── Stable Hashing ─────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function toolKey(name: string, params: unknown): string {
  return `${name}:${stableStringify(params)}`;
}

function outcomeKey(result: unknown, error: unknown): string | undefined {
  if (error !== undefined) {
    return `error:${error instanceof Error ? error.message : String(error)}`;
  }
  if (result === undefined) return undefined;
  // Extract text content from tool results for stable comparison
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as any).content)
  ) {
    const text = (result as any).content
      .filter((e: any) => typeof e?.text === "string")
      .map((e: any) => e.text)
      .join("\n")
      .trim();
    return `text:${text}`;
  }
  return stableStringify(result);
}

// ─── Detector ────────────────────────────────────────────────────────────────

export class ToolLoopDetector {
  private history: ToolCallRecord[] = [];
  private warningBuckets = new Map<string, number>();

  /** Wrap a tool's execute() with loop detection. */
  wrapTool<T extends { name: string; execute: (...args: any[]) => any }>(tool: T): T {
    const detector = this;
    const originalExecute = tool.execute;

    return {
      ...tool,
      execute: async (toolCallId: string, params: unknown, ...rest: any[]) => {
        // Pre-flight check
        const check = detector.detect(tool.name, params);
        if (check.stuck && check.level === "critical") {
          detector.record(tool.name, params);
          throw new Error(check.message);
        }
        if (check.stuck && check.level === "warning") {
          if (detector.shouldWarn(tool.name, params)) {
            console.error(`\x1b[33m[loop-detection] ${check.message}\x1b[0m`);
          }
        }

        // Execute and record outcome
        try {
          const result = await originalExecute.call(tool, toolCallId, params, ...rest);
          detector.record(tool.name, params, result);
          return result;
        } catch (err) {
          detector.record(tool.name, params, undefined, err);
          throw err;
        }
      },
    };
  }

  /** Record a tool call with its outcome. */
  record(name: string, params: unknown, result?: unknown, error?: unknown): void {
    this.history.push({
      key: toolKey(name, params),
      toolName: name,
      resultKey: outcomeKey(result, error),
    });
    if (this.history.length > HISTORY_SIZE) this.history.shift();
  }

  /** Run all 4 detectors in severity order. */
  detect(name: string, params: unknown): DetectionResult {
    const key = toolKey(name, params);
    const streak = this.getNoProgressStreak(key);

    // 1. Global circuit breaker — always blocks
    if (streak >= CIRCUIT_BREAKER_THRESHOLD) {
      return {
        stuck: true,
        level: "critical",
        message: `BLOCKED: ${name} repeated ${streak} times with no progress. Circuit breaker triggered — stop retrying and report the issue.`,
      };
    }

    // 2. No-progress critical — blocks
    if (streak >= CRITICAL_THRESHOLD) {
      return {
        stuck: true,
        level: "critical",
        message: `BLOCKED: ${name} called ${streak} times with identical arguments and results. Stop retrying and try a different approach or report the task as failed.`,
      };
    }

    // 3. Ping-pong detection
    const ppCount = this.getPingPongCount(key);
    if (ppCount >= CRITICAL_THRESHOLD) {
      return {
        stuck: true,
        level: "critical",
        message: `BLOCKED: Alternating tool pattern detected (${ppCount} calls with no progress). Ping-pong loop — stop and try a different approach.`,
      };
    }
    if (ppCount >= WARNING_THRESHOLD) {
      return {
        stuck: true,
        level: "warning",
        message: `WARNING: Alternating tool pattern (${ppCount} calls). Possible ping-pong loop — if not progressing, stop retrying.`,
      };
    }

    // 4. Generic repeat — warning only
    const repeatCount = this.history.filter((h) => h.key === key).length;
    if (repeatCount >= WARNING_THRESHOLD) {
      return {
        stuck: true,
        level: "warning",
        message: `WARNING: ${name} called ${repeatCount} times with identical arguments. If not progressing, stop retrying.`,
      };
    }

    return { stuck: false };
  }

  /** Count consecutive identical outcomes for the same key, scanning from tail. */
  private getNoProgressStreak(key: string): number {
    let streak = 0;
    let expectedResult: string | undefined;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i]!;
      if (h.key !== key) continue;
      if (!h.resultKey) continue;
      if (!expectedResult) {
        expectedResult = h.resultKey;
        streak = 1;
        continue;
      }
      if (h.resultKey !== expectedResult) break;
      streak++;
    }
    return streak;
  }

  /** Detect alternating A→B→A→B pattern from tail. */
  private getPingPongCount(currentKey: string): number {
    if (this.history.length < 2) return 0;
    const last = this.history[this.history.length - 1]!;
    if (last.key === currentKey) return 0; // must alternate
    const otherKey = last.key;

    // Check alternating pattern and that both sides show no progress
    let count = 0;
    let resultA: string | undefined;
    let resultB: string | undefined;
    let noProgress = true;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const expected = count % 2 === 0 ? otherKey : currentKey;
      const h = this.history[i]!;
      if (h.key !== expected) break;

      // Track whether outcomes are stable (no progress)
      if (h.resultKey) {
        if (h.key === currentKey) {
          if (!resultA) resultA = h.resultKey;
          else if (resultA !== h.resultKey) noProgress = false;
        } else {
          if (!resultB) resultB = h.resultKey;
          else if (resultB !== h.resultKey) noProgress = false;
        }
      }
      count++;
    }

    if (count < 2 || !noProgress) return 0;
    return count + 1; // +1 for the current (not-yet-recorded) call
  }

  /** Dedup warnings — emit once per bucket of WARNING_BUCKET_SIZE occurrences. */
  private shouldWarn(name: string, params: unknown): boolean {
    const key = toolKey(name, params);
    const count = this.history.filter((h) => h.key === key).length;
    const bucket = Math.floor(count / WARNING_BUCKET_SIZE);
    const lastBucket = this.warningBuckets.get(key) ?? -1;
    if (bucket <= lastBucket) return false;
    this.warningBuckets.set(key, bucket);
    return true;
  }

  /** Clear state (call on /new session). */
  reset(): void {
    this.history = [];
    this.warningBuckets.clear();
  }
}
