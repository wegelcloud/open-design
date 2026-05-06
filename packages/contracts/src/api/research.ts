/**
 * Pre-generation research DTOs. The web/composer toggles `enabled`, the
 * daemon performs the search, and the findings are folded into the
 * agent's system prompt as a `<research_context>` block.
 *
 * Phase 1 only honours `depth: 'shallow'`. The other depths are part of
 * the contract now so callers don't have to re-version when later
 * phases turn them on.
 */

export type ResearchDepth = 'shallow' | 'medium' | 'deep';

export interface ResearchOptions {
  enabled: boolean;
  /** Optional override; defaults to the user's chat message. */
  query?: string;
  /** Phase 1 only honours 'shallow'. */
  depth?: ResearchDepth;
  /** Cap on returned sources. Defaults follow the depth. */
  maxSources?: number;
  /** Provider preference order. Phase 1 supports ['tavily']. */
  providers?: string[];
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  provider: string;
}

export interface ResearchFindings {
  query: string;
  summary: string;
  sources: ResearchSource[];
  provider: string;
  depth: ResearchDepth;
  /** Unix ms when the search returned. */
  fetchedAt: number;
}

/** Default source caps per depth tier. */
export const RESEARCH_DEFAULT_MAX_SOURCES: Record<ResearchDepth, number> = {
  shallow: 5,
  medium: 12,
  deep: 30,
};
