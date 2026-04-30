import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deleteProjectFile, listFiles, readProjectFile, writeProjectFile } from '../src/projects.js';
import {
  ensureLiveArtifactStoreLayout,
  liveArtifactStorePaths,
  liveArtifactTilePath,
} from '../src/live-artifacts/store.js';

const tempRoots: string[] = [];

async function makeProjectsRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'od-live-artifacts-'));
  tempRoots.push(root);
  return path.join(root, 'projects');
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('live artifact store layout', () => {
  it('resolves and creates the project-scoped live artifact directory layout', async () => {
    const projectsRoot = await makeProjectsRoot();
    const paths = await ensureLiveArtifactStoreLayout(projectsRoot, 'project-1', 'artifact-1');

    expect(paths.projectDir).toBe(path.join(projectsRoot, 'project-1'));
    expect(paths.rootDir).toBe(path.join(projectsRoot, 'project-1', '.live-artifacts'));
    expect(paths.artifactDir).toBe(path.join(paths.rootDir, 'artifact-1'));
    expect(paths.artifactJsonPath).toBe(path.join(paths.artifactDir, 'artifact.json'));
    expect(paths.templateHtmlPath).toBe(path.join(paths.artifactDir, 'template.html'));
    expect(paths.dataJsonPath).toBe(path.join(paths.artifactDir, 'data.json'));
    expect(paths.provenanceJsonPath).toBe(path.join(paths.artifactDir, 'provenance.json'));
    expect(paths.refreshesJsonlPath).toBe(path.join(paths.artifactDir, 'refreshes.jsonl'));
    expect(paths.snapshotsDir).toBe(path.join(paths.artifactDir, 'snapshots'));
    expect(liveArtifactTilePath(paths, 'tile-1')).toBe(path.join(paths.artifactDir, 'tiles', 'tile-1.json'));

    await expect(stat(paths.tilesDir)).resolves.toMatchObject({});
    await expect(stat(paths.snapshotsDir)).resolves.toMatchObject({});
    await expect(readFile(paths.refreshesJsonlPath, 'utf8')).resolves.toBe('');
  });

  it('keeps live artifact storage under the configured projects root', async () => {
    const projectsRoot = path.join(await makeProjectsRoot(), 'custom-data-root', 'projects');
    const paths = liveArtifactStorePaths(projectsRoot, 'project-1', 'artifact-1');

    expect(paths.artifactDir).toBe(
      path.join(projectsRoot, 'project-1', '.live-artifacts', 'artifact-1'),
    );
  });

  it('rejects artifact and tile ids that could escape the storage root', async () => {
    const projectsRoot = await makeProjectsRoot();
    const paths = await ensureLiveArtifactStoreLayout(projectsRoot, 'project-1', 'artifact-1');

    expect(() => liveArtifactStorePaths(projectsRoot, 'project-1', '../artifact')).toThrow(/invalid live artifact id/);
    expect(() => liveArtifactStorePaths(projectsRoot, 'project-1', '/artifact')).toThrow(/invalid live artifact id/);
    expect(() => liveArtifactTilePath(paths, '../tile')).toThrow(/invalid live artifact id/);
  });

  it('excludes .live-artifacts from generic project file reads, writes, deletes, and listings', async () => {
    const projectsRoot = await makeProjectsRoot();
    const paths = await ensureLiveArtifactStoreLayout(projectsRoot, 'project-1', 'artifact-1');

    await writeProjectFile(projectsRoot, 'project-1', 'public.txt', Buffer.from('visible'));
    await writeProjectFile(projectsRoot, 'project-1', paths.artifactJsonPath.slice(paths.projectDir.length + 1), Buffer.from('{}'))
      .then(
        () => Promise.reject(new Error('reserved write unexpectedly succeeded')),
        (error) => expect(String(error)).toContain('reserved project path'),
      );

    await expect(readProjectFile(projectsRoot, 'project-1', '.live-artifacts/artifact-1/artifact.json')).rejects.toThrow(
      /reserved project path/,
    );
    await expect(deleteProjectFile(projectsRoot, 'project-1', '.live-artifacts/artifact-1/artifact.json')).rejects.toThrow(
      /reserved project path/,
    );

    const files = await listFiles(projectsRoot, 'project-1');
    expect(files.map((file) => file.path)).toEqual(['public.txt']);
    await expect(readdir(paths.rootDir)).resolves.toEqual(['artifact-1']);
  });
});
