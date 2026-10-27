// Copyright (c) 2026, Rademics. All rights reserved.
import type { ReactNode } from "react";

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

/** A plain data table that scrolls sideways on narrow screens instead of the page. */
export function DataTable<T>({ columns, rows, rowKey, loading, empty = "Nothing to show.", caption, rowClassName }: DataTableProps<T>) {
  return (
    <div className="table-wrap">
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
            rows.map((row) => (
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
  );
}

/** Small coloured label for on/off and similar states. */
export function Badge({ kind, children }: { kind: "ok" | "off" | "warn" | "neutral"; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge kind={active ? "ok" : "off"}>{active ? "Active" : "Switched off"}</Badge>;
}
