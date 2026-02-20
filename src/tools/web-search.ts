/**
 * Simplified web_search tool for openclaw-mini.
 *
 * Supports Brave Search (default) and Perplexity (via OpenRouter or direct).
 * Reads API keys from environment variables.
 */

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

// Perplexity via OpenRouter
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";

// Simple cache
const cache = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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

type SearchProvider = "brave" | "perplexity";

function resolveProvider(): SearchProvider {
  if (process.env.PERPLEXITY_API_KEY || process.env.OPENROUTER_API_KEY) {
    if (!process.env.BRAVE_API_KEY) return "perplexity";
  }
  return "brave";
}

function resolvePerplexityAuth(): { apiKey: string; baseUrl: string } | null {
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (perplexityKey) {
    return { apiKey: perplexityKey, baseUrl: PERPLEXITY_DIRECT_BASE_URL };
  }
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    return { apiKey: openrouterKey, baseUrl: DEFAULT_PERPLEXITY_BASE_URL };
  }
  return null;
}

async function searchBrave(params: {
  query: string;
  count: number;
  apiKey: string;
  country?: string;
  freshness?: string;
}): Promise<Record<string, unknown>> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) url.searchParams.set("country", params.country);
  if (params.freshness) url.searchParams.set("freshness", params.freshness);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": params.apiKey,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
    }

    const data = (await res.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }>;
      };
    };

    const results = (data.web?.results ?? []).map((entry) => ({
      title: entry.title ?? "",
      url: entry.url ?? "",
      description: entry.description ?? "",
      published: entry.age || undefined,
    }));

    return {
      query: params.query,
      provider: "brave",
      count: results.length,
      results,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchPerplexity(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
}): Promise<Record<string, unknown>> {
  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const model = params.baseUrl.includes("perplexity.ai")
    ? "sonar-pro"
    : DEFAULT_PERPLEXITY_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        "HTTP-Referer": "https://openclaw-mini.ai",
        "X-Title": "OpenClaw Mini Web Search",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: params.query }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Perplexity API error (${res.status}): ${detail || res.statusText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: string[];
    };

    return {
      query: params.query,
      provider: "perplexity",
      model,
      content: data.choices?.[0]?.message?.content ?? "No response",
      citations: data.citations ?? [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runWebSearch(params: {
  query: string;
  count?: number;
  country?: string;
  freshness?: string;
}): Promise<Record<string, unknown>> {
  const provider = resolveProvider();
  const cacheKey = `search:${provider}:${params.query}:${params.count ?? DEFAULT_SEARCH_COUNT}`;
  const cached = readCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  const start = Date.now();
  let result: Record<string, unknown>;

  if (provider === "perplexity") {
    const auth = resolvePerplexityAuth();
    if (!auth) {
      return {
        error: "missing_api_key",
        message:
          "web_search needs an API key. Set BRAVE_API_KEY, PERPLEXITY_API_KEY, or OPENROUTER_API_KEY.",
      };
    }
    result = await searchPerplexity({
      query: params.query,
      apiKey: auth.apiKey,
      baseUrl: auth.baseUrl,
    });
  } else {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return {
        error: "missing_brave_api_key",
        message: "web_search needs a Brave Search API key. Set BRAVE_API_KEY.",
      };
    }
    result = await searchBrave({
      query: params.query,
      count: Math.min(MAX_SEARCH_COUNT, Math.max(1, params.count ?? DEFAULT_SEARCH_COUNT)),
      apiKey,
      country: params.country,
      freshness: params.freshness,
    });
  }

  result.tookMs = Date.now() - start;
  writeCache(cacheKey, result);
  return result;
}

export function createWebSearchToolDefinition() {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Brave Search API (or Perplexity if configured). Returns titles, URLs, and snippets for fast research. Supports region-specific results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string." },
        count: {
          type: "number",
          description: "Number of results (1-10). Default: 5.",
          minimum: 1,
          maximum: MAX_SEARCH_COUNT,
        },
        country: {
          type: "string",
          description: "2-letter country code for region-specific results (e.g., 'US', 'DE').",
        },
        freshness: {
          type: "string",
          description:
            "Filter by recency: 'pd' (past day), 'pw' (past week), 'pm' (past month), 'py' (past year), or 'YYYY-MM-DDtoYYYY-MM-DD'.",
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

      const count =
        typeof params.count === "number" && Number.isFinite(params.count)
          ? params.count
          : undefined;
      const country =
        typeof params.country === "string" ? params.country.trim() : undefined;
      const freshness =
        typeof params.freshness === "string" ? params.freshness.trim() : undefined;

      const result = await runWebSearch({ query, count, country, freshness });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { query, provider: result.provider },
      };
    },
  };
}
