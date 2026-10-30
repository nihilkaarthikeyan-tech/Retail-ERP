// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { hasPermission } from "shared";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { actionName, addressName, fieldName, reasonName, RECORD_NAMES, recordName } from "@/lib/audit-labels";
import type { AuditPage, AuditRow, RoleDto, StoreDto, UserDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names of the users and stores this person may see, to show instead of record numbers. */
type Names = ReadonlyMap<string, string>;

function show(value: unknown, names?: Names): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    if (names?.has(value)) return names.get(value)!;
    if (UUID.test(value)) return "(a record)";
    // Audit 6: stored dates and times shown the Indian way (a date at midnight UTC is a calendar date).
    // Audit 9: the patterns had lost their backslashes (\d), so no date ever matched.
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(value)) return formatDate(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return formatDateTime(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
    // A stored status or kind such as "to_receive_and_bill" reads as words.
    if (/^[a-z]+(_[a-z0-9]+)+$/.test(value)) return value.replace(/_/g, " ");
    return value;
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.length ? value.map((v) => show(v, names)).join(", ") : "none";
  // Audit 9: lists and groups of details in words, not as code.
  if (Array.isArray(value)) return value.length === 1 ? "1 line" : `${value.length} lines`;
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
      .map(([k, v]) => `${k} ${show(v, names)}`);
    return parts.length ? parts.join(", ") : "details";
  }
  return String(value);
}

/** Renders the `changes` JSON: "field: old → new" rows, or "field: value" for plain facts. */
export function Changes({ changes, names }: { changes: unknown; names?: Names }) {
  if (!changes || typeof changes !== "object") return <span className="muted">—</span>;
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return <span className="muted">—</span>;
  return (
    <ul className="changes">
      {entries.map(([field, value]) => {
        const isDiff = value !== null && typeof value === "object" && "old" in value && "new" in value;
        return (
          <li key={field}>
            <strong>{fieldName(field)}</strong>:{" "}
            {isDiff ? (
              <>
                {show((value as { old: unknown }).old, names)} → {show((value as { new: unknown }).new, names)}
              </>
            ) : field === "reason" && typeof value === "string" ? (
              reasonName(value)
            ) : (
              show(value, names)
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const actionLabel = actionName;

const FILTER_LABELS: Record<string, string> = { from: "From", to: "To", asOn: "As on", store: "Store", itemGroup: "Item group", brand: "Brand", showBy: "Shown by", rankBy: "Ranked by", show: "Showing", howMany: "How many", days: "Days" };

/** A report download (POST /reports/export-log): the report's name, its filters and how many rows. */
export function ExportDetails({ changes }: { changes: unknown }) {
  const c = (changes && typeof changes === "object" ? changes : {}) as { report?: unknown; filters?: unknown; rows?: unknown; format?: unknown };
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
      {c.format === "xlsx" || c.format === "csv" ? (
        <li>
          <strong>File</strong>: {c.format === "xlsx" ? "Excel" : "CSV"}
        </li>
      ) : null}
    </ul>
  );
}

/** A print (module 10): the document's title and number, how it was marked, or the labels printed. */
export function PrintDetails({ changes }: { changes: unknown }) {
  const c = (changes && typeof changes === "object" ? changes : {}) as { title?: unknown; number?: unknown; mark?: unknown; template?: unknown; labels?: unknown };
  if (typeof c.labels === "number") {
    return (
      <ul className="changes">
        <li>
          <strong>Labels</strong>: {c.labels}
        </li>
        {typeof c.template === "string" ? (
          <li>
            <strong>Template</strong>: {c.template}
          </li>
        ) : null}
      </ul>
    );
  }
  const title = [typeof c.title === "string" ? c.title : null, typeof c.number === "string" ? c.number : null].filter(Boolean).join(" ");
  return (
    <ul className="changes">
      <li>
        <strong>Document</strong>: {title || "—"}
      </li>
      {c.mark === "DRAFT" || c.mark === "CANCELLED" ? (
        <li>
          <strong>Marked</strong>: {c.mark}
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
  const canListStores = hasPermission(me, "stores.view");
  const stores = useLoad<StoreDto[]>(() => (canListStores ? api.get<StoreDto[]>("/stores") : Promise.resolve([])), [canListStores]);
  const canListRoles = hasPermission(me, "roles.manage");
  const roles = useLoad<RoleDto[]>(() => (canListRoles ? api.get<RoleDto[]>("/roles") : Promise.resolve([])), [canListRoles]);
  // Record numbers become names; role codes (kept in the history) become role names.
  const names: Names = new Map([
    ...(users.data ?? []).map((u) => [u.id, fullName(u)] as const),
    ...(stores.data ?? []).map((st) => [st.id, st.code] as const),
    ...(roles.data ?? []).flatMap((r) => [[r.id, r.name] as const, [r.code, r.name] as const]),
  ]);

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
    { key: "action", header: "What", render: (r) => actionName(r.action) },
    ...(withEntity
      ? [
          {
            key: "entity",
            header: "Record",
            render: (r: AuditRow) => (
              <>
                {recordName(r.entityType)}
                {r.entityId && names.get(r.entityId) ? <strong> {names.get(r.entityId)}</strong> : null}
              </>
            ),
          } satisfies Column<AuditRow>,
        ]
      : []),
    {
      key: "changes",
      header: withEntity ? "Changes" : "Details",
      render: (r) =>
        r.action === "export" ? (
          <ExportDetails changes={r.changes} />
        ) : r.action === "print" ? (
          <PrintDetails changes={r.changes} />
        ) : (
          <>
            {/* Login history has no record column: say whose password or sessions it was. */}
            {!withEntity && r.entityType === "user" && r.entityId && r.entityId !== r.user?.id ? <p className="muted">For {names.get(r.entityId) ?? "another user"}</p> : null}
            <Changes changes={r.changes} names={names} />
          </>
        ),
    },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? <span className="muted">—</span> },
    { key: "ip", header: "From", render: (r) => addressName(r.ipAddress) },
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
            <SelectInput id="audit-entity" label="Kind of record" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
              <option value="">Any</option>
              {Object.entries(RECORD_NAMES)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([type, name]) => (
                  <option key={type} value={type}>
                    {name}
                  </option>
                ))}
            </SelectInput>
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
