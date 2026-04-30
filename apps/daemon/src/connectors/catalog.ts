import type { BoundedJsonObject } from '../live-artifacts/schema.js';

export type ConnectorStatus = 'available' | 'connected' | 'error' | 'disabled';
export type ConnectorToolSideEffect = 'read' | 'write' | 'destructive' | 'unknown';
export type ConnectorToolApproval = 'auto' | 'confirm' | 'disabled';

export interface ConnectorToolSafety {
  sideEffect: ConnectorToolSideEffect;
  approval: ConnectorToolApproval;
  reason: string;
}

export interface ConnectorToolDetail {
  name: string;
  title: string;
  description?: string;
  inputSchemaJson?: BoundedJsonObject;
  outputSchemaJson?: BoundedJsonObject;
  safety: ConnectorToolSafety;
  refreshEligible: boolean;
}

export interface ConnectorDetail {
  id: string;
  name: string;
  provider: string;
  category: string;
  description?: string;
  status: ConnectorStatus;
  accountLabel?: string;
  tools: ConnectorToolDetail[];
  featuredToolNames?: string[];
  minimumApproval?: ConnectorToolApproval;
  lastError?: string;
}

export interface ConnectorCatalogDefinition {
  id: string;
  name: string;
  provider: string;
  category: string;
  description?: string;
  tools: ConnectorToolDetail[];
  featuredToolNames?: string[];
  minimumApproval?: ConnectorToolApproval;
  disabled?: boolean;
}

export const CONNECTOR_CATALOG: readonly ConnectorCatalogDefinition[] = [];

export function listConnectorCatalogDefinitions(): ConnectorCatalogDefinition[] {
  return CONNECTOR_CATALOG.map((definition) => ({ ...definition, tools: definition.tools.map((tool) => ({ ...tool })) }));
}

export function getConnectorCatalogDefinition(connectorId: string): ConnectorCatalogDefinition | undefined {
  const definition = CONNECTOR_CATALOG.find((connector) => connector.id === connectorId);
  if (!definition) return undefined;
  return { ...definition, tools: definition.tools.map((tool) => ({ ...tool })) };
}

export function connectorDefinitionToDetail(definition: ConnectorCatalogDefinition): ConnectorDetail {
  return {
    id: definition.id,
    name: definition.name,
    provider: definition.provider,
    category: definition.category,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    status: definition.disabled ? 'disabled' : 'available',
    tools: definition.tools.map((tool) => ({ ...tool })),
    ...(definition.featuredToolNames === undefined ? {} : { featuredToolNames: [...definition.featuredToolNames] }),
    ...(definition.minimumApproval === undefined ? {} : { minimumApproval: definition.minimumApproval }),
  };
}
