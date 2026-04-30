import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { listFiles, projectDir, readProjectFile, validateProjectPath } from '../projects.js';
import type { BoundedJsonObject, BoundedJsonValue, LiveArtifactRefreshSourceMetadata, LiveArtifactTileSource } from './schema.js';
import { validateBoundedJsonObject } from './schema.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_LIVE_ARTIFACT_SOURCE_TIMEOUT_MS = 30_000;
export const DEFAULT_LIVE_ARTIFACT_TOTAL_TIMEOUT_MS = 120_000;

export type LiveArtifactRefreshAbortKind = 'cancelled' | 'source_timeout' | 'total_timeout';

export interface LiveArtifactRefreshTimeouts {
  sourceTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface LiveArtifactRefreshRunScope {
  projectId: string;
  artifactId: string;
  refreshId: string;
}

export interface LiveArtifactRefreshRun extends LiveArtifactRefreshRunScope {
  readonly signal: AbortSignal;
  readonly startedAt: Date;
}

export interface LiveArtifactRefreshRunOptions extends LiveArtifactRefreshRunScope {
  totalTimeoutMs?: number;
  now?: Date;
}

export interface LiveArtifactRefreshSourceExecutionOptions {
  step: string;
  source?: LiveArtifactRefreshSourceMetadata;
  sourceTimeoutMs?: number;
}

export type LocalDaemonRefreshToolName = 'project_files.search' | 'project_files.read_json' | 'git.summary';

export interface ExecuteLocalDaemonRefreshSourceOptions {
  projectsRoot: string;
  projectId: string;
  source: LiveArtifactTileSource;
  signal?: AbortSignal;
}

export interface ProjectFilesSearchInput extends BoundedJsonObject {
  query?: string;
  maxResults?: number;
}

export interface ProjectFilesReadJsonInput extends BoundedJsonObject {
  path?: string;
  file?: string;
  name?: string;
}

export interface GitSummaryInput extends BoundedJsonObject {
  maxCommits?: number;
}

export class LiveArtifactRefreshAbortError extends Error {
  readonly kind: LiveArtifactRefreshAbortKind;
  readonly projectId: string;
  readonly artifactId: string;
  readonly refreshId: string;
  readonly timeoutMs?: number;
  readonly step?: string;

