import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureProject, projectDir } from '../projects.js';
import type { LiveArtifact } from './schema.js';

export type LiveArtifactSummary = Omit<LiveArtifact, 'document' | 'tiles'> & {
  tileCount: number;
  hasDocument: boolean;
};

export const LIVE_ARTIFACTS_DIR_NAME = '.live-artifacts' as const;
export const LIVE_ARTIFACT_ARTIFACT_FILE = 'artifact.json' as const;
export const LIVE_ARTIFACT_TEMPLATE_FILE = 'template.html' as const;
export const LIVE_ARTIFACT_PREVIEW_FILE = 'index.html' as const;
export const LIVE_ARTIFACT_DATA_FILE = 'data.json' as const;
export const LIVE_ARTIFACT_PROVENANCE_FILE = 'provenance.json' as const;
export const LIVE_ARTIFACT_REFRESHES_FILE = 'refreshes.jsonl' as const;
export const LIVE_ARTIFACT_TILES_DIR = 'tiles' as const;
export const LIVE_ARTIFACT_SNAPSHOTS_DIR = 'snapshots' as const;

const SAFE_LIVE_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface LiveArtifactStorePaths {
  projectDir: string;
  rootDir: string;
  artifactDir: string;
  artifactJsonPath: string;
  templateHtmlPath: string;
  generatedPreviewHtmlPath: string;
  dataJsonPath: string;
  provenanceJsonPath: string;
  tilesDir: string;
  refreshesJsonlPath: string;
  snapshotsDir: string;
}

export interface LiveArtifactStoreSummary {
  artifact: LiveArtifactSummary;
  paths: LiveArtifactStorePaths;
}

export interface LiveArtifactStoreRecord {
  artifact: LiveArtifact;
  paths: LiveArtifactStorePaths;
}

export function validateLiveArtifactStorageId(artifactId: string): string {
  if (!SAFE_LIVE_ARTIFACT_ID.test(artifactId) || artifactId === '.' || artifactId === '..') {
    throw new Error('invalid live artifact id');
  }
  return artifactId;
}

export function liveArtifactsRootDir(projectsRoot: string, projectId: string): string {
  return path.join(projectDir(projectsRoot, projectId), LIVE_ARTIFACTS_DIR_NAME);
}

export function liveArtifactStorePaths(
  projectsRoot: string,
  projectId: string,
  artifactId: string,
): LiveArtifactStorePaths {
  const safeArtifactId = validateLiveArtifactStorageId(artifactId);
  const projectDirPath = projectDir(projectsRoot, projectId);
  const rootDir = path.join(projectDirPath, LIVE_ARTIFACTS_DIR_NAME);
  const artifactDir = path.resolve(rootDir, safeArtifactId);
  if (!artifactDir.startsWith(rootDir + path.sep)) {
    throw new Error('live artifact path escapes storage root');
  }

  return {
    projectDir: projectDirPath,
    rootDir,
    artifactDir,
    artifactJsonPath: path.join(artifactDir, LIVE_ARTIFACT_ARTIFACT_FILE),
    templateHtmlPath: path.join(artifactDir, LIVE_ARTIFACT_TEMPLATE_FILE),
    generatedPreviewHtmlPath: path.join(artifactDir, LIVE_ARTIFACT_PREVIEW_FILE),
    dataJsonPath: path.join(artifactDir, LIVE_ARTIFACT_DATA_FILE),
    provenanceJsonPath: path.join(artifactDir, LIVE_ARTIFACT_PROVENANCE_FILE),
    tilesDir: path.join(artifactDir, LIVE_ARTIFACT_TILES_DIR),
    refreshesJsonlPath: path.join(artifactDir, LIVE_ARTIFACT_REFRESHES_FILE),
    snapshotsDir: path.join(artifactDir, LIVE_ARTIFACT_SNAPSHOTS_DIR),
  };
}

export function liveArtifactTilePath(paths: LiveArtifactStorePaths, tileId: string): string {
  const safeTileId = validateLiveArtifactStorageId(tileId);
  return path.join(paths.tilesDir, `${safeTileId}.json`);
}

export async function ensureLiveArtifactStoreLayout(
  projectsRoot: string,
  projectId: string,
  artifactId: string,
): Promise<LiveArtifactStorePaths> {
  await ensureProject(projectsRoot, projectId);
  const paths = liveArtifactStorePaths(projectsRoot, projectId, artifactId);
  await mkdir(paths.tilesDir, { recursive: true });
  await mkdir(paths.snapshotsDir, { recursive: true });
  await writeFile(paths.refreshesJsonlPath, '', { flag: 'a' });
  return paths;
}
