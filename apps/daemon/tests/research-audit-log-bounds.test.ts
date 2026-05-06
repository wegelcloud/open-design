import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuditEntry,
  appendAuditEntry,
} from '../src/research/audit-log.js';

// PR #617 review (P2): a mutation route that passes a large array, a wide
// object, or a deeply branched detail must not produce a multi-MB JSONL
// line and block the daemon on synchronous JSON.stringify / appendFileSync.
// These tests pin the per-array, per-object, and per-line byte caps.

const PROJECT_ID = 'audit-bounds-fixture';

function baseEntry(detail: Record<string, unknown>): AuditEntry {
  return {
    timestamp: 1_700_000_000_000,
    projectId: PROJECT_ID,
    action: 'project.update',
    actor: 'system',
    detail,
  };
}

async function readWritten(projectRoot: string): Promise<unknown[]> {
  const file = path.join(projectRoot, '.od', 'projects', PROJECT_ID, 'audit.jsonl');
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe('research/audit-log redaction bounds', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'od-audit-bounds-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  it('caps long arrays and records the dropped count', async () => {
    const big = Array.from({ length: 250 }, (_, i) => `item-${i}`);
    appendAuditEntry(baseEntry({ items: big }), { projectRoot });
    const [row] = await readWritten(projectRoot);
    const detail = (row as { detail: { items: unknown[] } }).detail;
    expect(detail.items.length).toBe(101);
    expect(detail.items[0]).toBe('item-0');
    expect(detail.items[99]).toBe('item-99');
    expect(detail.items[100]).toMatch(/truncated 150 more item/);
  });

  it('caps wide objects and records the dropped key count', async () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 250; i++) wide[`k${i}`] = i;
    appendAuditEntry(baseEntry({ wide }), { projectRoot });
    const [row] = await readWritten(projectRoot);
    const detail = (row as { detail: { wide: Record<string, unknown> } }).detail;
    const keys = Object.keys(detail.wide);
    expect(keys.length).toBe(101);
    expect(keys).toContain('__truncated');
    expect(detail.wide['__truncated']).toMatch(/dropped 150 more key/);
  });

  it('replaces the line with a single truncation marker when the serialized line exceeds the cap', async () => {
    // Every individual string is under 4KB but combined they exceed the
    // 64KB line cap. The truncation marker is the only thing that should
    // remain in `detail`.
    const many = Array.from({ length: 30 }, () => ({
      pad: 'A'.repeat(3 * 1024),
    }));
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) wide[`k${i}`] = many;
    appendAuditEntry(baseEntry(wide), { projectRoot });
    const [row] = await readWritten(projectRoot);
    const detail = (row as { detail: Record<string, unknown> }).detail;
    expect(detail['__truncated']).toBe(true);
    expect(detail['reason']).toBe('audit-line-too-large');
    expect(typeof detail['originalDetailBytes']).toBe('number');
    expect(detail['maxLineBytes']).toBe(64 * 1024);
  });
});
