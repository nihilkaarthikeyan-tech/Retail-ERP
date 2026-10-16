// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { PrintButton } from "@/components/documents/print-button";
import { api } from "@/lib/api";
import { accountRights, dec, type PartyKind } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";
import type { StatementDto } from "./reports-tabs";

/** A customer's or supplier's balance from the ledger, with a link to their statement. */
export function PartyBalance({ partyType, partyId }: { partyType: PartyKind; partyId: string }) {
  const { user } = useAuth();
  const rights = accountRights(user);
  const allowed = rights.view || rights.payments;
  const statement = useLoad<StatementDto | null>(() => (allowed ? api.get<StatementDto>(`/reports/party-statement/${partyType}/${partyId}`) : Promise.resolve(null)), [allowed, partyType, partyId]);
  if (!allowed) return null;
  const closing = statement.data?.closing ?? null;
  const d = dec(closing);
  const words = d.isZero() ? "nothing owed either way" : partyType === "customer" ? (d.gt(0) ? "they owe us" : "we owe them (advance)") : d.gt(0) ? "we owe them" : "they owe us (advance)";
  return (
    <span className="toolbar" style={{ margin: 0 }} aria-label="Balance">
      <span>
        Balance: {statement.error ? <span className="muted">not available</span> : closing === null ? <span className="muted">…</span> : <strong>{rupees(d.abs().toFixed(2))}</strong>}
        {closing !== null ? <span className="muted"> ({words})</span> : null}
      </span>
      <Link href={`/accounts/reports?tab=statement&partyType=${partyType}&partyId=${partyId}`}>Statement</Link>
      <PrintButton kind="statement" id={`${partyType}:${partyId}`} label="Print statement" />
    </span>
  );
}
