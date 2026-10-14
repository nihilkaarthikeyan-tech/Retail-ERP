// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { hasPermission } from "shared";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, fullName } from "@/lib/format";
import type { AuditPage, AuditRow, UserDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Renders the `changes` JSON: "field: old → new" rows, or "field: value" for plain facts. */
export function Changes({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== "object") return <span className="muted">—</span>;
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return <span className="muted">—</span>;
  return (
    <ul className="changes">
      {entries.map(([field, value]) => {
        const isDiff = value !== null && typeof value === "object" && "old" in value && "new" in value;
        return (
          <li key={field}>
            <strong>{field}</strong>:{" "}
            {isDiff ? (
              <>
                {show((value as { old: unknown }).old)} → {show((value as { new: unknown }).new)}
              </>
            ) : (
              show(value)
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface AuditTableProps {
  /** "/audit" for changes, "/audit/logins" for logins. */
  path: "/audit" | "/audit/logins";
  /** Show the entity type filter and column (changes only). */
  withEntity: boolean;
}

export function AuditTable({ path, withEntity }: AuditTableProps) {
  const { user: me } = useAuth();
  const canListUsers = hasPermission(me, "users.view");
  const users = useLoad<UserDto[]>(() => (canListUsers ? api.get<UserDto[]>("/users") : Promise.resolve([])), [canListUsers]);

  const [filters, setFilters] = useState({ userId: "", entityType: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (before: string | null) =>
      api.get<AuditPage>(
        `${path}${query({ userId: applied.userId, entityType: applied.entityType.trim(), from: applied.from, to: applied.to, limit: 50, before })}`,
      ),
    [path, applied],
  );

  // First page, again whenever the filters change.
  useEffect(() => {
    let cancelled = false;
    fetchPage(null).then(
      (page) => {
        if (cancelled) return;
        setRows(page.rows);
        setNextBefore(page.nextBefore);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore(before: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(before);
      setRows((r) => [...r, ...page.rows]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setRows([]);
    setLoading(true);
    setApplied(filters);
  }

  const columns: Column<AuditRow>[] = [
    { key: "at", header: "When", render: (r) => <span style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.at)}</span> },
    {
      key: "user",
      header: "Who",
      render: (r) => (r.user ? (r.user.email ? `${fullName(r.user)} (${r.user.email})` : r.user.id) : <span className="muted">system</span>),
    },
    { key: "action", header: "Action", render: (r) => <span className="mono">{r.action}</span> },
    ...(withEntity
      ? [
          {
            key: "entity",
            header: "Record",
            render: (r: AuditRow) => (
              <>
                <span className="mono">{r.entityType}</span>
                {r.entityId ? <span className="muted mono"> {r.entityId}</span> : null}
              </>
            ),
          } satisfies Column<AuditRow>,
        ]
      : []),
    { key: "changes", header: withEntity ? "Changes" : "Details", render: (r) => <Changes changes={r.changes} /> },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? <span className="muted">—</span> },
    { key: "ip", header: "Address", render: (r) => r.ipAddress ?? "—" },
  ];

  return (
    <>
      <form onSubmit={onSubmit} className="card" noValidate>
        <div className="form-grid">
          {canListUsers ? (
            <SelectInput id="audit-user" label="User" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}>
              <option value="">Anyone</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {fullName(u)} ({u.email})
                </option>
              ))}
            </SelectInput>
          ) : null}
          {withEntity ? (
            <TextInput id="audit-entity" label="Record type" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} hint="For example user, store, role, company, number_series." />
          ) : null}
          <TextInput id="audit-from" label="From" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <TextInput id="audit-to" label="To" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div className="actions">
          <Button type="submit" variant="primary">
            Apply filters
          </Button>
          <Button
            onClick={() => {
              const cleared = { userId: "", entityType: "", from: "", to: "" };
              setFilters(cleared);
              setRows([]);
              setLoading(true);
              setApplied(cleared);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
      <Alert kind="error">{error}</Alert>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={loading && rows.length === 0} empty="No entries match." />
      {nextBefore ? (
        <Button busy={loading} onClick={() => loadMore(nextBefore)}>
          Load more
        </Button>
      ) : null}
    </>
  );
}