  constructor(message: string, options: LiveArtifactRefreshRunScope & { kind: LiveArtifactRefreshAbortKind; timeoutMs?: number; step?: string }) {
    super(message);
    this.name = 'LiveArtifactRefreshAbortError';
    this.kind = options.kind;
    this.projectId = options.projectId;
    this.artifactId = options.artifactId;
    this.refreshId = options.refreshId;
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
    if (options.step !== undefined) this.step = options.step;
  }
}

interface ActiveRefreshRun extends LiveArtifactRefreshRun {
  readonly controller: AbortController;
  readonly totalTimeout: ReturnType<typeof setTimeout>;
}

function validateTimeoutMs(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${path} must be a positive safe integer`);
  }
  return value;
}

export function normalizeLiveArtifactRefreshTimeouts(options?: Partial<LiveArtifactRefreshTimeouts>): LiveArtifactRefreshTimeouts {
  return {
    sourceTimeoutMs: validateTimeoutMs(options?.sourceTimeoutMs ?? DEFAULT_LIVE_ARTIFACT_SOURCE_TIMEOUT_MS, 'sourceTimeoutMs'),
    totalTimeoutMs: validateTimeoutMs(options?.totalTimeoutMs ?? DEFAULT_LIVE_ARTIFACT_TOTAL_TIMEOUT_MS, 'totalTimeoutMs'),
  };
}

function refreshRunKey(scope: LiveArtifactRefreshRunScope): string {
  return `${scope.projectId}\0${scope.artifactId}\0${scope.refreshId}`;
}

function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function toRefreshAbortError(reason: unknown, fallback: LiveArtifactRefreshRunScope): LiveArtifactRefreshAbortError {
  if (reason instanceof LiveArtifactRefreshAbortError) return reason;
  if (reason instanceof Error) {
    return new LiveArtifactRefreshAbortError(reason.message, { ...fallback, kind: 'cancelled' });
  }
  return new LiveArtifactRefreshAbortError(String(reason || 'live artifact refresh cancelled'), { ...fallback, kind: 'cancelled' });
}

export class LiveArtifactRefreshRunRegistry {
  private readonly runs = new Map<string, ActiveRefreshRun>();

  startRun(options: LiveArtifactRefreshRunOptions): LiveArtifactRefreshRun {
    const totalTimeoutMs = validateTimeoutMs(options.totalTimeoutMs ?? DEFAULT_LIVE_ARTIFACT_TOTAL_TIMEOUT_MS, 'totalTimeoutMs');
    const key = refreshRunKey(options);
    if (this.runs.has(key)) {
      throw new Error('live artifact refresh run already registered');
    }

    const controller = new AbortController();
    const totalTimeout = setTimeout(() => {
      controller.abort(new LiveArtifactRefreshAbortError('live artifact refresh timed out', {
        ...options,
        kind: 'total_timeout',
        timeoutMs: totalTimeoutMs,
      }));
    }, totalTimeoutMs);
    totalTimeout.unref?.();

    const run: ActiveRefreshRun = {
      projectId: options.projectId,
      artifactId: options.artifactId,
      refreshId: options.refreshId,
      startedAt: options.now ?? new Date(),
      signal: controller.signal,
      controller,
      totalTimeout,
    };
    this.runs.set(key, run);
    return run;
  }

  finishRun(run: LiveArtifactRefreshRunScope): void {
    const active = this.runs.get(refreshRunKey(run));
    if (active === undefined) return;
    clearTimeout(active.totalTimeout);
    this.runs.delete(refreshRunKey(run));
  }

  cancelRun(scope: LiveArtifactRefreshRunScope, reason = 'live artifact refresh cancelled by user'): boolean {
    const active = this.runs.get(refreshRunKey(scope));
    if (active === undefined) return false;
    active.controller.abort(new LiveArtifactRefreshAbortError(reason, { ...scope, kind: 'cancelled' }));
    return true;
  }

  hasRun(scope: LiveArtifactRefreshRunScope): boolean {
    return this.runs.has(refreshRunKey(scope));
  }
}

export const liveArtifactRefreshRunRegistry = new LiveArtifactRefreshRunRegistry();

export async function withLiveArtifactRefreshRun<T>(
  registry: LiveArtifactRefreshRunRegistry,
  options: LiveArtifactRefreshRunOptions,
  callback: (run: LiveArtifactRefreshRun) => Promise<T>,
): Promise<T> {
  const run = registry.startRun(options);
  try {
    return await Promise.race([callback(run), abortPromise(run.signal)]);
  } catch (error) {
    throw toRefreshAbortError(error, run);
  } finally {
    registry.finishRun(run);
  }
}

export async function withLiveArtifactRefreshSourceTimeout<T>(
  run: LiveArtifactRefreshRun,
  options: LiveArtifactRefreshSourceExecutionOptions,
  callback: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const sourceTimeoutMs = validateTimeoutMs(options.sourceTimeoutMs ?? DEFAULT_LIVE_ARTIFACT_SOURCE_TIMEOUT_MS, 'sourceTimeoutMs');
  const sourceController = new AbortController();
  const onRunAbort = (): void => sourceController.abort(run.signal.reason);
  if (run.signal.aborted) onRunAbort();
  else run.signal.addEventListener('abort', onRunAbort, { once: true });

  const sourceTimeout = setTimeout(() => {
    sourceController.abort(new LiveArtifactRefreshAbortError('live artifact refresh source timed out', {
      projectId: run.projectId,
      artifactId: run.artifactId,
      refreshId: run.refreshId,
      kind: 'source_timeout',
      timeoutMs: sourceTimeoutMs,
      step: options.step,
    }));
  }, sourceTimeoutMs);
  sourceTimeout.unref?.();

  try {
    return await Promise.race([callback(sourceController.signal), abortPromise(sourceController.signal)]);
  } catch (error) {
    throw toRefreshAbortError(error, run);
  } finally {
    clearTimeout(sourceTimeout);
    run.signal.removeEventListener('abort', onRunAbort);
  }
}

function isLocalDaemonRefreshToolName(value: string | undefined): value is LocalDaemonRefreshToolName {
  return value === 'project_files.search' || value === 'project_files.read_json' || value === 'git.summary';
}

function asBoundedRefreshOutput(value: BoundedJsonObject): BoundedJsonObject {
  const result = validateBoundedJsonObject(value, 'localRefreshOutput');
  if (!result.ok) {
    const firstIssue = result.issues[0];
    throw new Error(firstIssue === undefined ? result.error : `${firstIssue.path}: ${firstIssue.message}`);
  }
  return result.value;
}

function optionalString(value: BoundedJsonValue | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function optionalPositiveInteger(value: BoundedJsonValue | undefined, field: string, defaultValue: number, maxValue: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) throw new Error(`${field} must be a positive integer`);
  return Math.min(value, maxValue);
}

function selectJsonPath(input: ProjectFilesReadJsonInput): string {
  const rawPath = optionalString(input.path, 'input.path') ?? optionalString(input.file, 'input.file') ?? optionalString(input.name, 'input.name');
  if (rawPath === undefined) throw new Error('project_files.read_json requires input.path');
  return validateProjectPath(rawPath);
}

function compactTextPreview(text: string, query: string | undefined): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 240) return normalized;
  if (query === undefined || query.trim().length === 0) return `${normalized.slice(0, 240)}…`;
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return `${normalized.slice(0, 240)}…`;
  const start = Math.max(0, index - 80);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, start + 240)}…`;
}

function isTextLikeFile(file: { kind?: string; mime?: string; name: string }): boolean {
  return file.kind === 'code' || file.kind === 'text' || file.kind === 'html' || file.mime?.startsWith('text/') === true || file.name.endsWith('.json');
}

async function executeProjectFilesSearch(options: ExecuteLocalDaemonRefreshSourceOptions): Promise<BoundedJsonObject> {
  const input = options.source.input as ProjectFilesSearchInput;
  const query = optionalString(input.query, 'input.query')?.trim();
  const maxResults = optionalPositiveInteger(input.maxResults, 'input.maxResults', 25, 100);
  const allFiles = await listFiles(options.projectsRoot, options.projectId) as Array<{ name: string; path: string; type: string; size: number; mtime: number; kind?: string; mime?: string }>;
  const matches: BoundedJsonObject[] = [];
  const normalizedQuery = query?.toLowerCase();

  for (const file of allFiles) {
    if (options.signal?.aborted === true) throw options.signal.reason;
    if (matches.length >= maxResults) break;
    const pathMatches = normalizedQuery === undefined || file.path.toLowerCase().includes(normalizedQuery) || file.name.toLowerCase().includes(normalizedQuery);
    let preview: string | undefined;
    let matched = pathMatches;

    if (!matched && normalizedQuery !== undefined && isTextLikeFile(file) && file.size <= 128 * 1024) {
      try {
        const entry = await readProjectFile(options.projectsRoot, options.projectId, file.path);
        const text = entry.buffer.toString('utf8');
        matched = text.toLowerCase().includes(normalizedQuery);
        if (matched) preview = compactTextPreview(text, query);
      } catch {
        // Ignore unreadable files during search; read_json reports hard failures.
      }
    }

    if (!matched) continue;
    const result: BoundedJsonObject = {
      path: file.path,
      name: file.name,
      size: file.size,
      mtime: file.mtime,
      kind: file.kind ?? 'file',
      mime: file.mime ?? 'application/octet-stream',
    };
    if (preview !== undefined) result.preview = preview;
    matches.push(result);
  }

  return asBoundedRefreshOutput({ toolName: 'project_files.search', query: query ?? '', count: matches.length, truncated: allFiles.length > matches.length && matches.length >= maxResults, matches });
}

async function executeProjectFilesReadJson(options: ExecuteLocalDaemonRefreshSourceOptions): Promise<BoundedJsonObject> {
  const filePath = selectJsonPath(options.source.input as ProjectFilesReadJsonInput);
  if (!filePath.endsWith('.json')) throw new Error('project_files.read_json only supports .json files');
  const entry = await readProjectFile(options.projectsRoot, options.projectId, filePath);
  if (entry.size > 256 * 1024) throw new Error('project_files.read_json file exceeds 256KB');
  if (options.signal?.aborted === true) throw options.signal.reason;
  let parsed: BoundedJsonValue;
  try {
    parsed = JSON.parse(entry.buffer.toString('utf8')) as BoundedJsonValue;
  } catch {
    throw new Error(`project_files.read_json could not parse JSON at ${filePath}`);
  }
  return asBoundedRefreshOutput({ toolName: 'project_files.read_json', path: entry.path, size: entry.size, json: parsed });
}

function compactExecOutput(value: string): string[] {
  return value.split('\n').map((line) => line.trimEnd()).filter(Boolean).slice(0, 100);
}

async function runGit(projectPath: string, args: string[], signal: AbortSignal | undefined): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd: projectPath, signal, timeout: 10_000, maxBuffer: 128 * 1024 });
    return result.stdout.toString();
  } catch (error) {
    const maybeError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string; code?: unknown };
    if (maybeError.code === 128) return '';
    throw new Error(maybeError.stderr?.toString().trim() || maybeError.message || 'git command failed');
  }
}

