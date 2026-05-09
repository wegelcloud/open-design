// @ts-nocheck
export function buildLiveArtifactsMcpServersForAgent(def, { enabled = true, command = 'od', argsPrefix = [] } = {}) {
  if (!enabled || def?.mcpDiscovery !== 'mature-acp') return [];
  return [
    {
      name: 'open-design-live-artifacts',
      command,
      args: [...argsPrefix, 'mcp', 'live-artifacts'],
      env: [],
    },
  ];
}
