// Audit log per project — research starter (not wired into server.ts).
//
// Source: docs/research/openwork-aionui-alaude-integration.md §5.2 (P1-1)
// Inspired by openwork apps/server/src/audit.ts: append-only JSONL,
// `OPENWORK_DATA_DIR` overridable, `GET /workspace/:id/audit?limit=25`.
//
// Open Design twist: per-project file under `.od/projects/<id>/audit.jsonl`
// (alongside the project's plain artifact files), so that an exported project
// folder carries its own audit history.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export type AuditAction =
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'conversation.create'
  | 'conversation.delete'
  | 'message.send'
  | 'message.delete'
  | 'skill.set'
  | 'design_system.set'
  | 'craft.toggle'
  | 'file.write'
  | 'file.delete'
  | 'memory.create'
  | 'memory.archive'
  | 'memory.update'
  | 'deploy.start'
  | 'deploy.complete'
  | 'export.bundle'
  | 'import.bundle'
  | 'agent.spawn'
  | 'agent.cancel';

export interface AuditEntry {
  timestamp: number;          // ms epoch
  projectId: string;
  conversationId?: string;
  action: AuditAction;
  actor: 'user' | 'agent' | 'system';
  agentId?: string;           // when actor === 'agent'
  detail?: Record<string, unknown>;
}

interface AuditOptions {
  projectRoot: string;        // open-design project root (where `.od/` lives)
  dataDir?: string;           // OD_DATA_DIR override
}

// Mirrors `isSafeId` in apps/daemon/src/projects.ts. Inlined to keep this
// research starter free of imports from server-internal modules; the planned
// `GET /api/projects/:id/audit` route will take `:id` from a URL parameter,
// so this guard must run before any path join / mkdirSync. The character
// allowlist matches `_` `-` `.` `0-9A-Za-z`, which on its own would still
// accept `"."` / `".."`; reject those explicitly so the resolver cannot land
// on the projects root or its parent (PR #617 review, P2).
function isSafeProjectId(id: string): boolean {
  if (typeof id !== 'string') return false;
  if (id === '.' || id === '..') return false;
  return /^[A-Za-z0-9._-]{1,128}$/.test(id);
}

/**
 * Pure resolver for the project's audit file path. Does NOT touch the
 * filesystem (no mkdir, no stat). Read paths must use this directly so
 * simply querying the audit log can never create directories outside the
 * project tree (PR #617 review, P1).
 */
function auditFilePath(projectId: string, opts: AuditOptions): string {
  if (!isSafeProjectId(projectId)) throw new Error('invalid project id');
  const root = opts.dataDir
    ? path.resolve(opts.dataDir)
    : path.join(opts.projectRoot, '.od');
  const projectsRoot = path.resolve(root, 'projects');
  const dir = path.resolve(projectsRoot, projectId);
  // Defense in depth: even if a future `isSafeProjectId` change loosens the
  // allowlist, refuse to operate at or outside `<root>/projects/`. The
  // strict-prefix check rejects `dir === projectsRoot` (would write
  // `audit.jsonl` directly into the projects root) as well as siblings.
  if (!dir.startsWith(projectsRoot + path.sep)) {
    throw new Error('project id escapes projects root');
  }
  return path.join(dir, 'audit.jsonl');
}

/**
 * Resolve + ensure the project's audit directory exists. Use this on the
 * write path only (`appendAuditEntry`), never on reads.
 */
