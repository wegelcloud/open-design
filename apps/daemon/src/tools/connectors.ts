import type { ToolTokenGrant } from '../tool-tokens.js';

import { connectorService, ConnectorService, type ConnectorExecuteRequest } from '../connectors/service.js';

export interface ConnectorToolContext {
  grant: ToolTokenGrant;
  service?: ConnectorService;
}

export function listConnectorTools(context: ConnectorToolContext): ReturnType<ConnectorService['listConnectors']> {
  const service = context.service ?? connectorService;
  return service.listConnectors();
}

export async function executeConnectorTool(request: ConnectorExecuteRequest, context: ConnectorToolContext) {
  const service = context.service ?? connectorService;
  return await service.execute(request, {
    projectId: context.grant.projectId,
    runId: context.grant.runId,
    purpose: 'agent_preview',
  });
}
