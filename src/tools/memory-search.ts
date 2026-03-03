/**
 * memory_search tool for openclaw-mini.
 *
 * Keyword search across persistent memory files (~/.openclaw-mini/memory/*.md).
 * No external dependencies — pure file-based grep with context windows.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MEMORY_DIR = path.join(os.homedir(), ".openclaw-mini", "memory");
const MAX_MATCHES = 50;
const MAX_OUTPUT_CHARS = 10_000;
const MAX_FILE_BYTES = 100_000;
const CONTEXT_LINES = 2;

type MemoryMatch = {
  file: string;
  line: number;
  context: string;
  keywords: string[];
};

type MemorySearchResult = {
  query: string;
  filesSearched: number;
  matchCount: number;
  matches: MemoryMatch[];
  note?: string;
};

export function runMemorySearch(params: {
  query: string;
  file?: string;
}): MemorySearchResult {
  const keywords = params.query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0);

  if (keywords.length === 0) {
    throw new Error("query is required");
  }

  // Discover memory files
  let files: string[];
  try {
    files = fs
      .readdirSync(MEMORY_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return {
      query: params.query,
      filesSearched: 0,
      matchCount: 0,
      matches: [],
      note: `No memory directory found. Memories will be stored at ${MEMORY_DIR}/`,
    };
  }

  if (params.file) {
    files = files.filter((f) => f === params.file);
  }

  if (files.length === 0) {
    return {
      query: params.query,
      filesSearched: 0,
      matchCount: 0,
      matches: [],
      note: params.file
        ? `Memory file "${params.file}" not found.`
        : "No memory files found.",
    };
  }

  const matches: MemoryMatch[] = [];
  let outputChars = 0;

  for (const file of files) {
    if (matches.length >= MAX_MATCHES) break;

    const filePath = path.join(MEMORY_DIR, file);
    let content: string;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) {
        content = fs.readFileSync(filePath, "utf-8").slice(0, MAX_FILE_BYTES);
      } else {
        content = fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      continue; // skip unreadable files
    }

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= MAX_MATCHES || outputChars >= MAX_OUTPUT_CHARS) break;

      const lineLower = lines[i]!.toLowerCase();
      const matched = keywords.filter((k) => lineLower.includes(k));
      if (matched.length === 0) continue;

      // Build context window (±CONTEXT_LINES)
      const start = Math.max(0, i - CONTEXT_LINES);
      const end = Math.min(lines.length - 1, i + CONTEXT_LINES);
      const context = lines.slice(start, end + 1).join("\n");

      outputChars += context.length;
      matches.push({
        file,
        line: i + 1, // 1-indexed
        context,
        keywords: matched,
      });
    }
  }

  return {
    query: params.query,
    filesSearched: files.length,
    matchCount: matches.length,
    matches,
  };
}

export function createMemorySearchToolDefinition() {
  return {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search persistent memory files by keyword. Memory files are stored in ~/.openclaw-mini/memory/ as Markdown. Returns matching lines with surrounding context.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Space-separated keywords to search for in memory files. Case-insensitive.",
        },
        file: {
          type: "string",
          description:
            'Optional: search only this specific memory file (e.g., "MEMORY.md" or "typescript.md"). Default: search all.',
        },
      },
      required: ["query"],
    },
    execute: async (
      _toolCallId: string,
      args: unknown,
    ): Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }> => {
      const params = (args ?? {}) as Record<string, unknown>;
      const query = String(params.query ?? "").trim();
      if (!query) throw new Error("query is required");

      const file =
        typeof params.file === "string" ? params.file.trim() : undefined;

      const result = runMemorySearch({ query, file });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { query, filesSearched: result.filesSearched, matchCount: result.matchCount },
      };
    },
  };
}
