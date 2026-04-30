import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listSkills } from '../src/skills.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const skillsRoot = path.join(repoRoot, 'skills');
const liveArtifactRoot = path.join(skillsRoot, 'live-artifact');

describe('listSkills', () => {
  it('includes the built-in live-artifact skill catalog entry', async () => {
    const skills = await listSkills(skillsRoot);
    const skill = skills.find((entry: { id: string }) => entry.id === 'live-artifact');

    expect(skill).toBeTruthy();
    expect(skill).toMatchObject({
      id: 'live-artifact',
      name: 'live-artifact',
      mode: 'prototype',
      previewType: 'html',
    });
    expect(skill.triggers.length).toBeGreaterThan(0);
    expect(skill.body).toContain(`> **Skill root (absolute):** \`${liveArtifactRoot}\``);
    expect(skill.body).toContain('references/artifact-schema.md');
    expect(skill.body).toContain('references/connector-policy.md');
    expect(skill.body).toContain('references/refresh-contract.md');
    expect(skill.body).toContain('od tools live-artifacts create --input artifact.json');
    expect(skill.body).toContain('`OD_DAEMON_URL`');
    expect(skill.body).toContain('`OD_TOOL_TOKEN`');
  });
});
