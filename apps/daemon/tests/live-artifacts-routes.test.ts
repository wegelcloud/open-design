// @ts-nocheck
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');

let server;
let baseUrl;
const projectIds = [];

beforeEach(async () => {
  const started = await startServer({ port: 0, returnServer: true });
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  await new Promise((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
  server = undefined;
  await Promise.all(
    projectIds.splice(0).map((projectId) =>
      rm(path.join(projectRoot, '.od', 'projects', projectId), { recursive: true, force: true }),
    ),
  );
});

function uniqueProjectId() {
  const id = `route-live-artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  projectIds.push(id);
  return id;
}

function validCreateInput(title = 'Tool Route Live Artifact') {
  return {
    title,
    preview: { type: 'html', entry: 'index.html' },
    document: {
      format: 'html_template_v1',
      templatePath: 'template.html',
      generatedPreviewPath: 'index.html',
      dataPath: 'data.json',
      dataJson: { title, owner: 'Agent' },
    },
  };
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
}

describe('live artifact tool routes', () => {
  it('creates and lists live artifacts for agent registration', async () => {
    const projectId = uniqueProjectId();
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        input: validCreateInput(),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1><p>{{data.owner}}</p>',
        provenanceJson: {
          generatedAt: '2026-04-30T00:00:00.000Z',
          generatedBy: 'agent',
          sources: [{ label: 'Route test', type: 'user_input' }],
        },
        createdByRunId: 'run-route-test',
      }),
    });

    expect(create.status).toBe(200);
    expect(create.body.artifact).toMatchObject({
      projectId,
      title: 'Tool Route Live Artifact',
      createdByRunId: 'run-route-test',
      refreshStatus: 'never',
    });

    const list = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/list?projectId=${encodeURIComponent(projectId)}`);

    expect(list.status).toBe(200);
    expect(list.body.artifacts).toHaveLength(1);
    expect(list.body.artifacts[0]).toMatchObject({
      id: create.body.artifact.id,
      projectId,
      title: 'Tool Route Live Artifact',
      hasDocument: true,
      tileCount: 0,
    });
    expect(list.body.artifacts[0].document).toBeUndefined();
    expect(list.body.artifacts[0].tiles).toBeUndefined();
  });

  it('returns shared API validation errors from tool create', async () => {
    const projectId = uniqueProjectId();
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, input: { title: '' } }),
    });

    expect(create.status).toBe(400);
    expect(create.body.error).toMatchObject({
      code: 'LIVE_ARTIFACT_INVALID',
      details: { kind: 'validation' },
    });
  });
});
