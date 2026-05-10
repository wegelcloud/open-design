// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createFakeAgentRuntimes } from '@/fake-agents';
import {
  extractArtifactFromRunEvents,
  persistExtractedArtifact,
  type ProjectFile,
} from '@/vitest/artifacts';
import { requestJson, requestText } from '@/vitest/http';
import { listMessages, saveMessage } from '@/vitest/messages';
import { startRun, readRunEvents, waitForRunStatus } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/smoke-suite';
import {
  allocateToolsDevRuntime,
  inspectToolsDevCheck,
  inspectToolsDevStatus,
  readToolsDevLogs,
  startToolsDevWeb,
  stopToolsDevWeb,
  type ToolsDevStartResult,
} from '@/vitest/tools-dev';

const GENERATED_FILE = 'real-daemon-smoke.html';
const GENERATED_HEADING = 'Real Daemon Smoke';
const PROMPT = 'Create a deterministic smoke artifact';

type ProjectResponse = {
  conversationId: string;
  project: {
    id: string;
    metadata?: {
      kind?: string;
    };
    name: string;
  };
};

type ProjectFilesResponse = {
  files: ProjectFile[];
};

describe('dialog main spec', () => {
  test('creates a project, runs the configured agent, streams events, and persists the generated artifact', async () => {
    const suite = await createSmokeSuite('dialog-main');
    const runtime = await allocateToolsDevRuntime();
    let start: ToolsDevStartResult | null = null;
    let success = false;
    let diagnostics: unknown = null;

    try {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
        runtimeIds: ['codex'],
      });

      start = await startToolsDevWeb(suite, runtime);
      const webUrl = assertRuntimeUrl(start.web?.status.url, 'web');

      const status = await inspectToolsDevStatus(suite);
      expect(status.namespace).toBe(suite.namespace);
      expect(status.apps?.daemon?.state).toBe('running');
      expect(status.apps?.web?.state).toBe('running');

      await requestJson<{ config: Record<string, unknown> }>(webUrl, '/api/app-config', {
        body: {
          agentCliEnv: { codex: fakeAgents.codex.env },
          agentId: 'codex',
          agentModels: { codex: { model: 'default', reasoning: 'default' } },
          designSystemId: null,
          onboardingCompleted: true,
          skillId: null,
          telemetry: { artifactManifest: true, content: false, metrics: false },
        },
        method: 'PUT',
      });

      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { kind: 'prototype' },
          name: 'Dialog main smoke project',
          pendingPrompt: null,
          skillId: null,
        },
      });
      expect(project.conversationId).toEqual(expect.any(String));
      expect(project.project.metadata?.kind).toBe('prototype');

      const requestId = `dialog-main-${Date.now()}`;
      const now = Date.now();
      const userMessageId = `user-${requestId}`;
      const assistantMessageId = `assistant-${requestId}`;
      await saveMessage(webUrl, project.project.id, project.conversationId, {
        content: PROMPT,
        createdAt: now,
        id: userMessageId,
        role: 'user',
      });
      await saveMessage(webUrl, project.project.id, project.conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: now,
        events: [],
        id: assistantMessageId,
        role: 'assistant',
        runStatus: 'running',
        startedAt: now,
      });

      const run = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: requestId,
        conversationId: project.conversationId,
        designSystemId: null,
        message: PROMPT,
        model: 'default',
        projectId: project.project.id,
        reasoning: 'default',
        skillId: null,
      });

      const finalRun = await waitForRunStatus(webUrl, run.runId, 'succeeded', { timeoutMs: 30_000 });
      expect(finalRun.projectId).toBe(project.project.id);
      expect(finalRun.conversationId).toBe(project.conversationId);
      expect(finalRun.agentId).toBe('codex');

      const events = await readRunEvents(webUrl, run.runId);
      expect(events).toContain('real-daemon-smoke');
      expect(events).toContain('"type":"usage"');
      expect(events).toContain('"status":"succeeded"');

      const artifact = extractArtifactFromRunEvents(events);
      expect(artifact.identifier).toBe('real-daemon-smoke');
      expect(artifact.title).toBe(GENERATED_HEADING);
      expect(artifact.html).toContain(GENERATED_HEADING);

      const persistedArtifact = await persistExtractedArtifact(
        webUrl,
        project.project.id,
        artifact,
        { designSystemId: null, sourceSkillId: null },
      );
      expect(persistedArtifact.name).toBe(GENERATED_FILE);
      expect(persistedArtifact.kind).toBe('html');

      const files = await requestJson<ProjectFilesResponse>(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/files`,
      );
      const generated = files.files.find((file) => file.name === GENERATED_FILE);
      expect(generated?.kind).toBe('html');
      expect(generated?.artifactManifest?.title).toBe(GENERATED_HEADING);
      expect(generated?.artifactManifest?.renderer).toBe('html');

      const rawHtml = await requestText(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/raw/${GENERATED_FILE}`,
      );
      expect(rawHtml).toContain(GENERATED_HEADING);
      expect(rawHtml).toContain('Generated through the daemon run path.');

      await saveMessage(webUrl, project.project.id, project.conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: artifact.rawText,
        createdAt: now,
        endedAt: Date.now(),
        events: [],
        id: assistantMessageId,
        producedFiles: [persistedArtifact],
        role: 'assistant',
        runId: finalRun.id,
        runStatus: 'succeeded',
        startedAt: now,
        telemetryFinalized: true,
      });

      const messages = await listMessages(
        webUrl,
        project.project.id,
        project.conversationId,
      );
      const assistantMessage = messages.find((message) => message.id === finalRun.assistantMessageId);
      expect(assistantMessage?.runStatus).toBe('succeeded');
      expect(assistantMessage?.producedFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactManifest: expect.objectContaining({ title: GENERATED_HEADING }),
            name: GENERATED_FILE,
          }),
        ]),
      );

      const logs = await readToolsDevLogs(suite);
      assertNoFatalLogs(logs);

      await suite.report.json('summary.json', {
        artifact: {
          manifest: generated?.artifactManifest,
          name: generated?.name,
          size: generated?.size,
        },
        conversationId: project.conversationId,
        files: files.files.map((file) => ({
          artifactManifest: file.artifactManifest,
          kind: file.kind,
          name: file.name,
          size: file.size,
        })),
        namespace: suite.namespace,
        project: project.project,
        run: finalRun,
        runtime: {
          daemonPort: runtime.daemonPort,
          webPort: runtime.webPort,
          webUrl,
        },
        status,
      });
      success = true;
    } catch (error) {
      diagnostics = await inspectToolsDevCheck(suite).catch((diagnosticError: unknown) => ({
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
      throw error;
    } finally {
      if (start != null) {
        await stopToolsDevWeb(suite).catch((error: unknown) => {
          diagnostics = {
            diagnostics,
            stopError: error instanceof Error ? error.message : String(error),
          };
        });
      }
      await suite.finalize({ diagnostics, success });
    }
  }, 180_000);
});

function assertRuntimeUrl(value: string | null | undefined, app: string): string {
  if (typeof value !== 'string' || !value.startsWith('http://')) {
    throw new Error(`${app} runtime did not expose an http URL: ${String(value)}`);
  }
  return value;
}

function assertNoFatalLogs(logs: Record<string, { lines: string[] }>): void {
  const combined = Object.values(logs)
    .flatMap((entry) => entry.lines)
    .join('\n');
  expect(combined).not.toMatch(/ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
  expect(combined).not.toMatch(/standalone Next\.js server exited/i);
  expect(combined).not.toMatch(/packaged runtime failed/i);
  expect(combined).not.toMatch(/Agent completed without producing any output/i);
}