function ensureAuditFile(projectId: string, opts: AuditOptions): string {
  const file = auditFilePath(projectId, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

// --- Redaction -------------------------------------------------------------

const REDACTED = '[redacted]';
// Token / api_key / authorization etc. — case-insensitive, with optional `_` /
// `-` separators on either side. The matcher first inserts a `_` at every
// camelCase boundary so common JS DTO names like `accessToken`,
// `refreshToken`, `clientSecret`, and `sessionId` redact through the same
// rules as their snake/kebab equivalents (PR #617 review, P2). Adding
// `access|refresh|client|session` × `key|token|secret|id` keeps the rule
// surface aligned with what hits mutation routes in practice.
const SENSITIVE_KEY_PATTERN =
  /^(?:.*[_-])?(?:token|secret|password|passwd|api[_-]?key|authorization|auth[_-]?header|access[_-]?(?:key|token|secret|id)|refresh[_-]?(?:key|token|secret|id)|client[_-]?(?:key|token|secret|id)|session[_-]?(?:key|token|secret|id)|private[_-]?key|cookie|credential|bearer|x[_-]?api[_-]?key)(?:[_-].*)?$/i;

function isSensitiveKey(key: string): boolean {
  // Insert a separator at every lower→Upper or digit→Upper boundary so the
  // existing snake/kebab rules cover camelCase names too. `accessToken`
  // becomes `access_Token`; `xApiKey` becomes `x_Api_Key`.
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

const MAX_REDACTION_DEPTH = 6;
// Truncate excessively long string values defensively so a stray paste of a
// large blob (e.g. a base64-encoded screenshot) cannot bloat the audit file.
const MAX_STRING_LEN = 4 * 1024;
// Per-container caps so a mutation route that passes a large array or object
// in `detail` cannot generate a multi-MB JSONL line and block the daemon on
// synchronous `JSON.stringify()` / `appendFileSync()`. Items past the cap are
// dropped and replaced with a single truncation marker (PR #617 review, P2).
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
// Hard upper bound on the serialized JSONL line. Even with per-string,
// per-array, and per-object caps, a deeply branched object can still exceed
// what is reasonable to store and to read back. After serialization we check
// the byte length and, if over, replace `detail` with a `__truncated` marker
// recording the original size before re-serializing (PR #617 review, P2).
const MAX_AUDIT_LINE_BYTES = 64 * 1024;
const TRUNCATION_MARKER = '__truncated';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + '…' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  // `JSON.stringify` throws on BigInt, so coerce to a decimal string before
  // the entry hits `appendAuditEntry`'s serializer. A stray BigInt buried in
  // `detail` would otherwise fail the audit write — and, once this starter
  // is wired into mutation routes, take down the surrounding mutation with
  // it (PR #617 review, P1).
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    if (value.length <= MAX_ARRAY_ITEMS) {
      return value.map((v) => redactValue(v, depth + 1));
    }
    const head = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactValue(v, depth + 1));
    head.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} more item(s)]`);
    return head;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value);
    const limit = Math.min(entries.length, MAX_OBJECT_KEYS);
    for (let i = 0; i < limit; i++) {
      const pair = entries[i];
      if (!pair) continue;
      const [k, v] = pair;
      out[k] = isSensitiveKey(k) ? REDACTED : redactValue(v, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out[TRUNCATION_MARKER] = `dropped ${entries.length - MAX_OBJECT_KEYS} more key(s)`;
    }
    return out;
  }
  // Drop class instances, functions, symbols — JSON.stringify wouldn't
  // round-trip them anyway.
  return undefined;
}

function redactDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) return detail;
  const result = redactValue(detail, 0);
  return isPlainObject(result) ? result : undefined;
}

function redactEntry(entry: AuditEntry): AuditEntry {
  const out: AuditEntry = {
    timestamp: entry.timestamp,
    projectId: entry.projectId,
    action: entry.action,
    actor: entry.actor,
  };
  if (entry.conversationId !== undefined) out.conversationId = entry.conversationId;
  if (entry.agentId !== undefined) out.agentId = entry.agentId;
  const redactedDetail = redactDetail(entry.detail);
  if (redactedDetail !== undefined) out.detail = redactedDetail;
  return out;
}

/**
 * Bounded JSONL serializer for an `AuditEntry`. Per-string/per-array/
 * per-object caps in `redactValue` already keep individual containers
 * small, but a deeply branched object can still produce a multi-MB line.
 * After the first stringify we check the byte length and, if over the
 * cap, replace `detail` with a single `__truncated` marker recording the
 * original size before re-serializing (PR #617 review, P2). The marker
 * shape lets log readers distinguish a deliberate truncation from a
 * malformed entry.
 */
function serializeAuditLine(safe: AuditEntry): string {
  const first = JSON.stringify(safe);
  if (Buffer.byteLength(first, 'utf8') <= MAX_AUDIT_LINE_BYTES) {
    return first + '\n';
  }
  const detail = safe.detail;
  const detailBytes = detail ? Buffer.byteLength(JSON.stringify(detail), 'utf8') : 0;
  const truncated: AuditEntry = {
    timestamp: safe.timestamp,
    projectId: safe.projectId,
    action: safe.action,
    actor: safe.actor,
    detail: {
      [TRUNCATION_MARKER]: true,
      reason: 'audit-line-too-large',
      originalDetailBytes: detailBytes,
      maxLineBytes: MAX_AUDIT_LINE_BYTES,
    },
  };
  if (safe.conversationId !== undefined) truncated.conversationId = safe.conversationId;
  if (safe.agentId !== undefined) truncated.agentId = safe.agentId;
  return JSON.stringify(truncated) + '\n';
}

/**
 * Append a single audit entry. Atomic at the line level on POSIX (write(2)
 * is atomic for buffers smaller than PIPE_BUF, and JSONL stays well below).
 *
 * Sensitive fields in `entry.detail` (token / api_key / authorization etc.)
 * are recursively redacted before serialization, since `detail` is typed as
 * `Record<string, unknown>` and per-action shape is not enforced yet.
 *
 * Bounded by per-string, per-array, per-object, and per-line caps so that a
 * mutation route passing a pathological `detail` cannot block the daemon on
 * synchronous `JSON.stringify` / `appendFileSync` (PR #617 review, P2).
 */
export function appendAuditEntry(entry: AuditEntry, opts: AuditOptions): void {
  const file = ensureAuditFile(entry.projectId, opts);
  const safe = redactEntry(entry);
  const line = serializeAuditLine(safe);
  fs.appendFileSync(file, line, { encoding: 'utf8' });
}

interface ReadOptions extends AuditOptions {
  limit?: number;             // default 50, max 1000
  since?: number;             // ms epoch, only entries with ts >= since
  actions?: AuditAction[];    // filter by action types
}

const DEFAULT_READ_LIMIT = 50;
const MAX_READ_LIMIT = 1000;

// Mirrors `clampListLimit` in memory-schema.ts. `?limit=0`, negative numbers,
// `NaN`, and `Infinity` would otherwise reach `buffer.slice(-limit)`; in
// particular `slice(-0)` is `slice(0)`, which returns the entire file —
// inverting the documented bound. Floor fractional values, then cap (PR
// #617 review, P1).
function clampReadLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_READ_LIMIT;
  if (!Number.isFinite(raw)) return DEFAULT_READ_LIMIT;
  const n = Math.floor(raw);
  if (n <= 0) return DEFAULT_READ_LIMIT;
  return Math.min(n, MAX_READ_LIMIT);
}

/**
 * Read the most recent N audit entries. Reads from the end of the file
 * line-by-line and stops once `limit` matching entries are accumulated.
 *
 * For the v0 implementation we read the whole file. For projects with
 * very large audit logs (>1MB) a backwards-streaming reader should be
 * used instead — track this in the integration PR.
 */
export async function readAuditEntries(
  projectId: string,
  opts: ReadOptions,
): Promise<AuditEntry[]> {
  // Reads must not create directories — use the side-effect-free resolver.
  const file = auditFilePath(projectId, opts);
  if (!fs.existsSync(file)) return [];
  const limit = clampReadLimit(opts.limit);
  const since = opts.since ?? 0;
  const filterActions = opts.actions ? new Set(opts.actions) : null;

  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const buffer: AuditEntry[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as AuditEntry;
      if (entry.timestamp < since) continue;
      if (filterActions && !filterActions.has(entry.action)) continue;
      buffer.push(entry);
    } catch {
      // skip malformed lines — JSONL append-only loses single rows at most
    }
  }
  return buffer.slice(-limit).reverse();
}

/**
 * Sensitive-data stripper for export.
 * Source: openwork apps/server/src/workspace-export-safety.ts
 *
 * Recursively strips fields whose key looks token-like (token / api_key /
 * authorization / cookie / password / private_key / session_id / bearer /
 * x-api-key — case-insensitive, with optional `_` / `-` separators on
 * either side, and the camelCase equivalents `accessToken` / `refreshToken`
 * / `clientSecret` / `sessionId`). Truncates over-long string values
 * defensively. Defense in depth on top of `appendAuditEntry()` redaction,
 * in case an upstream caller appends raw lines or a future field gets added
 * without going through the append helper.
 */
export function redactForExport(entry: AuditEntry): AuditEntry {
  return redactEntry(entry);
}
