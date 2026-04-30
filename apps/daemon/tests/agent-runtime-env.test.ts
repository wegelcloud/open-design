import { describe, expect, it } from 'vitest';

import { createAgentRuntimeEnv } from '../src/server.js';

describe('agent runtime tool environment', () => {
  it('injects daemon URL and run-scoped tool token into agent sessions', () => {
    const env = createAgentRuntimeEnv(
      { PATH: '/bin', OD_TOOL_TOKEN: 'stale-token' },
      'http://127.0.0.1:7456',
      { token: 'fresh-token' },
    );

    expect(env).toMatchObject({
      PATH: '/bin',
      OD_DAEMON_URL: 'http://127.0.0.1:7456',
      OD_TOOL_TOKEN: 'fresh-token',
    });
  });

  it('does not leak stale inherited tool tokens when no run token was minted', () => {
    const env = createAgentRuntimeEnv(
      { PATH: '/bin', OD_TOOL_TOKEN: 'stale-token' },
      'http://127.0.0.1:7456',
      null,
    );

    expect(env.OD_DAEMON_URL).toBe('http://127.0.0.1:7456');
    expect(env.OD_TOOL_TOKEN).toBeUndefined();
  });
});
