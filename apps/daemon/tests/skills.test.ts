import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { rmSync } from 'node:fs';

import { SKILLS_CWD_ALIAS } from '../src/cwd-aliases.js';
import {
  deleteUserSkill,
  importUserSkill,
  listSkills,
  slugifySkillName,
} from '../src/skills.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const skillsRoot = path.join(repoRoot, 'skills');
const liveArtifactRoot = path.join(skillsRoot, 'live-artifact');

function fresh(): string {
  return mkdtempSync(path.join(tmpdir(), 'od-skills-'));
}

function writeSkill(
  root: string,
  folder: string,
  options: {
    name?: string;
    description?: string;
    body?: string;
    withAttachments?: boolean;
  } = {},
) {
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    `name: ${options.name ?? folder}`,
    `description: ${options.description ?? 'A test skill.'}`,
    '---',
    '',
    options.body ?? '# Test skill body',
    '',
  ].join('\n');
  writeFileSync(path.join(dir, 'SKILL.md'), fm);
  if (options.withAttachments) {
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(
      path.join(dir, 'assets', 'template.html'),
      '<html><body>seed</body></html>',
    );
  }
}

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
    expect(skill.body).toContain(`> **Skill root (absolute fallback):** \`${liveArtifactRoot}\``);
    expect(skill.body).toContain(`${SKILLS_CWD_ALIAS}/live-artifact/`);
    expect(skill.body).toContain('references/artifact-schema.md');
    expect(skill.body).toContain('references/connector-policy.md');
    expect(skill.body).toContain('references/refresh-contract.md');
    expect(skill.body).toContain('"$OD_NODE_BIN" "$OD_BIN" tools live-artifacts create --input artifact.json');
    expect(skill.body).toContain('do not ask “where should the data come from?” before checking daemon connector tools');
    expect(skill.body).toContain('notion.notion_search');
    expect(skill.body).toContain('`OD_DAEMON_URL`');
    expect(skill.body).toContain('`OD_TOOL_TOKEN`');
  });
});

describe('listSkills preamble', () => {
  it('emits both a cwd-relative skill root and an absolute fallback', async () => {
    const root = fresh();
    writeSkill(root, 'demo-skill', {
      withAttachments: true,
      body: 'Use `assets/template.html` to bootstrap.',
    });

    const skills = await listSkills(root);
    expect(skills).toHaveLength(1);
    const [skill] = skills;

    // The cwd-relative alias path is the primary one — that's what makes
    // the agent stay inside its working directory when reading skill
    // side files (issue #430).
    expect(skill.body).toContain(`${SKILLS_CWD_ALIAS}/demo-skill/`);
    expect(skill.body).toContain(
      `${SKILLS_CWD_ALIAS}/demo-skill/assets/template.html`,
    );

    // The absolute fallback is required for two cases the relative path
    // cannot serve:
    //   - calls without a project (cwd defaults to PROJECT_ROOT, where
    //     the absolute path is in fact an in-cwd path);
    //   - environments where `stageActiveSkill()` failed.
    // Claude/Copilot are additionally given `--add-dir` for that path.
    expect(skill.body).toContain(skill.dir);
    expect(skill.body).toMatch(/Skill root \(absolute fallback\)/);
    expect(skill.body).toMatch(/Skill root \(relative to project\)/);
  });

  it('uses the on-disk folder name in the alias path even when `name` differs', async () => {
    const root = fresh();
    writeSkill(root, 'guizang-ppt', {
      name: 'magazine-web-ppt',
      withAttachments: true,
    });

    const skills = await listSkills(root);
    expect(skills).toHaveLength(1);
    const [skill] = skills;

    // `id`/`name` reflect the frontmatter value (used elsewhere as a stable
    // public id), but the on-disk alias path must use the actual folder
    // name — that is what the daemon-staged junction maps to.
    expect(skill.id).toBe('magazine-web-ppt');
    expect(skill.body).toContain(`${SKILLS_CWD_ALIAS}/guizang-ppt/`);
    expect(skill.body).not.toContain(`${SKILLS_CWD_ALIAS}/magazine-web-ppt/`);
  });

  it('does not emit a preamble for skills without side files', async () => {
    const root = fresh();
    writeSkill(root, 'lone-skill', {
      withAttachments: false,
      body: 'Body without external files.',
    });

    const skills = await listSkills(root);
    expect(skills).toHaveLength(1);
    const [skill] = skills;

    expect(skill.body).not.toContain(SKILLS_CWD_ALIAS);
    expect(skill.body).not.toContain('Skill root');
    expect(skill.body).toContain('Body without external files.');
  });
});

