import type { Express, Request, Response } from 'express';

import { connectorService, ConnectorService, ConnectorServiceError } from './service.js';

type ConnectorApiErrorCode =
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_TOOL_NOT_FOUND'
  | 'CONNECTOR_SAFETY_DENIED'
  | 'CONNECTOR_EXECUTION_FAILED';

export type ConnectorApiErrorSender = (
  res: Response,
  status: number,
  code: ConnectorApiErrorCode,
  message: string,
  init?: { details?: unknown; retryable?: boolean; requestId?: string; taskId?: string },
) => Response;

export interface RegisterConnectorRoutesOptions {
  service?: ConnectorService;
  sendApiError: ConnectorApiErrorSender;
}

function sendConnectorRouteError(res: Response, err: unknown, sendApiError: ConnectorApiErrorSender): Response {
  if (err instanceof ConnectorServiceError) {
    return sendApiError(res, err.status, err.code, err.message, err.details === undefined ? {} : { details: err.details });
  }
  return sendApiError(res, 500, 'CONNECTOR_EXECUTION_FAILED', err instanceof Error ? err.message : String(err));
}

export function registerConnectorRoutes(app: Express, options: RegisterConnectorRoutesOptions): void {
  const service = options.service ?? connectorService;

  app.get('/api/connectors', (_req: Request, res: Response) => {
    try {
      res.json({ connectors: service.listConnectors() });
    } catch (err) {
      sendConnectorRouteError(res, err, options.sendApiError);
    }
  });

  app.get('/api/connectors/:connectorId', (req: Request, res: Response) => {
    try {
      const connectorId = req.params.connectorId;
      if (!connectorId) return options.sendApiError(res, 400, 'CONNECTOR_NOT_FOUND', 'connectorId is required');
      res.json({ connector: service.getConnector(connectorId) });
    } catch (err) {
      sendConnectorRouteError(res, err, options.sendApiError);
    }
  });

  app.post('/api/connectors/:connectorId/connect', async (req: Request, res: Response) => {
    try {
      const connectorId = req.params.connectorId;
      if (!connectorId) return options.sendApiError(res, 400, 'CONNECTOR_NOT_FOUND', 'connectorId is required');
      res.json({ connector: await service.connect(connectorId) });
    } catch (err) {
      sendConnectorRouteError(res, err, options.sendApiError);
    }
  });

  app.delete('/api/connectors/:connectorId/connection', async (req: Request, res: Response) => {
    try {
      const connectorId = req.params.connectorId;
      if (!connectorId) return options.sendApiError(res, 400, 'CONNECTOR_NOT_FOUND', 'connectorId is required');
      res.json({ connector: await service.disconnect(connectorId) });
    } catch (err) {
      sendConnectorRouteError(res, err, options.sendApiError);
    }
  });
}
