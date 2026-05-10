// @vitest-environment node

import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  listCodexPets,
  readCodexPetSpritesheet,
  writeCodexPetFixture,
} from '@/vitest/pets';
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

const USER_PET_ID = 'qa-inspect-pet';
const USER_PET_NAME = 'QA Inspect Pet';
const USER_PET_DESCRIPTION = 'Seeded by the Pet pure inspect spec.';

describe('pet main spec', () => {
  test('serves deterministic Codex pet registry entries and spritesheets', async () => {
    const suite = await createSmokeSuite('pet-main');
    const runtime = await allocateToolsDevRuntime();
    let start: ToolsDevStartResult | null = null;
    let success = false;
    let diagnostics: unknown = null;

    try {
      const fixture = await writeCodexPetFixture(suite, {
        description: USER_PET_DESCRIPTION,
        displayName: USER_PET_NAME,
        id: USER_PET_ID,
      });

      start = await startToolsDevWeb(suite, runtime);
      const webUrl = assertRuntimeUrl(start.web?.status.url, 'web');

      const status = await inspectToolsDevStatus(suite);
      expect(status.namespace).toBe(suite.namespace);
      expect(status.apps?.daemon?.state).toBe('running');
      expect(status.apps?.web?.state).toBe('running');

      const registry = await listCodexPets(webUrl);
      expect(registry.rootDir).toBe(join(suite.codexHomeDir, 'pets'));

      const userPet = registry.pets.find((pet) => pet.id === USER_PET_ID);
      expect(userPet).toEqual(expect.objectContaining({
        bundled: false,
        description: USER_PET_DESCRIPTION,
        displayName: USER_PET_NAME,
        id: USER_PET_ID,
        spritesheetExt: 'png',
        spritesheetUrl: `/api/codex-pets/${USER_PET_ID}/spritesheet`,
      }));

      const bundledPet = registry.pets.find((pet) => pet.id === 'clippit');
      expect(bundledPet).toEqual(expect.objectContaining({
        bundled: true,
        id: 'clippit',
        spritesheetExt: 'webp',
      }));

      const userSheet = await readCodexPetSpritesheet(webUrl, USER_PET_ID);
      expect(userSheet.status).toBe(200);
      expect(userSheet.contentType).toMatch(/^image\/png\b/);
      expect(userSheet.cacheControl).toBe('no-store');
      expect(userSheet.origin).toBe('null');
      expect(userSheet.body.equals(fixture.png)).toBe(true);

      const bundledSheet = await readCodexPetSpritesheet(webUrl, 'clippit');
      expect(bundledSheet.status).toBe(200);
      expect(bundledSheet.contentType).toMatch(/^image\/webp\b/);
      expect(bundledSheet.body.byteLength).toBeGreaterThan(0);

      const escapedSheet = await readCodexPetSpritesheet(webUrl, '../../etc/passwd');
      expect(escapedSheet.status).toBe(404);

      const logs = await readToolsDevLogs(suite);
      assertNoFatalLogs(logs);

      await suite.report.json('summary.json', {
        namespace: suite.namespace,
        registry: {
          bundledCount: registry.pets.filter((pet) => pet.bundled).length,
          rootDir: registry.rootDir,
          userPet,
        },
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
}
