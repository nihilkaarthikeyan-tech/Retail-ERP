// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type ReactNode, useState } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-align numbers. */
  align?: "left" | "right";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  caption?: ReactNode;
  /** Extra class for a row (e.g. to highlight expired or negative rows). */
  rowClassName?: (row: T) => string | undefined;
}

/** Audit 9: rows drawn at first; a shop with 50,000 items froze the browser drawing them all. */
export const ROWS_AT_A_TIME = 500;

/** "Showing 500 of 48,213 — Show 500 more", under a long table. */
export function MoreRows({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <p className="table-more muted" role="status">
      Showing {shown.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}.{" "}
      <button type="button" className="btn btn-small" onClick={onMore}>
        Show {Math.min(ROWS_AT_A_TIME, total - shown).toLocaleString("en-IN")} more
      </button>
    </p>
  );
}

/** A plain data table that scrolls sideways on narrow screens instead of the page. */
export function DataTable<T>({ columns, rows, rowKey, loading, empty = "Nothing to show.", caption, rowClassName }: DataTableProps<T>) {
  const [limit, setLimit] = useState(ROWS_AT_A_TIME);
  return (
    <>
    {/* Audit 9: while new figures load, the old ones are dimmed and marked as updating. */}
    <div className={loading && rows ? "table-wrap table-updating" : "table-wrap"} aria-busy={loading || undefined}>
      <table className="table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                Loading…
              </td>
            </tr>
          ) : !rows ? (
            // Nothing was loaded (the page shows why): not the same as an empty list.
            <tr>
              <td colSpan={columns.length} className="muted">
                Could not load this list.
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.slice(0, limit).map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    {rows ? <MoreRows shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit((l) => l + ROWS_AT_A_TIME)} /> : null}
    </>
  );
}

/** Small coloured label for on/off and similar states. */
export function Badge({ kind, children }: { kind: "ok" | "off" | "warn" | "neutral"; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge kind={active ? "ok" : "off"}>{active ? "Active" : "Switched off"}</Badge>;
}
