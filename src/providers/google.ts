/**
 * Google Generative Language API streaming client (Gemini direct). The
 * REST surface is at generativelanguage.googleapis.com and the key is
 * sent via the `x-goog-api-key` header — putting it in the URL query
 * string would leak it into DevTools Network, browser history on
 * redirect, the HTTP referer chain, and any logging proxy in between.
 * We hit `:streamGenerateContent` with `alt=sse` so the response arrives
 * as a server-sent event stream we can pump like the OpenAI one.
 *
 * Today this client is text-only: `parts[*].text` is bridged through and
 * `parts[*].functionCall` (Gemini tool use) plus `parts[*].inlineData`
 * (vision/audio) are dropped on the floor. The same limitation applies
 * to the OpenAI client. Surfaced in Settings (`settings.providerHint`)
 * and the README provider table.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';
import { classifyHttpError, collectFrameData, extractStreamError } from './openai';

export async function streamGoogle(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  if (!cfg.apiKey) {
    handlers.onError(new Error('Missing API key — open Settings and paste one in.'));
    return;
  }
  if (!cfg.model) {
    handlers.onError(new Error('Missing model — set one in Settings.'));
    return;
  }

  const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;

  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // `systemInstruction` on Gemini's REST surface takes `{ parts: [...] }`
  // — `role` is generally ignored at this position and some endpoints
  // reject it outright, so we leave it off.
  const body: Record<string, unknown> = { contents };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  let acc = '';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      handlers.onError(new Error(classifyHttpError(resp.status, text)));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE permits CRLF between frames — split on /\r?\n\r?\n/ so
      // CRLF-emitting upstreams (Cloudflare-fronted proxies, certain
      // LiteLLM configs) are handled the same as bare-LF ones.
      while (true) {
        const m = buf.match(/\r?\n\r?\n/);
        if (!m || m.index === undefined) break;
        const idx = m.index;
        const frame = buf.slice(0, idx).replace(/\r/g, '').trim();
        buf = buf.slice(idx + m[0].length);
        if (!frame) continue;
        // SSE allows one event payload to span multiple `data:` lines —
        // join them per spec before parsing JSON, matching openai.ts.
        const payload = collectFrameData(frame);
        if (!payload) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        // Gemini can return HTTP 200 with an in-stream error envelope —
        // surface it before doing anything else.
        const apiErr = extractStreamError(parsed);
        if (apiErr) {
          handlers.onError(new Error(`Gemini error — ${apiErr}`));
          return;
        }
        // Stream any text first so a chunk that carries both partial text
        // and a terminal non-text `finishReason` doesn't lose its prefix.
        const delta = extractGeminiText(parsed);
        if (delta) {
          acc += delta;
          handlers.onDelta(delta);
        }
        // `promptFeedback.blockReason` and a non-benign terminal
        // `finishReason` (SAFETY, RECITATION, …) are how Gemini reports
        // a refusal on a 200 response. Without surfacing them, the loop
        // resolves onDone with whatever (possibly empty) text we got and
        // the UI shows a blank "successful" answer.
        const blockMsg = extractGeminiBlock(parsed);
        if (blockMsg) {
          handlers.onError(new Error(blockMsg));
          return;
        }
      }
    }
    handlers.onDone(acc);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// Gemini terminal `finishReason`s that indicate the response was cut
// short for a non-text reason. STOP / MAX_TOKENS are normal completions
// and not surfaced as errors; everything else (safety filter, recitation
// guard, prohibited-content trip, malformed function call, …) is.
const GEMINI_BENIGN_FINISH = new Set(['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED', '']);

// Returns an actionable error string when the parsed Gemini SSE chunk
// represents a blocked / filtered response, or null when it's a normal
// streaming chunk that should flow through extractGeminiText.
function extractGeminiBlock(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as {
    promptFeedback?: { blockReason?: unknown; blockReasonMessage?: unknown };
    candidates?: Array<{ finishReason?: unknown; finishMessage?: unknown }>;
  };

  const pf = obj.promptFeedback;
  if (pf && typeof pf.blockReason === 'string' && pf.blockReason) {
    const tail = typeof pf.blockReasonMessage === 'string' && pf.blockReasonMessage
      ? ` — ${pf.blockReasonMessage}`
      : '';
    return `Gemini blocked the prompt (${pf.blockReason})${tail}.`;
  }

  const candidates = obj.candidates;
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      const fr = c?.finishReason;
      if (typeof fr !== 'string') continue;
      if (GEMINI_BENIGN_FINISH.has(fr)) continue;
      const tail = typeof c?.finishMessage === 'string' && c.finishMessage
        ? ` — ${c.finishMessage}`
        : '';
      return `Gemini stopped the response (${fr})${tail}.`;
    }
  }

  return null;
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const p of parts) {
    if (typeof p?.text === 'string') out += p.text;
  }
  return out;
}
