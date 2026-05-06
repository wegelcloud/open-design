// Tavily Search provider.
//
// Tavily is purpose-built for AI agents: a single POST returns a curated
// answer plus the supporting sources, which is exactly what we need for
// shallow pre-generation research. We deliberately avoid the
// scraping-heavy `/extract` endpoint in Phase 1 — Tavily's `content`
// field on each result is already a clean snippet.
//
// Docs: https://docs.tavily.com/api-reference/endpoint/search

import type { ResearchSource } from '@open-design/contracts';

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TavilySearchInput {
  apiKey: string;
  baseUrl?: string;
  query: string;
  /** 'basic' returns ~5 sources fast; 'advanced' returns ~10 with deeper crawl. */
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  /** Include Tavily's pre-synthesised answer (recommended). */
  includeAnswer?: boolean;
  signal?: AbortSignal;
}

interface TavilyRawResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
}

interface TavilyRawResponse {
  answer?: unknown;
  results?: unknown;
}

export interface TavilySearchOutput {
  /** Tavily's pre-synthesised answer (or empty string if missing). */
  answer: string;
  sources: ResearchSource[];
}

export class TavilyError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TavilyError';
  }
}

export async function tavilySearch(
  input: TavilySearchInput,
): Promise<TavilySearchOutput> {
  if (!input.apiKey) {
    throw new TavilyError('Tavily API key is not configured');
  }
  const base = (input.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const body = {
    query: input.query,
    search_depth: input.searchDepth ?? 'basic',
    max_results: input.maxResults ?? 5,
    include_answer: input.includeAnswer ?? true,
    include_raw_content: false,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  if (input.signal) {
    input.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  let resp: Response;
  try {
    resp = await fetch(`${base}/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new TavilyError(
      `Tavily request failed: ${(err as Error).message || String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new TavilyError(
      `Tavily ${resp.status}: ${text.slice(0, 200) || 'no body'}`,
      resp.status,
    );
  }
  const json = (await resp.json()) as TavilyRawResponse;
  const answer = typeof json.answer === 'string' ? json.answer : '';
  const rawResults = Array.isArray(json.results) ? json.results : [];
  const sources: ResearchSource[] = [];
  for (const r of rawResults as TavilyRawResult[]) {
    const url = typeof r.url === 'string' ? r.url : '';
    if (!url) continue;
    const publishedAt =
      typeof r.published_date === 'string' && r.published_date.trim()
        ? r.published_date.trim()
        : null;
    sources.push({
      title:
        typeof r.title === 'string' && r.title.trim()
          ? r.title.trim()
          : url,
      url,
      snippet:
        typeof r.content === 'string'
          ? r.content.trim().slice(0, 800)
          : '',
      provider: 'tavily',
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return { answer, sources };
}
