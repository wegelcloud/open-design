import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SmokeSuite = {
  codexHomeDir: string;
  dataDir: string;
  namespace: string;
  reportDir: string;
  root: string;
  scratchDir: string;
  toolsDevRoot: string;
  writeReportJson: (name: string, value: unknown) => Promise<string>;
  writeScratchJson: (name: string, value: unknown) => Promise<string>;
  finalize: (result: SmokeSuiteFinalizeInput) => Promise<void>;
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

  async function writeJson(baseDir: string, name: string, value: unknown): Promise<string> {
    const safeName = assertRelativeArtifactName(name);
    const outputPath = join(baseDir, safeName);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return outputPath;
  }

  return {
    codexHomeDir,
    dataDir,
    namespace,
    reportDir,
    root,
    scratchDir,
    toolsDevRoot,
    writeReportJson: (name, value) => writeJson(reportDir, name, value),
    writeScratchJson: (name, value) => writeJson(scratchDir, name, value),
    async finalize(result) {
      await writeJson(reportDir, 'suite-result.json', {
        namespace,
        reportDir,
        root,
        status: result.success ? 'success' : 'failed',
        timestamp: new Date().toISOString(),
      });

      if (result.success) {
        await rm(scratchDir, { force: true, recursive: true });
        return;
      }

      await writeJson(reportDir, 'failure/preserved-site.json', {
        diagnostics: result.diagnostics ?? null,
        error: formatUnknown(result.error),
        preservedScratchDir: scratchDir,
      });
    },
  };
}

function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'suite';
}

function assertRelativeArtifactName(name: string): string {
  const unixName = name.replace(/\\/g, '/');
  if (unixName.includes('\0') || unixName.startsWith('/') || /^[A-Za-z]:\//.test(unixName)) {
    throw new Error(`artifact name must be relative: ${name}`);
  }
  const normalized = posix.normalize(unixName);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`artifact name must not escape report root: ${name}`);
  }
  return normalized;
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
