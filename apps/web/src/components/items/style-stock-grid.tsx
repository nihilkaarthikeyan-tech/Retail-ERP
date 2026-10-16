// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { Alert, SelectInput } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { StyleStockGridDto } from "@/lib/styles-seasons";
import { useLoad } from "@/lib/use-load";

/** Plan 11 C3: a style's stock as a size × colour grid, one per shop, with row and column totals. */
export function StyleStockGrid({ styleId }: { styleId: string }) {
  const { user } = useAuth();
  const [storeId, setStoreId] = useState("");
  const grid = useLoad(() => api.get<StyleStockGridDto>(`/stock/style-grid${query({ itemId: styleId, storeId })}`), [styleId, storeId]);
  const g = grid.data;
  const stores = user?.stores ?? [];

  return (
    <>
      <p className="muted">Stock on hand of every size and colour, in basic units. A dash means there is no such variant.</p>
      {stores.length > 1 ? (
        <div className="filter-row">
          <SelectInput id="grid-store" label="Shop" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">All my shops</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </div>
      ) : null}
      <Alert kind="error">{grid.error}</Alert>
      {!g ? <p className="muted">Loading…</p> : null}
      {g && g.stores.length === 0 ? <p className="muted">No shops to show.</p> : null}
      {g?.stores.map((s) => (
        <section key={s.store.id} aria-label={`Stock at ${s.store.name}`}>
          <h3>
            {s.store.name} <span className="muted">— {s.total} in stock</span>
          </h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{g.down.attributes.join(" / ") || g.style.name}</th>
                  {g.across.values.map((a) => (
                    <th key={a} scope="col" className="num">
                      {a}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.label ?? "all"}>
                    <th scope="row">{r.label ?? g.across.attributes[0]}</th>
                    {r.cells.map((c, n) => (
                      <td key={g.across.values[n]} className="num mono" title={c?.code}>
                        {c ? c.quantity : "—"}
                      </td>
                    ))}
                    <td className="num mono">
                      <strong>{r.total}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {s.columnTotals.map((t, n) => (
                    <td key={g.across.values[n]} className="num mono">
                      <strong>{t}</strong>
                    </td>
                  ))}
                  <td className="num mono">
                    <strong>{s.total}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
      {g && g.stores.length > 1 ? (
        <p>
          <strong>All shops: {g.total}</strong>
        </p>
      ) : null}
    </>
  );
}
