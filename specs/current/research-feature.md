# Pre-generation research

## What this is

An optional pre-generation research step that runs *before* the agent
spawns. The user types a prompt, toggles "Research", and the daemon does
a web search round (and, in later phases, recursive deep research),
synthesises the findings, and injects them into the agent's system
prompt as a `<research_context>...</research_context>` block. The agent
then generates slides / prototypes / decks grounded in real data and
real sources, instead of guessing.

Inspiration: `mvanhorn/last30days-skill`, `dzhng/deep-research`,
`Alibaba-NLP/DeepResearch`. Open Design's version is a *backend
capability* layered into the existing chat run path, not a separate
agent.

## Why it lives here, not as a skill

A skill is the artifact shape (deck, prototype, design-system). Research
is orthogonal — *any* skill can benefit. Modelling research as a flag on
the chat request keeps it composable: pick any skill, optionally enable
research, get grounded output. Skills can opt in to *recommend* research
via an `od.research.recommends` manifest hint, but the feature itself is
not gated by skill choice.

## Architecture

```
ChatRequest { ..., research?: { enabled, query?, depth?, maxSources? } }
        │
        ▼
[startChatRun]  apps/daemon/src/server.ts
        │
        │ if research.enabled:
        ▼
[research orchestrator]  apps/daemon/src/research/index.ts
        │
        ├── tavily provider                    apps/daemon/src/research/tavily.ts
        ├── exa provider          (Phase 3)
        ├── serpapi provider      (Phase 3)
        └── synthesis (LLM cluster + summary)  (Phase 3 — Tavily already returns answer)
        │
        ▼
ResearchFindings { query, summary, sources: [{title,url,snippet,publishedAt?}] }
        │
        ▼  rendered as <research_context>…</research_context>
[composeDaemonSystemPrompt] prepends findings
        │
        ▼
[agent spawn]  unchanged downstream
```

Progress is streamed as existing `status` agent SSE events
(`label: "researching"`, `detail: "5 sources from tavily"`). No new
event union variant in Phase 1 — the existing status renderer handles it.

## File map

| Layer | File | Change |
| --- | --- | --- |
| Contracts | `packages/contracts/src/api/research.ts` *(new)* | `ResearchOptions`, `ResearchSource`, `ResearchFindings` |
| | `packages/contracts/src/api/chat.ts` | `ChatRequest.research?: ResearchOptions` |
| | `packages/contracts/src/index.ts` | re-export the new module |
| Daemon registry | `apps/daemon/src/media-models.ts` | add `tavily` provider entry |
| | `apps/daemon/src/media-config.ts` | add `tavily` to `ENV_KEYS` |
| Daemon research | `apps/daemon/src/research/index.ts` *(new)* | orchestrator (`runResearch`) |
| | `apps/daemon/src/research/tavily.ts` *(new)* | Tavily search provider |
| Daemon hook | `apps/daemon/src/server.ts` (~2437) | call `runResearch` before prompt assembly when enabled |
| Web registry | `apps/web/src/media/models.ts` | add `tavily` to `MediaProviderId` + `MEDIA_PROVIDERS` |
| Web composer | `apps/web/src/components/ChatComposer.tsx` | add 🔍 Research toggle button + state |
| | `apps/web/src/components/ChatPane.tsx` | pass `research` through `onSend` |
| | `apps/web/src/components/ProjectView.tsx` | thread `research` into `streamViaDaemon` |
| | `apps/web/src/providers/daemon.ts` | serialise `research` into `ChatRequest` body |
| i18n | `apps/web/src/i18n/{en,zh-CN}.json` | strings: `chat.researchLabel`, `chat.researchOnTitle`, `chat.researchOffTitle` |

## DTOs

```ts
// packages/contracts/src/api/research.ts
export type ResearchDepth = 'shallow' | 'medium' | 'deep';

export interface ResearchOptions {
  enabled: boolean;
  /** Optional override; defaults to the user's chat message. */
  query?: string;
  /** Phase 1 only honours 'shallow'. */
  depth?: ResearchDepth;
  /** Cap on returned sources. Defaults to 5 (shallow) / 12 (medium) / 30 (deep). */
  maxSources?: number;
  /** Provider preference order. Defaults to ['tavily']. */
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
  fetchedAt: number;
}
```

## Injected prompt block

The daemon prepends the following to `daemonSystemPrompt` when
`research.enabled === true` and findings are non-empty. The agent is
asked to cite by `[1]`/`[2]` indices that match the sources list.

```
<research_context>
The following research was performed for this request.
Treat it as authoritative source material. When you reference a fact
from it, cite it inline with [n] where n matches the source index below.

## Summary
{findings.summary}

## Sources
[1] {sources[0].title} — {sources[0].url}
    {sources[0].snippet}
[2] ...
</research_context>
```

## Phases

- **Phase 1 (this MVP)**: Tavily only, shallow only (single-shot search,
  ≤5 sources). No LLM synthesis — Tavily's `answer` field *is* the
  summary. Toggle button (no popover). Progress via `status` SSE events.
- **Phase 2**: Composer popover with depth selector + custom query field.
  Per-event SSE (`research_source` agent payload variant) so the UI can
  render a sources card live as they arrive.
- **Phase 3**: Multi-provider (Exa, SerpAPI, Brave) with fallback. LLM
  synthesis pass for cross-provider dedup. Medium + deep recursion (gap
  identification → re-query). Firecrawl full-page scrape for top-N.
- **Phase 4**: Skills opt-in via `od.research.recommends: true`; skill
  picker surfaces a "research recommended" badge. Two example skills:
  `research-deck`, `market-analysis-prototype`. Examples on the empty
  chat page that demonstrate the feature.

## Settings flow

The `tavily` provider follows the existing media-provider pattern:
- Settings dialog auto-renders an API-key field (no SettingsDialog code
  change — `MediaProvidersSection` iterates `MEDIA_PROVIDERS`).
- ENV fallback: `OD_TAVILY_API_KEY`, `TAVILY_API_KEY`.
- Stored in `<projectRoot>/.od/media-config.json` under
  `providers.tavily.apiKey`.
- The daemon resolves the key via `resolveProviderConfig(projectRoot, 'tavily')`.
- `settingsVisible: true`, `credentialsRequired: true`, `integrated: true`.

We deliberately reuse `MEDIA_PROVIDERS` rather than introducing a parallel
`RESEARCH_PROVIDERS` registry: settings UI, env-var handling, masked
config endpoint, and credential resolution are all already correct.
Naming-wise the registry is becoming "external API providers" rather
than strictly "media", but that's a minor doc nit, not a refactor.

## Testing strategy

- Unit: `research/tavily.test.ts` mocks `fetch`, asserts request shape +
  parsed sources. `research/index.test.ts` asserts orchestrator emits
  the expected status events and returns sane findings.
- Integration: skip live Tavily calls in CI; gate live tests behind
  `TAVILY_API_KEY` presence.
- Manual smoke: `pnpm tools-dev`, set Tavily key in Settings, toggle
  Research in composer, send "EV market 2025 trends", confirm the
  status events appear and the agent's output cites `[1]/[2]/...`.

## Out of scope for Phase 1

- Custom research-only LLM model selection (synthesis reuses chat agent
  in later phases; v1 needs no LLM call).
- Persisting research findings to the message record (v1 lives only in
  the system prompt and SSE log).
- Caching by query hash.
- Streaming individual sources to the UI as they're discovered.
- Research-grounded example prompts on the landing page.
