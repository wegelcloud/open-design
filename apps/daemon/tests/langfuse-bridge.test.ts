import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportRunCompletedFromDaemon } from '../src/langfuse-bridge.js';

interface FakeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  producedFiles?: Array<Record<string, unknown>>;
}

function makeDb(messagesByConvo: Record<string, FakeMessage[]> = {}) {
  return {
    __messages: messagesByConvo,
    prepare() {
      throw new Error('listMessages should be the only DB call in tests');
    },
  };
}

function makeRun(over: Partial<Parameters<typeof reportRunCompletedFromDaemon>[0]['run']> = {}) {
  const now = Date.now();
  return {
    id: 'run-id-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    assistantMessageId: 'msg-1',
    agentId: 'claude',
    status: 'succeeded',
    createdAt: now - 4500,
    updatedAt: now,
    events: [
      { id: 1, event: 'agent', data: { type: 'tool_use' } },
      { id: 2, event: 'agent', data: { type: 'tool_use' } },
      {
        id: 3,
        event: 'agent',
        data: {
          type: 'usage',
          usage: { input_tokens: 100, output_tokens: 200 },
        },
      },
    ] as Array<{ id: number; event: string; data: unknown }>,
    userPrompt: 'design a coffee landing page',
    ...over,
  };
}

describe('langfuse-bridge.reportRunCompletedFromDaemon', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-bridge-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeAppCfg(cfg: Record<string, unknown>) {
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify(cfg));
  }

  it('does nothing when telemetry.metrics is off', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: false },
    });
    const fetchSpy = vi.fn();
    await reportRunCompletedFromDaemon({
      db: makeDb(),
      dataDir,
      run: makeRun() as any,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when no app-config.json exists (fresh install)', async () => {
    const fetchSpy = vi.fn();
    await reportRunCompletedFromDaemon({
      db: makeDb(),
      dataDir,
      run: makeRun() as any,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds a ReportContext from db + app-config and POSTs the trace', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const messages: FakeMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Here is a draft …',
        producedFiles: [
          { name: 'index.html', kind: 'html', size: 4096 },
          { name: 'style.css', kind: 'code', size: 800 },
        ],
      },
    ];
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': messages }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    expect(batch).toHaveLength(2);
    const trace = batch[0].body;
    expect(trace.userId).toBe('install-uuid-1');
    expect(trace.sessionId).toBe('conv-1');
    expect(trace.input).toBe('design a coffee landing page');
    expect(trace.output).toBe('Here is a draft …');
    expect(trace.tags).toEqual([
      'open-design',
      'project:proj-1',
      'agent:claude',
    ]);
    expect(trace.metadata.eventsSummary.toolCalls).toBe(2);
    expect(trace.metadata.eventsSummary.errors).toBe(0);
    expect(trace.metadata.tokens).toEqual({
      input: 100,
      output: 200,
      total: 300,
    });
    expect(trace.metadata.artifacts).toEqual([
      { slug: 'index.html', type: 'html', sizeBytes: 4096 },
      { slug: 'style.css', type: 'code', sizeBytes: 800 },
    ]);
    expect(trace.metadata.success).toBe(true);
  });

  it('omits content + artifacts when those gates are off', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: {
        metrics: true,
        content: false,
        artifactManifest: false,
      },
    });
    const messages: FakeMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'sensitive output',
        producedFiles: [{ name: 'secret.html', kind: 'html', size: 1 }],
      },
    ];
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': messages }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const trace = JSON.parse(init.body as string).batch[0].body;
    expect(trace.input).toBeUndefined();
    expect(trace.output).toBeUndefined();
    expect(trace.metadata.artifacts).toBeUndefined();
    // tokens + eventsSummary are still in metadata since they're metrics
    expect(trace.metadata.tokens).toEqual({
      input: 100,
      output: 200,
      total: 300,
    });
  });

  it('passes status=failed and a clipped error message through', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun({
          status: 'failed',
          events: [
            {
              id: 1,
              event: 'error',
              data: { error: { message: 'agent stream blew up' } },
            },
          ],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    expect(batch[0].body.metadata.status).toBe('failed');
    expect(batch[0].body.metadata.success).toBe(false);
    expect(batch[0].body.metadata.error).toBe('agent stream blew up');
    expect(batch[1].body.level).toBe('ERROR');
    expect(batch[1].body.statusMessage).toBe('agent stream blew up');
  });

  it('survives a missing assistant message (web has not PUT yet)', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const trace = JSON.parse(init.body as string).batch[0].body;
    expect(trace.input).toBe('design a coffee landing page');
    // truncate() drops empty strings, so output is omitted entirely.
    expect(trace.output).toBeUndefined();
  });
});

// listMessages reads from a `prepare(...).all(cid)` call against
// better-sqlite3. To avoid spinning up SQLite in unit tests we provide a
// stub that satisfies the same shape used in `apps/daemon/src/db.ts`.
function makeDbWithListMessages(messagesByConvo: Record<string, FakeMessage[]>) {
  // Mirror db.ts: SELECT returns *Json columns and listMessages runs them
  // through normalizeMessage which JSON.parses producedFilesJson into
  // producedFiles. Tests pass producedFiles directly, so we round-trip
  // through JSON.stringify to match the real-world shape.
  return {
    prepare(_sql: string) {
      return {
        all(cid: string) {
          return (messagesByConvo[cid] ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentId: null,
            agentName: null,
            runId: null,
            runStatus: null,
            lastRunEventId: null,
            eventsJson: null,
            attachmentsJson: null,
            commentAttachmentsJson: null,
            producedFilesJson: m.producedFiles
              ? JSON.stringify(m.producedFiles)
              : null,
            createdAt: 0,
            startedAt: null,
            endedAt: null,
            position: 0,
          }));
        },
      };
    },
  };
}
