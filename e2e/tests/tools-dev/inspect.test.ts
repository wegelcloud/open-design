// @vitest-environment node

import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { requestJson, requestText } from '@/vitest/http';
import { createMockOpenAiServer } from '@/vitest/mock-openai';
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

type HealthResponse = {
  ok?: unknown;
  service?: unknown;
  version?: unknown;
};

type ProjectResponse = {
  project: {
    id: string;
    metadata?: {
      kind?: string;
    };
    name: string;
  };
};

type ProjectFilesResponse = {
  files: Array<{
    artifactManifest?: {
      kind?: string;
      renderer?: string;
      status?: string;
      title?: string;
    };
    kind?: string;
    name: string;
    size: number;
  }>;
};

type ProviderConnectionResponse = {
  kind: string;
  latencyMs: number;
  model?: string;
  ok: boolean;
  sample?: string;
  status?: number;
};

describe('tools-dev pure inspect smoke', () => {
  test('runs a namespace-isolated web/daemon runtime with a mocked OpenAI provider and artifact file', async () => {
    const suite = await createSmokeSuite('tools-dev-provider');
    const runtime = await allocateToolsDevRuntime();
    const mock = await createMockOpenAiServer({ model: 'e2e-smoke-model' });
    let start: ToolsDevStartResult | null = null;
    let success = false;
    let diagnostics: unknown = null;

    try {
      start = await startToolsDevWeb(suite, runtime);
      const webUrl = assertRuntimeUrl(start.web?.status.url, 'web');

      const status = await inspectToolsDevStatus(suite);
      expect(status.namespace).toBe(suite.namespace);
      expect(status.apps?.daemon?.state).toBe('running');
      expect(status.apps?.web?.state).toBe('running');

      const health = await requestJson<HealthResponse>(webUrl, '/api/health');
      expect(health.ok).toBe(true);
      expect(health.version).toEqual(expect.any(String));

      const config = await requestJson<{ config: Record<string, unknown> }>(webUrl, '/api/app-config', {
        body: {
          agentId: null,
          agentModels: {},
          onboardingCompleted: true,
          privacyDecisionAt: Date.now(),
          telemetry: { artifactManifest: true, content: false, metrics: false },
        },
        method: 'PUT',
      });
      expect(config.config.onboardingCompleted).toBe(true);

      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          id: randomUUID(),
          name: 'Pure inspect smoke project',
          metadata: { kind: 'prototype' },
          pendingPrompt: 'Create a deterministic inspect smoke artifact',
        },
      });
      expect(project.project.id).toEqual(expect.any(String));
      expect(project.project.metadata?.kind).toBe('prototype');

      const file = await requestJson<{ file: { name: string; size: number } }>(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/files`,
        {
          body: {
            artifactManifest: {
              entry: 'index.html',
              exports: ['html'],
              kind: 'html',
              renderer: 'html',
              status: 'complete',
              title: 'Pure Inspect Smoke Artifact',
              version: 1,
            },
            content: '<!doctype html><html><body><main data-e2e="pure-inspect-smoke">ok</main></body></html>',
            name: 'index.html',
          },
        },
      );
      expect(file.file.name).toBe('index.html');
      expect(file.file.size).toBeGreaterThan(0);

      const files = await requestJson<ProjectFilesResponse>(webUrl, `/api/projects/${encodeURIComponent(project.project.id)}/files`);
      const indexFile = files.files.find((entry) => entry.name === 'index.html');
      expect(indexFile?.artifactManifest?.title).toBe('Pure Inspect Smoke Artifact');
      expect(indexFile?.artifactManifest?.renderer).toBe('html');

      const rawHtml = await requestText(webUrl, `/api/projects/${encodeURIComponent(project.project.id)}/raw/index.html`);
      expect(rawHtml).toContain('data-e2e="pure-inspect-smoke"');

      const connection = await requestJson<ProviderConnectionResponse>(webUrl, '/api/test/connection', {
        body: {
          apiKey: 'sk-e2e-placeholder',
          baseUrl: mock.baseUrl,
          mode: 'provider',
          model: 'e2e-smoke-model',
          protocol: 'openai',
        },
      });
      expect(connection.ok).toBe(true);
      expect(connection.kind).toBe('success');
      expect(connection.sample).toBe('ok');
      expect(mock.requests().map((request) => request.path)).toEqual(['/v1/models', '/v1/chat/completions']);

      const logs = await readToolsDevLogs(suite);
      assertNoFatalLogs(logs);

      await suite.report.json('summary.json', {
        connection,
        files: files.files.map((entry) => ({
          artifactManifest: entry.artifactManifest,
          kind: entry.kind,
          name: entry.name,
          size: entry.size,
        })),
        health,
        mockRequests: mock.requests().map((request) => ({
          body: request.body,
          method: request.method,
          path: request.path,
          receivedAt: request.receivedAt,
        })),
        namespace: suite.namespace,
        project: project.project,
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
      await suite.writeScratchJson('failure/mock-requests.json', mock.requests()).catch(() => undefined);
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
      await mock.close();
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
}