async function executeGitSummary(options: ExecuteLocalDaemonRefreshSourceOptions): Promise<BoundedJsonObject> {
  const input = options.source.input as GitSummaryInput;
  const maxCommits = optionalPositiveInteger(input.maxCommits, 'input.maxCommits', 10, 50);
  const dir = projectDir(options.projectsRoot, options.projectId);
  const insideWorkTree = (await runGit(dir, ['rev-parse', '--is-inside-work-tree'], options.signal)).trim() === 'true';
  if (!insideWorkTree) return asBoundedRefreshOutput({ toolName: 'git.summary', isRepository: false, branch: '', status: [], recentCommits: [], diffStat: [] });

  const [branch, status, recentCommits, diffStat] = await Promise.all([
    runGit(dir, ['branch', '--show-current'], options.signal),
    runGit(dir, ['status', '--short'], options.signal),
    runGit(dir, ['log', `--max-count=${maxCommits}`, '--pretty=format:%h %s'], options.signal),
    runGit(dir, ['diff', '--stat', '--', '.'], options.signal),
  ]);

  return asBoundedRefreshOutput({
    toolName: 'git.summary',
    isRepository: true,
    branch: branch.trim(),
    status: compactExecOutput(status),
    recentCommits: compactExecOutput(recentCommits),
    diffStat: compactExecOutput(diffStat),
  });
}

export async function executeLocalDaemonRefreshSource(options: ExecuteLocalDaemonRefreshSourceOptions): Promise<BoundedJsonObject> {
  if (options.source.type !== 'daemon_tool') {
    throw new Error('local daemon refresh sources require source.type daemon_tool');
  }
  if (!isLocalDaemonRefreshToolName(options.source.toolName)) {
    throw new Error(`unsupported local daemon refresh tool: ${options.source.toolName ?? '<missing>'}`);
  }

  switch (options.source.toolName) {
    case 'project_files.search':
      return executeProjectFilesSearch(options);
    case 'project_files.read_json':
      return executeProjectFilesReadJson(options);
    case 'git.summary':
      return executeGitSummary(options);
  }
}
