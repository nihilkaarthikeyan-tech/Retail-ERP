// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { locationLabel, showQuantity } from "@/lib/stock";
import type { StockLookupResult } from "@/lib/types";

/** Quick stock lookup: scan or type a code, see the quantity in each location. */
export function StockLookup() {
  const id = useId();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<StockLookupResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const typed = code.trim();
    setNote(null);
    setResult(null);
    if (!typed) return;
    setBusy(true);
    try {
      setResult(await api.get<StockLookupResult>(`/stock/lookup/${encodeURIComponent(typed)}`));
    } catch (err) {
      setNote(err instanceof ApiError && err.statusCode === 404 ? `Nothing found for "${typed}".` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const withValue = result?.locations.some((l) => l.value !== undefined) ?? false;

  return (
    <div className="lookup-panel">
      <form onSubmit={submit} className="scan-box" role="search" aria-label="Quick stock lookup">
        <label htmlFor={id} className="sr-only">
          Quick stock lookup
        </label>
        <input id={id} className="input" type="search" value={code} placeholder="Scan a barcode or type an item code to see its stock" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" busy={busy}>
          Look up
        </Button>
      </form>
      {note ? (
        <p className="field-error" role="alert">
          {note}
        </p>
      ) : null}
      {result ? (
        <div className="card" aria-live="polite">
          <p>
            <span className="mono">{result.item.code}</span> — {result.item.name} <span className="muted">({result.item.unit})</span>
            {!result.usable && result.reason ? <span className="field-error"> {result.reason}</span> : null}
          </p>
          {result.locations.length === 0 ? (
            <p className="muted">No stock in any of your locations.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Location</th>
                  <th scope="col" className="num">
                    Quantity
                  </th>
                  {withValue ? (
                    <th scope="col" className="num">
                      Value
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {result.locations.map((l) => (
                  <tr key={l.location.id}>
                    <td>{locationLabel(l.location)}</td>
                    <td className="num">{showQuantity(l.quantity)}</td>
                    {withValue ? <td className="num">{l.value ?? "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
