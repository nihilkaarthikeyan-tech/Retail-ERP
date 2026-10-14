// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useState } from "react";
import type { HealthStatus } from "shared";
import { API_URL, fetchHealth } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; health: HealthStatus }
  | { kind: "unreachable"; message: string };

/** Shows whether the browser can reach the API, and the API the database. */
export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    fetchHealth()
      .then((health) => setState({ kind: "loaded", health }))
      .catch((err: unknown) =>
        setState({
          kind: "unreachable",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  if (state.kind === "loading") return <p>Checking system status…</p>;

  if (state.kind === "unreachable") {
    return (
      <dl className="status">
        <dt>API ({API_URL})</dt>
        <dd className="error">Not reachable: {state.message}</dd>
      </dl>
    );
  }

  const { api, database } = state.health;
  return (
    <dl className="status">
      <dt>API ({API_URL})</dt>
      <dd className="ok">Connected (version {api.version})</dd>
      <dt>Database</dt>
      {database.connected ? (
        <dd className="ok">
          Connected (PostgreSQL {database.serverVersion}, server time{" "}
          {database.serverTime})
        </dd>
      ) : (
        <dd className="error">Not connected: {database.error}</dd>
      )}
    </dl>
  );
}
