// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { OrdersReasonDialog, useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { accountName, accountRights, documentHref, documentLabel, JOURNAL_KIND_LABELS, type JournalDto, sum } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { DocStatusBadge, partyText, useChart, usePartyNames } from "./accounts-shared";
import { LedgerEntryButton } from "./ledger-entry";

/** A journal: its lines and the actions the user may take (change a draft, post, cancel). */
export function JournalView({ journal, onChanged, onEdit }: { journal: JournalDto; onChanged: (j: JournalDto) => void; onEdit?: () => void }) {
  const { user } = useAuth();
  const rights = accountRights(user);
  const chart = useChart();
  const { stores } = useOrderStores();
  const names = usePartyNames(journal.lines.map((l) => ({ type: l.partyType, id: l.partyId })));
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const j = journal;
  const mayAct = rights.journals || (rights.cashDeposit && j.kind === "cash");
  const account = (id: string) => accountName(chart.data?.accounts.find((a) => a.id === id));
  const store = (id: string | null) => (id ? (stores.find((s) => s.id === id)?.code ?? "…") : "—");

  async function post() {
    setError(null);
    setBusy(true);
    try {
      onChanged(await api.post<JournalDto>(`/journals/${j.id}/post`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          Journal <span className="mono">{j.number ?? "(draft)"}</span>
        </h1>
        <DocStatusBadge status={j.status} />
        <span className="spacer" />
        {j.status !== "draft" ? <LedgerEntryButton documentType="journal" documentId={j.id} /> : null}
      </div>
      {j.status === "cancelled" ? <Alert kind="info">{`Cancelled${j.cancelReason ? `: ${j.cancelReason}` : ""}.${j.postedAt ? " Equal and opposite entries were posted on the same date." : ""}`}</Alert> : null}
      <div className="card">
        <dl className="kv">
          <dt>What it is for</dt>
          <dd>{JOURNAL_KIND_LABELS[j.kind] ?? j.kind}</dd>
          <dt>Date</dt>
          <dd>{formatDate(j.journalDate)}</dd>
          <dt>Reference</dt>
          <dd>
            {j.reference ?? "—"}
            {j.referenceDate ? ` of ${formatDate(j.referenceDate)}` : ""}
          </dd>
          <dt>What happened</dt>
          <dd>{j.remark ?? "—"}</dd>
          {j.postedAt ? (
            <>
              <dt>Posted</dt>
              <dd>{formatDateTime(j.postedAt)}</dd>
            </>
          ) : null}
        </dl>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Store</th>
              <th scope="col">Customer / supplier</th>
              <th scope="col" className="num">
                Debit
              </th>
              <th scope="col" className="num">
                Credit
              </th>
              <th scope="col">Against bill</th>
              <th scope="col">Remark</th>
            </tr>
          </thead>
          <tbody>
            {j.lines.map((l) => {
              const href = l.againstType && l.againstId ? documentHref(l.againstType, l.againstId) : null;
              return (
                <tr key={l.lineNo}>
                  <td>{account(l.accountId)}</td>
                  <td className="mono">{store(l.storeId)}</td>
                  <td>{l.partyId ? partyText(names[l.partyId]) : "—"}</td>
                  <td className="num">{l.debit === "0.00" ? "" : rupees(l.debit)}</td>
                  <td className="num">{l.credit === "0.00" ? "" : rupees(l.credit)}</td>
                  <td>{l.againstType ? href ? <Link href={href}>{documentLabel(l.againstType)}</Link> : documentLabel(l.againstType) : "—"}</td>
                  <td>{l.remark ?? ""}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3}>
                <strong>Totals</strong>
              </td>
              <td className="num">
                <strong>{rupees(sum(j.lines.map((l) => l.debit)).toFixed(2))}</strong>
              </td>
              <td className="num">
                <strong>{rupees(sum(j.lines.map((l) => l.credit)).toFixed(2))}</strong>
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      <Alert kind="error">{error}</Alert>
      {mayAct ? (
        <div className="actions">
          {j.status === "draft" ? (
            <>
              <Button variant="primary" busy={busy} onClick={post}>
                Post
              </Button>
              {onEdit ? <Button onClick={onEdit}>Change draft</Button> : null}
            </>
          ) : null}
          {j.status !== "cancelled" ? (
            <Button variant="danger" onClick={() => setCancelling(true)}>
              {j.status === "draft" ? "Cancel draft" : "Cancel journal"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <OrdersReasonDialog
        open={cancelling}
        title={j.status === "draft" ? "Cancel this draft" : "Cancel this journal"}
        explain={
          j.status === "draft"
            ? "The draft is kept in the list as cancelled. Nothing was posted yet."
            : "Equal and opposite entries are posted on the same date as the journal, so the books are as if it never happened. Both stay visible in the ledger. Bills it settled owe again."
        }
        confirmLabel="Cancel it"
        danger
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => onChanged(await api.post<JournalDto>(`/journals/${j.id}/cancel`, { reason }))}
      />
    </>
  );
}
