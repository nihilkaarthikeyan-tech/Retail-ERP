// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { JOURNAL_KINDS } from "shared";
import { DocStatusBadge } from "@/components/accounts/accounts-shared";
import { Alert, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { accountRights, DOC_STATUS_LABELS, type DocStatus, JOURNAL_KIND_LABELS, type JournalDto } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

export default function JournalsPage() {
  const { user } = useAuth();
  const rights = accountRights(user);
  const [f, setF] = useState({ status: "", kind: "", from: "", to: "", search: "" });
  const journals = useLoad(() => api.get<JournalDto[]>(`/journals${query(f)}`), [f.status, f.kind, f.from, f.to, f.search]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const columns: Column<JournalDto>[] = [
    {
      key: "number",
      header: "Number",
      render: (j) => (
        <Link href={`/accounts/journals/${j.id}`} className="mono">
          {j.number ?? "Draft"}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (j) => formatDate(j.journalDate) },
    { key: "kind", header: "What for", render: (j) => JOURNAL_KIND_LABELS[j.kind] ?? j.kind },
    { key: "remark", header: "What happened", render: (j) => j.remark ?? j.reference ?? "—" },
    { key: "total", header: "Amount", align: "right", render: (j) => rupees(j.total) },
    { key: "status", header: "Status", render: (j) => <DocStatusBadge status={j.status} /> },
  ];

  return (
    <>
      <h1>Journals</h1>
      <p className="muted">For everything that is not a bill or a payment: petty cash, rent and salaries, the owner&apos;s drawings, corrections, write-offs and opening balances.</p>
      {rights.makeJournals ? (
        <div className="toolbar">
          <Link href="/accounts/journals/new" className="btn btn-primary">
            New journal
          </Link>
        </div>
      ) : null}
      <div className="filter-row">
        <SelectInput id="jv-f-status" label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All</option>
          {(Object.keys(DOC_STATUS_LABELS) as DocStatus[]).map((s) => (
            <option key={s} value={s}>
              {DOC_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="jv-f-kind" label="What for" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="">All kinds</option>
          {JOURNAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {JOURNAL_KIND_LABELS[k]}
            </option>
          ))}
        </SelectInput>
        <TextInput id="jv-f-from" label="From" type="date" value={f.from} onChange={(e) => set("from", e.target.value)} />
        <TextInput id="jv-f-to" label="To" type="date" value={f.to} onChange={(e) => set("to", e.target.value)} />
        <TextInput id="jv-f-search" label="Search" value={f.search} onChange={(e) => set("search", e.target.value)} hint="Number, reference or remark." />
      </div>
      <Alert kind="error">{journals.error}</Alert>
      <DataTable columns={columns} rows={journals.data} rowKey={(j) => j.id} loading={journals.loading} empty="No journals match." />
    </>
  );
}
