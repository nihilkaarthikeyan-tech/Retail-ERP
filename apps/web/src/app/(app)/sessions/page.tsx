// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { Alert, Button, DataTable, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { SessionDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function SessionsPage() {
  const sessions = useLoad(() => api.get<SessionDto[]>("/auth/sessions"));
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);

  async function end(id: string) {
    setError(null);
    setEnding(id);
    try {
      await api.delete(`/auth/sessions/${id}`);
      await sessions.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEnding(null);
    }
  }

  const columns: Column<SessionDto>[] = [
    { key: "created", header: "Started", render: (s) => formatDateTime(s.createdAt) },
    { key: "active", header: "Last active", render: (s) => formatDateTime(s.lastActiveAt) },
    { key: "expires", header: "Expires", render: (s) => formatDateTime(s.expiresAt) },
    { key: "ip", header: "Address", render: (s) => s.ipAddress ?? "—" },
    { key: "ua", header: "Browser", render: (s) => <span className="muted">{s.userAgent ?? "—"}</span> },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <Button size="small" variant="danger" busy={ending === s.id} onClick={() => end(s.id)}>
          End
        </Button>
      ),
    },
  ];

  return (
    <>
      <h1>My sessions</h1>
      <p className="muted">Every browser you are logged in from. Ending the current session logs you out.</p>
      <Alert kind="error">{error ?? sessions.error}</Alert>
      <DataTable columns={columns} rows={sessions.data} rowKey={(s) => s.id} loading={sessions.loading} empty="No live sessions." />
    </>
  );
}
