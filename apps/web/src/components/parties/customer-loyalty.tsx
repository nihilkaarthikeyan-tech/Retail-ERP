// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 §1 on the customer page: the customer's points (balance and its
// worth), tier, spend in the last 12 months, points expiring in the next 30
// days and the history. Hidden while the Loyalty points module is off.
"use client";

import Link from "next/link";
import type { CustomerLoyaltyDto } from "shared";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { POINT_KIND_LABELS } from "@/lib/loyalty";
import { useModules } from "@/lib/modules";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

export function CustomerLoyalty({ customerId }: { customerId: string }) {
  const { isOn } = useModules();
  if (!isOn("loyalty")) return null;
  return <CustomerLoyaltyPanel customerId={customerId} />;
}

function CustomerLoyaltyPanel({ customerId }: { customerId: string }) {
  const p = useLoad(() => api.get<CustomerLoyaltyDto>(`/loyalty/customers/${customerId}`), [customerId]);
  const d = p.data;
  return (
    <section aria-label="Loyalty points">
      <Alert kind="error">{p.error}</Alert>
      {!d ? (
        p.loading ? <p className="muted">Loading…</p> : null
      ) : (
        <>
          {!d.member ? <p className="muted">{d.reason ?? "Not in the loyalty scheme."}</p> : null}
          <div className="card">
            <p>
              Balance: <strong>{d.balance} points</strong> (worth {rupees(d.balanceValue)})
              {d.available !== d.balance ? <span className="muted"> · {d.available} can be spent today</span> : null}
            </p>
            {d.tier ? (
              <p>
                Tier: <strong>{d.tier.name}</strong> — {rupees(d.tier.earnSpend)} earns {d.tier.earnPoints} {d.tier.earnPoints === 1 ? "point" : "points"}
              </p>
            ) : null}
            <p>Spent in the last 12 months: {rupees(d.yearSpend)}</p>
            {d.expiringSoon.length ? (
              <p data-testid="expiring-soon">
                Expiring in the next 30 days: {d.expiringSoon.map((e) => `${e.points} on ${formatDate(e.expiresOn)}`).join(", ")}
              </p>
            ) : (
              <p className="muted">No points expire in the next 30 days.</p>
            )}
          </div>
          <h2>Points history</h2>
          <table className="table" aria-label="Points history">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Bill</th>
                <th className="num">Points</th>
                <th className="num">Worth</th>
                <th>Expires on</th>
              </tr>
            </thead>
            <tbody>
              {(d.history ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.entryDate)}</td>
                  <td>{POINT_KIND_LABELS[e.kind] ?? e.kind}</td>
                  <td>{e.billId && e.billNumber ? <Link href={`/pos/bills/${e.billId}`}>{e.billNumber}</Link> : "—"}</td>
                  <td className="num">{e.points > 0 ? `+${e.points}` : e.points}</td>
                  <td className="num">{rupees(e.value)}</td>
                  <td>{e.kind === "earn" && e.expiresOn ? formatDate(e.expiresOn) : ""}</td>
                </tr>
              ))}
              {d.history && !d.history.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No points yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
