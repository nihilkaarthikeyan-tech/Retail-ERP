// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { hasPermission } from "shared";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
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

/** Plain words for actions that are not simple record changes. */
const ACTION_LABELS: Record<string, string> = {
  export: "Downloaded a report",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const FILTER_LABELS: Record<string, string> = { from: "From", to: "To", asOn: "As on", store: "Store", itemGroup: "Item group", brand: "Brand", showBy: "Shown by", rankBy: "Ranked by", show: "Showing", howMany: "How many", days: "Days" };

/** A report download (POST /reports/export-log): the report's name, its filters and how many rows. */
export function ExportDetails({ changes }: { changes: unknown }) {
  const c = (changes && typeof changes === "object" ? changes : {}) as { report?: unknown; filters?: unknown; rows?: unknown };
  const filters = c.filters && typeof c.filters === "object" ? Object.entries(c.filters as Record<string, unknown>).filter(([, v]) => v !== null && v !== "") : [];
  const show = (key: string, v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && /^(from|to|asOn|asOf)$/.test(key) ? formatDate(v) : String(v));
  return (
    <ul className="changes">
      <li>
        <strong>Report</strong>: {typeof c.report === "string" ? c.report : "—"}
      </li>
      {filters.map(([k, v]) => (
        <li key={k}>
          <strong>{FILTER_LABELS[k] ?? k}</strong>: {show(k, v)}
        </li>
      ))}
      {typeof c.rows === "number" ? (
        <li>
          <strong>Rows</strong>: {c.rows}
        </li>
      ) : null}
    </ul>
  );
}

interface AuditTableProps {
  /** "/audit" for changes, "/audit/logins" for logins. */
  path: "/audit" | "/audit/logins";
  /** Show the entity type filter and column (changes only). */
  withEntity: boolean;
  /** Fixed to one record (e.g. an item's own history tab); hides the record-type filter. */
  record?: { entityType: string; entityId: string };
}

export function AuditTable({ path, withEntity, record }: AuditTableProps) {
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
        `${path}${query({
          userId: applied.userId,
          entityType: record ? record.entityType : applied.entityType.trim(),
          entityId: record?.entityId,
          from: applied.from,
          to: applied.to,
          limit: 50,
          before,
        })}`,
      ),
    [path, applied, record],
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
    { key: "action", header: "Action", render: (r) => (r.action in ACTION_LABELS ? actionLabel(r.action) : <span className="mono">{r.action}</span>) },
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
    { key: "changes", header: withEntity ? "Changes" : "Details", render: (r) => (r.action === "export" ? <ExportDetails changes={r.changes} /> : <Changes changes={r.changes} />) },
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
          {withEntity && !record ? (
            <TextInput id="audit-entity" label="Record type" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} hint="For example user, store, role, company, number_series, or report for downloads." />
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
