// Copyright (c) 2026, Rademics. All rights reserved.

/** Response of GET /health on the API. */
export interface HealthStatus {
  status: 'ok' | 'error';
  api: {
    version: string;
    time: string;
  };
  database: {
    connected: boolean;
    serverVersion?: string;
    serverTime?: string;
    error?: string;
  };
}

/** Overall status is "ok" only when every part is healthy. */
export function overallStatus(databaseConnected: boolean): HealthStatus['status'] {
  return databaseConnected ? 'ok' : 'error';
}
