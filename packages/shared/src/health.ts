// Copyright (c) 2026, Rademics. All rights reserved.

/** Response of GET /health on the API. */
export interface HealthStatus {
  status: 'ok' | 'error';
  api: {
    version: string;
    time: string;
  };
  /** Only whether it is up: the details are not for anyone who asks (code audit, 27 October 2026). */
  database: {
    connected: boolean;
  };
}

/** Overall status is "ok" only when every part is healthy. */
export function overallStatus(databaseConnected: boolean): HealthStatus['status'] {
  return databaseConnected ? 'ok' : 'error';
}
