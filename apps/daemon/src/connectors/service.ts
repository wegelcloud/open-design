import type { BoundedJsonObject } from '../live-artifacts/schema.js';

import {
  connectorDefinitionToDetail,
  getConnectorCatalogDefinition,
  listConnectorCatalogDefinitions,
  type ConnectorDetail,
  type ConnectorCatalogDefinition,
  type ConnectorStatus,
} from './catalog.js';

export interface ConnectorExecuteRequest {
  connectorId: string;
  toolName: string;
  input: BoundedJsonObject;
}

export interface ConnectorExecuteResponse {
  connectorId: string;
  toolName: string;
  output: BoundedJsonObject;
}

export type ConnectorServiceErrorCode =
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_TOOL_NOT_FOUND'
  | 'CONNECTOR_SAFETY_DENIED'
  | 'CONNECTOR_EXECUTION_FAILED';

export class ConnectorServiceError extends Error {
  constructor(
    readonly code: ConnectorServiceErrorCode,
    message: string,
    readonly status: number,
    readonly details?: BoundedJsonObject,
  ) {
    super(message);
    this.name = 'ConnectorServiceError';
  }
}

export interface ConnectorConnectionStatus {
  status: ConnectorStatus;
  accountLabel?: string;
  lastError?: string;
}

export interface ConnectorExecutionContext {
  projectId: string;
  runId?: string;
  purpose?: 'agent_preview' | 'artifact_refresh';
}

export class ConnectorService {
  listDefinitions(): ConnectorCatalogDefinition[] {
    return listConnectorCatalogDefinitions();
  }

  getDefinition(connectorId: string): ConnectorCatalogDefinition | undefined {
    return getConnectorCatalogDefinition(connectorId);
  }

  getStatus(definition: ConnectorCatalogDefinition): ConnectorConnectionStatus {
    return { status: definition.disabled ? 'disabled' : 'available' };
  }

  listConnectors(): ConnectorDetail[] {
    return this.listDefinitions().map((definition) => this.toDetail(definition));
  }

  getConnector(connectorId: string): ConnectorDetail {
    const definition = this.getDefinition(connectorId);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async connect(connectorId: string): Promise<ConnectorDetail> {
    const connector = this.getConnector(connectorId);
    if (connector.status === 'disabled') {
      throw new ConnectorServiceError('CONNECTOR_DISABLED', 'connector is disabled', 403);
    }
    return connector;
  }

  async disconnect(connectorId: string): Promise<ConnectorDetail> {
    return this.getConnector(connectorId);
  }

  async execute(request: ConnectorExecuteRequest, _context: ConnectorExecutionContext): Promise<ConnectorExecuteResponse> {
    const connector = this.getConnector(request.connectorId);
    const tool = connector.tools.find((candidate) => candidate.name === request.toolName);
    if (!tool) {
      throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', 'connector tool not found', 404);
    }
    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'connector execution is not implemented', 501);
  }

  private toDetail(definition: ConnectorCatalogDefinition): ConnectorDetail {
    const detail = connectorDefinitionToDetail(definition);
    const status = this.getStatus(definition);
    return {
      ...detail,
      status: status.status,
      ...(status.accountLabel === undefined ? {} : { accountLabel: status.accountLabel }),
      ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
    };
  }
}

export const connectorService = new ConnectorService();
