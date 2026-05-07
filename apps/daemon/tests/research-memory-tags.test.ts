import Database from 'better-sqlite3';

import { describe, expect, it } from 'vitest';

import {
  createMemory,
  ensureMemoriesTable,
} from '../src/research/memory-schema.js';

// PR #617 review (P1): `createMemory()` validates `input.content` but used to
// accept `input.tags` as-is. Since `buildMemoryPrefix()` emits tags into the
// prompt JSON, an unvalidated tag string lets a caller bypass the 8KB content
// cap and prompt-frame token check. These tests pin the tag schema.

function baseInput(tags?: unknown) {
  return {
    scope: 'project' as const,
    scopeId: 'p1',
    kind: 'fact' as const,
    content: 'a normal memory entry',
    source: 'user_pin' as const,
    ...(tags !== undefined ? { tags: tags as string[] } : {}),
  };
}

function newDb(): Database.Database {
  const db = new Database(':memory:');
  ensureMemoriesTable(db);
  return db;
}

describe('research/memory-schema createMemory tag validation', () => {
  it('accepts a small array of slug-shaped tags', () => {
    const db = newDb();
    const entry = createMemory(db, baseInput(['team-foo', 'auth.v2', 'a1']));
    expect(entry.tags).toEqual(['team-foo', 'auth.v2', 'a1']);
  });

  it('accepts an empty array (default)', () => {
    const db = newDb();
    const entry = createMemory(db, baseInput([]));
    expect(entry.tags).toEqual([]);
  });

  it('rejects non-array tag inputs', () => {
    const db = newDb();
    expect(() => createMemory(db, baseInput('not-an-array'))).toThrow(/array of strings/i);
    expect(() => createMemory(db, baseInput({ a: 1 }))).toThrow(/array of strings/i);
  });

  it('rejects more than 16 tags', () => {
    const db = newDb();
    const tags = Array.from({ length: 17 }, (_, i) => `t${i}`);
    expect(() => createMemory(db, baseInput(tags))).toThrow(/16 entries/);
  });

  it('rejects tags longer than 64 chars (slug pattern)', () => {
    const db = newDb();
    const long = 'a'.repeat(65);
    expect(() => createMemory(db, baseInput([long]))).toThrow(/slug strings/i);
  });

  it('rejects tags whose shapes are not slug-like', () => {
    const db = newDb();
    expect(() => createMemory(db, baseInput(['Has Space']))).toThrow(/slug strings/i);
    expect(() => createMemory(db, baseInput(['UPPER']))).toThrow(/slug strings/i);
    expect(() => createMemory(db, baseInput(['']))).toThrow(/slug strings/i);
  });

  it('rejects tags containing prompt-frame tokens', () => {
    const db = newDb();
    // Slug pattern blocks `<` already; but if a future relaxation allowed
    // other characters, the prompt-frame guard must still catch known
    // wrapper / role tags.
    expect(() => createMemory(db, baseInput(['<system>']))).toThrow(/slug strings/i);
  });

  it('rejects tags whose total bytes exceed 512', () => {
    const db = newDb();
    // 16 × 33-byte tags = 528 bytes — still under MAX_TAGS but over the
    // total-bytes cap.
    const tags = Array.from({ length: 16 }, (_, i) => `tag-${String(i).padStart(2, '0')}`.padEnd(33, 'x'));
    expect(() => createMemory(db, baseInput(tags))).toThrow(/512 bytes total/);
  });

  it('rejects non-string tag elements', () => {
    const db = newDb();
    expect(() => createMemory(db, baseInput([42 as unknown as string]))).toThrow(/must be strings/);
  });
});
