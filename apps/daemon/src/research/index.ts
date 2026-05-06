// Pre-generation research orchestrator.
//
// Phase 1 supports a single provider (Tavily) and shallow depth only.
// The orchestrator owns: provider key resolution, timeouts, status
// streaming, and rendering the findings as a `<research_context>` block
// the daemon prepends to the system prompt.
//
// Phase 2+ will add: Exa/SerpAPI fallback, recursive deep-research with
// gap detection, optional LLM synthesis pass.

import type {
  ResearchDepth,
  ResearchFindings,
  ResearchOptions,
  ResearchSource,
} from '@open-design/contracts';
import { RESEARCH_DEFAULT_MAX_SOURCES } from '@open-design/contracts';
import { resolveProviderConfig } from '../media-config.js';
import { tavilySearch, TavilyError } from './tavily.js';

export type ResearchStatus =
  | { phase: 'start'; provider: string; query: string; depth: ResearchDepth }
  | { phase: 'searching'; provider: string }
  | { phase: 'done'; provider: string; sourceCount: number }
  | { phase: 'skipped'; reason: string }
  | { phase: 'error'; provider: string; message: string };

export interface RunResearchInput {
  /** The user's chat message (used as the search query when no override). */
  message: string;
  options: ResearchOptions;
  projectRoot: string;
  /** Streamed back to the SSE channel as status events. */
  emit: (status: ResearchStatus) => void;
  signal?: AbortSignal;
}

export interface RunResearchResult {
  findings: ResearchFindings | null;
  /** When non-null, prepend this to the daemon system prompt. */
  promptBlock: string | null;
  /** Human-readable reason when findings is null. */
  skippedReason?: string;
}

export async function runResearch(
  input: RunResearchInput,
): Promise<RunResearchResult> {
  const opts = input.options;
  if (!opts || !opts.enabled) {
    return { findings: null, promptBlock: null };
  }
  const query = (opts.query?.trim() || input.message?.trim() || '').slice(
    0,
    1000,
  );
  if (!query) {
    const reason = 'no query';
    input.emit({ phase: 'skipped', reason });
    return { findings: null, promptBlock: null, skippedReason: reason };
  }
  const depth: ResearchDepth = opts.depth ?? 'shallow';
  const requested: string[] = Array.isArray(opts.providers) ? opts.providers : [];
  const providers = requested.filter(
    (p: unknown): p is string => typeof p === 'string' && p.length > 0,
  );
  const provider = providers[0] ?? 'tavily';
  const maxSources =
    typeof opts.maxSources === 'number' && opts.maxSources > 0
      ? Math.min(opts.maxSources, 30)
      : RESEARCH_DEFAULT_MAX_SOURCES[depth];

  if (provider !== 'tavily') {
    const reason = `provider "${provider}" not supported in Phase 1`;
    input.emit({ phase: 'skipped', reason });
    return { findings: null, promptBlock: null, skippedReason: reason };
  }

  const cfg = await resolveProviderConfig(input.projectRoot, 'tavily');
  if (!cfg.apiKey) {
    const reason = 'Tavily API key not configured (Settings → Tavily Search)';
    input.emit({ phase: 'skipped', reason });
    return { findings: null, promptBlock: null, skippedReason: reason };
  }

  input.emit({ phase: 'start', provider, query, depth });
  input.emit({ phase: 'searching', provider });

  let answer = '';
  let sources: ResearchSource[] = [];
  try {
    const out = await tavilySearch({
      apiKey: cfg.apiKey,
      query,
      // Phase 1: depth → search_depth mapping. 'medium'/'deep' will diverge later.
      searchDepth: depth === 'shallow' ? 'basic' : 'advanced',
      maxResults: maxSources,
      includeAnswer: true,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    answer = out.answer;
    sources = out.sources;
  } catch (err) {
    const message =
      err instanceof TavilyError
        ? err.message
        : `research failed: ${(err as Error).message || String(err)}`;
    input.emit({ phase: 'error', provider, message });
    return { findings: null, promptBlock: null, skippedReason: message };
  }

  if (sources.length === 0) {
    const reason = 'no sources found';
    input.emit({ phase: 'skipped', reason });
    return { findings: null, promptBlock: null, skippedReason: reason };
  }

  input.emit({ phase: 'done', provider, sourceCount: sources.length });

  const findings: ResearchFindings = {
    query,
    summary: answer || synthesizeFallbackSummary(sources),
    sources,
    provider,
    depth,
    fetchedAt: Date.now(),
  };
  return {
    findings,
    promptBlock: renderResearchBlock(findings),
  };
}

function synthesizeFallbackSummary(sources: ResearchSource[]): string {
  // Tavily nearly always returns an `answer`; this only fires when the
  // provider returns sources without one. Stitch the top snippets into a
  // bullet list so the agent still has something coherent to cite.
  const lead = sources
    .slice(0, 5)
    .map((s, i) => `- [${i + 1}] ${s.title}: ${s.snippet.slice(0, 200)}`)
    .join('\n');
  return `(No provider summary; top snippets follow.)\n${lead}`;
}

export function renderResearchBlock(findings: ResearchFindings): string {
  const sourceLines = findings.sources
    .map((s, i) => {
      const dateBit = s.publishedAt ? ` (${s.publishedAt})` : '';
      return `[${i + 1}] ${s.title}${dateBit}\n    ${s.url}\n    ${truncate(s.snippet, 320)}`;
    })
    .join('\n');
  return [
    '<research_context>',
    'The following research was performed for this request.',
    'Treat it as authoritative source material. When you reference a fact',
    'from it, cite it inline with [n] where n matches the source index below.',
    '',
    `Query: ${findings.query}`,
    `Provider: ${findings.provider} · depth: ${findings.depth} · ${findings.sources.length} sources`,
    '',
    '## Summary',
    findings.summary.trim(),
    '',
    '## Sources',
    sourceLines,
    '</research_context>',
  ].join('\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}
