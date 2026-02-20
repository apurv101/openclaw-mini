/**
 * Simplified web_fetch tool for openclaw-mini.
 *
 * Fetches a URL, extracts readable content using @mozilla/readability + linkedom,
 * and returns markdown or text. No firecrawl, no SSRF guards beyond URL validation.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Simple in-memory cache
const cache = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function readCache(key: string): Record<string, unknown> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: Record<string, unknown>) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + "\n\n[Truncated]", truncated: true };
}

function htmlToMarkdown(html: string, url: string): { text: string; title?: string } {
  const { document } = parseHTML(html);
  // Set the document URL for Readability to resolve relative links
  try {
    Object.defineProperty(document, "baseURI", { value: url, writable: true });
  } catch {
    // Ignore if property can't be set
  }
  const reader = new Readability(document as any);
  const article = reader.parse();
  if (!article || !article.textContent?.trim()) {
    return { text: "" };
  }
  // Return the text content with the title
  const content = article.content || article.textContent;
  return { text: content, title: article.title || undefined };
}

function markdownFromText(text: string): string {
  // Very basic: strip excessive whitespace
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export async function runWebFetch(params: {
  url: string;
  extractMode?: "markdown" | "text";
  maxChars?: number;
}): Promise<Record<string, unknown>> {
  const { url, extractMode = "markdown" } = params;
  const maxChars = Math.max(100, params.maxChars ?? DEFAULT_MAX_CHARS);

  const cacheKey = `fetch:${url}:${extractMode}:${maxChars}`;
  const cached = readCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL: must be http or https");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL: must be http or https");
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "text/markdown, text/html;q=0.9, */*;q=0.1",
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Web fetch failed (${res.status}): ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const body = await res.text();

  let title: string | undefined;
  let extractor = "raw";
  let text = body;

  if (contentType.includes("text/markdown")) {
    extractor = "cf-markdown";
    text = extractMode === "text" ? markdownFromText(body) : body;
  } else if (contentType.includes("text/html")) {
    const readable = htmlToMarkdown(body, url);
    if (readable.text) {
      text = readable.text;
      title = readable.title;
      extractor = "readability";
    }
  } else if (contentType.includes("application/json")) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
      extractor = "json";
    } catch {
      extractor = "raw";
    }
  }

  const truncated = truncate(text, maxChars);
  const payload: Record<string, unknown> = {
    url,
    status: res.status,
    contentType: contentType.split(";")[0]?.trim(),
    title,
    extractMode,
    extractor,
    truncated: truncated.truncated,
    length: truncated.text.length,
    tookMs: Date.now() - start,
    text: truncated.text,
  };

  writeCache(cacheKey, payload);
  return payload;
}

export function createWebFetchToolDefinition() {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract readable content from a URL (HTML → markdown/text). Use for lightweight page access without browser automation. When exploring a new domain, also check for /llms.txt or /.well-known/llms.txt.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
        extractMode: {
          type: "string",
          enum: ["markdown", "text"],
          description: 'Extraction mode ("markdown" or "text"). Default: "markdown".',
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return (truncates when exceeded).",
          minimum: 100,
        },
      },
      required: ["url"],
    },
    execute: async (
      _toolCallId: string,
      args: unknown,
    ): Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }> => {
      const params = (args ?? {}) as Record<string, unknown>;
      const url = String(params.url ?? "").trim();
      if (!url) throw new Error("url is required");

      const extractMode =
        params.extractMode === "text" ? "text" : ("markdown" as "markdown" | "text");
      const maxChars =
        typeof params.maxChars === "number" && Number.isFinite(params.maxChars)
          ? params.maxChars
          : undefined;

      const result = await runWebFetch({ url, extractMode, maxChars });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { url, status: result.status, extractor: result.extractor },
      };
    },
  };
}
