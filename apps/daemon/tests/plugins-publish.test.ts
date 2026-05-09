// Phase 4 / spec §14.1 — `od plugin publish` URL builder unit test.
//
// The PR-template launcher is purely string assembly; we lock the
// public contract here so a future spec patch that retargets a
// catalog (e.g. anthropics/skills moves to a /pulls path or grows a
// dedicated submission form) updates this fixture in the same PR.

import { describe, expect, it } from 'vitest';
import {
  buildPublishLink,
  PublishError,
  PUBLISH_TARGETS,
} from '../src/plugins/publish.js';

const META = {
  pluginId:          'sample-plugin',
  pluginVersion:     '1.0.0',
  pluginTitle:       'Sample Plugin',
  pluginDescription: 'A fixture for the publish flow.',
  repoUrl:           'https://github.com/open-design/sample-plugin',
};

describe('buildPublishLink', () => {
  it('exports the four canonical catalog targets', () => {
    expect(PUBLISH_TARGETS.sort()).toEqual([
      'anthropics-skills',
      'awesome-agent-skills',
      'clawhub',
      'skills-sh',
    ].sort());
  });

  it('builds a github-issue URL for anthropics/skills with title + body', () => {
    const link = buildPublishLink({ catalog: 'anthropics-skills', meta: META });
    expect(link.catalog).toBe('anthropics-skills');
    expect(link.catalogLabel).toBe('anthropics/skills');
    expect(link.url).toMatch(/^https:\/\/github\.com\/anthropics\/skills\/issues\/new\?/);
    const params = new URLSearchParams(link.url.split('?')[1]);
    expect(params.get('title')).toBe('Add Sample Plugin');
    expect(params.get('body')).toContain('A fixture for the publish flow.');
    expect(link.prBody).toContain('https://github.com/open-design/sample-plugin');
  });

  it('builds a github-issue URL for awesome-agent-skills', () => {
    const link = buildPublishLink({ catalog: 'awesome-agent-skills', meta: META });
    expect(link.url).toMatch(/^https:\/\/github\.com\/VoltAgent\/awesome-agent-skills\/issues\/new\?/);
  });

  it('builds a github-issue URL for clawhub', () => {
    const link = buildPublishLink({ catalog: 'clawhub', meta: META });
    expect(link.url).toMatch(/^https:\/\/github\.com\/openclaw\/clawhub\/issues\/new\?/);
  });

  it('points at skills.sh + the npx skills add command (no PR form there)', () => {
    const link = buildPublishLink({ catalog: 'skills-sh', meta: META });
    expect(link.url).toBe('https://skills.sh/');
    expect(link.prBody).toContain('npx skills add open-design/sample-plugin');
  });

  it('falls back to owner/repo placeholder when repoUrl is missing for skills-sh', () => {
    const link = buildPublishLink({
      catalog: 'skills-sh',
      meta: { pluginId: 'sample-plugin', pluginVersion: '1.0.0' },
    });
    expect(link.prBody).toContain('npx skills add owner/repo');
  });

  it('rejects unknown catalogs', () => {
    expect(() => buildPublishLink({ catalog: 'mystery' as never, meta: META })).toThrow(PublishError);
  });
});
