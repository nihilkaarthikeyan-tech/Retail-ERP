// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { Alert, Badge, Button, Dialog } from "@/components/ui";
import { api, query } from "@/lib/api";
import { accountRights, type LedgerEntryDto, sum } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

export type LedgerDocumentType = "supplier_bill" | "goods_receipt" | "stock_document" | "landed_charge" | "pos_shift" | "journal" | "payment" | "opening_bill" | "year_end_closing";

/** The debit and credit lines of one ledger entry. */
export function EntryLinesTable({ entry }: { entry: LedgerEntryDto }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Customer / supplier</th>
            <th scope="col">Store</th>
            <th scope="col" className="num">
              Debit
            </th>
            <th scope="col" className="num">
              Credit
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.account}
                {l.remark ? <div className="muted">{l.remark}</div> : null}
              </td>
              <td>{l.party ?? "—"}</td>
              <td className="mono">{l.store ?? "—"}</td>
              <td className="num">{l.debit === "0.00" ? "" : rupees(l.debit)}</td>
              <td className="num">{l.credit === "0.00" ? "" : rupees(l.credit)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3}>
              <strong>Total</strong>
            </td>
            <td className="num">
              <strong>{rupees(sum(entry.lines.map((l) => l.debit)).toFixed(2))}</strong>
            </td>
            <td className="num">
              <strong>{rupees(sum(entry.lines.map((l) => l.credit)).toFixed(2))}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Every ledger entry of a document, oldest first (a cancelled document shows its reversing entry too). */
export function LedgerEntries({ documentType, documentId }: { documentType: LedgerDocumentType; documentId: string }) {
  const entries = useLoad(() => api.get<LedgerEntryDto[]>(`/ledger/entries${query({ documentType, documentId })}`), [documentType, documentId]);
  if (entries.error) return <Alert kind="error">{entries.error}</Alert>;
  if (!entries.data) return <p className="muted">Loading…</p>;
  if (entries.data.length === 0) return <p className="muted">Nothing has been posted to the accounts for this yet.</p>;
  return (
    <>
      {entries.data.map((e) => (
        <section key={e.id} aria-label={`Ledger entry of ${formatDate(e.date)}`}>
          <p>
            <strong>{formatDate(e.date)}</strong> {e.documentNumber ? <span className="mono">{e.documentNumber}</span> : null}{" "}
            {e.cancels ? <Badge kind="off">Cancellation (equal and opposite)</Badge> : null}
            {e.remark ? <span className="muted"> · {e.remark}</span> : null}
          </p>
          <EntryLinesTable entry={e} />
        </section>
      ))}
    </>
  );
}

/**
 * "View ledger entry": shows what a posted document wrote to the accounts.
 * Only for users who may see the accounts. With `inline` the lines open below
 * the button instead of in a dialog (for use inside another dialog).
 */
export function LedgerEntryButton({ documentType, documentId, inline = false }: { documentType: LedgerDocumentType; documentId: string; inline?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!accountRights(user).view) return null;
  if (inline) {
    return (
      <div>
        <Button size="small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide ledger entry" : "View ledger entry"}
        </Button>
        {open ? <LedgerEntries documentType={documentType} documentId={documentId} /> : null}
      </div>
    );
  }
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        View ledger entry
      </Button>
      <Dialog open={open} title="Ledger entry" onClose={() => setOpen(false)}>
        {open ? <LedgerEntries documentType={documentType} documentId={documentId} /> : null}
      </Dialog>
    </>
  );
}
