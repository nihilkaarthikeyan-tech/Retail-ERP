// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { accountName, accountRights, type DefaultAccountRow, postable } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { useLoad } from "@/lib/use-load";
import { AccountOptions, useChart } from "./accounts-shared";

/** Which account each kind of money from the other modules posts to (GET/PUT /accounting/defaults). */
export function DefaultAccounts() {
  const { user } = useAuth();
  const canManage = accountRights(user).manage;
  const rows = useLoad(() => api.get<DefaultAccountRow[]>("/accounting/defaults"));
  const chart = useChart();
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const accounts = postable(chart.data?.accounts ?? []);
  const changed = Object.entries(changes).filter(([role, id]) => id && id !== rows.data?.find((r) => r.role === role)?.account?.id);

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const next = await api.put<DefaultAccountRow[]>("/accounting/defaults", { defaults: changed.map(([role, accountId]) => ({ role, accountId })) });
      rows.setData(next);
      setChanges({});
      setNotice("Default accounts saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Default accounts</h1>
      <p className="muted">
        Bills, stock movements and till shifts post to these accounts automatically. Change one only when your accountant asks. Each store&apos;s own cash in till and cash in hand accounts are set up with the store.
      </p>
      <Alert kind="error">{rows.error ?? chart.error ?? error}</Alert>
      <Alert kind="success">{notice}</Alert>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Money from</th>
              <th scope="col">Posts to</th>
            </tr>
          </thead>
          <tbody>
            {!rows.data ? (
              <tr>
                <td colSpan={2} className="muted">
                  Loading…
                </td>
              </tr>
            ) : (
              rows.data.map((r) => (
                <tr key={r.role}>
                  <td>{r.label}</td>
                  <td>
                    {canManage ? (
                      <select className="input" aria-label={`Account for ${r.label}`} value={changes[r.role] ?? r.account?.id ?? ""} onChange={(e) => setChanges((c) => ({ ...c, [r.role]: e.target.value }))}>
                        <AccountOptions accounts={accounts} placeholder="Not set" />
                      </select>
                    ) : (
                      accountName(r.account)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {canManage ? (
        <div className="actions">
          <Button variant="primary" busy={busy} disabled={changed.length === 0} onClick={save}>
            Save {changed.length > 0 ? `${changed.length} change${changed.length === 1 ? "" : "s"}` : "changes"}
          </Button>
          <Button disabled={busy || Object.keys(changes).length === 0} onClick={() => setChanges({})}>
            Undo changes
          </Button>
        </div>
      ) : null}
    </>
  );
}
