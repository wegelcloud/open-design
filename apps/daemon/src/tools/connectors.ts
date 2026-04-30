import type { ToolTokenGrant } from '../tool-tokens.js';

import { connectorService, ConnectorService, type ConnectorExecuteRequest } from '../connectors/service.js';

export interface ConnectorToolContext {
  grant: ToolTokenGrant;
  projectsRoot: string;
  service?: ConnectorService;
}

export function listConnectorTools(context: ConnectorToolContext): ReturnType<ConnectorService['listConnectors']> {
  const service = context.service ?? connectorService;
  return service.listDefinitions()
    .map((definition) => ({ definition, connector: service.getConnector(definition.id) }))
    .filter(({ connector }) => connector.status === 'connected')
    .map(({ definition, connector }) => ({
      ...connector,
      tools: connector.tools
        .filter((tool) => definition.allowedToolNames.includes(tool.name))
        .sort((left, right) => {
          const leftReadOnly = left.safety.sideEffect === 'read' && left.safety.approval === 'auto';
          const rightReadOnly = right.safety.sideEffect === 'read' && right.safety.approval === 'auto';
          if (leftReadOnly === rightReadOnly) return 0;
          return leftReadOnly ? -1 : 1;
        }),
    }))
    .filter((connector) => connector.tools.length > 0);
}

export async function executeConnectorTool(request: ConnectorExecuteRequest, context: ConnectorToolContext) {
  const service = context.service ?? connectorService;
  return await service.execute(request, {
    projectsRoot: context.projectsRoot,
    projectId: context.grant.projectId,
    runId: context.grant.runId,
    purpose: 'agent_preview',
  });
}
