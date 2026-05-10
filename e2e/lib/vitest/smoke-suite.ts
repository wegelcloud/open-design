import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertRelativeReportPath, createReport, type E2eReport } from './report.ts';

export type SmokeSuite = {
  codexHomeDir: string;
  dataDir: string;
  namespace: string;
  report: E2eReport;
  root: string;
  scratchDir: string;
  toolsDevRoot: string;
  writeScratchJson: (name: string, value: unknown) => Promise<string>;
  finalize: (result: SmokeSuiteFinalizeInput) => Promise<string>;
};

export type SmokeSuiteFinalizeInput = {
  diagnostics?: unknown;
  error?: unknown;
  success: boolean;
};

const e2eRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const workspaceRoot = dirname(e2eRoot);

export function e2eWorkspaceRoot(): string {
  return workspaceRoot;
}

export async function createSmokeSuite(name: string): Promise<SmokeSuite> {
  const namespace = `e2e-${sanitizeSegment(name)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const root = join(workspaceRoot, '.tmp', 'e2e', namespace);
  const reportDir = join(root, 'report');
  const scratchDir = join(root, 'scratch');
  const codexHomeDir = join(scratchDir, 'codex-home');
  const toolsDevRoot = join(scratchDir, 'tools-dev');
  const dataDir = join(scratchDir, 'data');

  await mkdir(reportDir, { recursive: true });
  await mkdir(scratchDir, { recursive: true });
  const report = await createReport(reportDir);

  async function writeJson(baseDir: string, name: string, value: unknown): Promise<string> {
    const safeName = assertRelativeReportPath(name);
    const outputPath = join(baseDir, safeName);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return outputPath;
  }

  return {
    codexHomeDir,
    dataDir,
    namespace,
    report,
    root,
    scratchDir,
    toolsDevRoot,
    writeScratchJson: (name, value) => writeJson(scratchDir, name, value),
    async finalize(result) {
      await report.json('suite-result.json', {
        namespace,
        reportPath: report.root,
        root,
        status: result.success ? 'success' : 'failed',
        timestamp: new Date().toISOString(),
      });

      if (result.success) {
        await rm(scratchDir, { force: true, recursive: true });
        return report.root;
      }

      await report.json('failure/preserved-site.json', {
        diagnostics: result.diagnostics ?? null,
        error: formatUnknown(result.error),
        preservedScratchDir: scratchDir,
      });
      return report.root;
    },
  };
}

function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'suite';
}

function formatUnknown(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