describe('listSkills multi-root + source tagging', () => {
  it('tags entries from the first root as "user" and the second as "built-in"', async () => {
    const userRoot = fresh();
    const builtInRoot = fresh();
    writeSkill(userRoot, 'web-search', {
      description: 'User-imported web search.',
    });
    writeSkill(builtInRoot, 'audio-jingle', {
      description: 'Built-in jingle skill.',
    });

    const skills = await listSkills([userRoot, builtInRoot]);
    expect(skills).toHaveLength(2);
    const byId = new Map<string, { id: string; source: string }>(
      skills.map((s: { id: string; source: string }) => [s.id, s]),
    );
    expect(byId.get('web-search')?.source).toBe('user');
    expect(byId.get('audio-jingle')?.source).toBe('built-in');

    rmSync(userRoot, { recursive: true, force: true });
    rmSync(builtInRoot, { recursive: true, force: true });
  });

  it('lets a user skill shadow a built-in skill of the same id', async () => {
    const userRoot = fresh();
    const builtInRoot = fresh();
    writeSkill(userRoot, 'shared-id', {
      description: 'User override.',
      body: '# Override body',
    });
    writeSkill(builtInRoot, 'shared-id', {
      description: 'Original built-in.',
      body: '# Built-in body',
    });

    const skills = await listSkills([userRoot, builtInRoot]);
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe('user');
    expect(skills[0].body).toContain('Override body');

    rmSync(userRoot, { recursive: true, force: true });
    rmSync(builtInRoot, { recursive: true, force: true });
  });
});

describe('slugifySkillName', () => {
  it('lowercases, normalises spaces, and strips reserved slugs', () => {
    expect(slugifySkillName('Web Search')).toBe('web-search');
    expect(slugifySkillName('  Multi   Word  Skill ')).toBe('multi-word-skill');
    expect(slugifySkillName('   ')).toBe('');
    expect(slugifySkillName('..')).toBe('');
    expect(slugifySkillName('a/../b')).toBe('a-b');
  });
});

describe('importUserSkill / deleteUserSkill', () => {
  it('writes a SKILL.md and round-trips through listSkills', async () => {
    const root = fresh();
    try {
      const result = await importUserSkill(root, {
        name: 'Code Review',
        description: 'Review the latest diff.',
        body: '# Review\n\n1. Read.\n2. Comment.',
        triggers: ['code review', 'review my diff'],
      });
      expect(result.id).toBe('Code Review');
      expect(result.slug).toBe('code-review');
      expect(result.dir).toBe(path.join(root, 'code-review'));

      const skills = await listSkills(root);
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe('Code Review');
      expect(skills[0].triggers).toEqual(['code review', 'review my diff']);
      // First (and only) root is treated as the user root.
      expect(skills[0].source).toBe('user');

      // Importing the same name again surfaces a CONFLICT error.
      await expect(
        importUserSkill(root, {
          name: 'Code Review',
          body: '# Different body',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      await deleteUserSkill(root, 'Code Review');
      const after = await listSkills(root);
      expect(after).toHaveLength(0);

      // Deleting an already-deleted skill returns NOT_FOUND.
      await expect(deleteUserSkill(root, 'Code Review')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects empty bodies and impossibly-named skills', async () => {
    const root = fresh();
    try {
      await expect(
        importUserSkill(root, { name: 'foo', body: '   ' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        importUserSkill(root, { name: '..', body: '# body' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
