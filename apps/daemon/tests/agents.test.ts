// @ts-nocheck
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { AGENT_DEFS, buildLiveArtifactsMcpServersForAgent } from '../src/agents.js';

const codex = AGENT_DEFS.find((agent) => agent.id === 'codex');
const hermes = AGENT_DEFS.find((agent) => agent.id === 'hermes');
const kimi = AGENT_DEFS.find((agent) => agent.id === 'kimi');
const originalDisablePlugins = process.env.OD_CODEX_DISABLE_PLUGINS;

afterEach(() => {
  if (originalDisablePlugins == null) {
    delete process.env.OD_CODEX_DISABLE_PLUGINS;
  } else {
    process.env.OD_CODEX_DISABLE_PLUGINS = originalDisablePlugins;
  }
});

test('codex args disable plugins when OD_CODEX_DISABLE_PLUGINS is 1', () => {
  process.env.OD_CODEX_DISABLE_PLUGINS = '1';

  const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/od-project' });

  assert.deepEqual(args.slice(0, 6), [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '--disable',
    'plugins',
  ]);
  assert.equal(args.at(-1), '-');
});

test('codex args keep plugins enabled when OD_CODEX_DISABLE_PLUGINS is unset', () => {
  delete process.env.OD_CODEX_DISABLE_PLUGINS;

  const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/od-project' });

  assert.equal(args.includes('--disable'), false);
  assert.equal(args.includes('plugins'), false);
  assert.equal(args.at(-1), '-');
});

test('codex args keep plugins enabled when OD_CODEX_DISABLE_PLUGINS is not 1', () => {
  process.env.OD_CODEX_DISABLE_PLUGINS = 'true';

  const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/od-project' });

  assert.equal(args.includes('--disable'), false);
  assert.equal(args.includes('plugins'), false);
  assert.equal(args.at(-1), '-');
});

test('live artifact MCP discovery is limited to mature ACP agents', () => {
  assert.deepEqual(buildLiveArtifactsMcpServersForAgent(hermes), [
    {
      name: 'open-design-live-artifacts',
      command: 'od',
      args: ['mcp', 'live-artifacts'],
    },
  ]);
  assert.deepEqual(buildLiveArtifactsMcpServersForAgent(kimi), [
    {
      name: 'open-design-live-artifacts',
      command: 'od',
      args: ['mcp', 'live-artifacts'],
    },
  ]);

  for (const agent of AGENT_DEFS) {
    if (agent.id === 'hermes' || agent.id === 'kimi') continue;
    assert.deepEqual(buildLiveArtifactsMcpServersForAgent(agent), []);
  }
});

test('live artifact MCP discovery is disabled when run-scoped tool auth is unavailable', () => {
  assert.deepEqual(buildLiveArtifactsMcpServersForAgent(hermes, { enabled: false }), []);
});
