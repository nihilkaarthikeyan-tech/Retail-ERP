// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { hasPermission } from "shared";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useBusinessToday } from "@/lib/stock";
import { changedRows, monthStart, type TallyMapDto, type TallyMapRow, tallyFileName, tallyVouchersPath } from "@/lib/tally";
import { useLoad } from "@/lib/use-load";

/** Download the vouchers of a period (and optionally one store) as a file TallyPrime imports. */
export function TallyExportForm() {
  const today = useBusinessToday();
  const { stores } = useOrderStores();
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState<"vouchers" | "ledgers" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const from = period?.from ?? (today ? monthStart(today) : "");
  const to = period?.to ?? today ?? "";

  async function exportVouchers(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!from || !to) return setError("Choose the dates to export.");
    if (from > to) return setError("The start date is after the end date.");
    setBusy("vouchers");
    try {
      await downloadFile(tallyVouchersPath(from, to, storeId), tallyFileName(from, to));
      setDone("The voucher file is downloaded. The export is recorded in the history.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function exportLedgers() {
    setError(null);
    setDone(null);
    setBusy("ledgers");
    try {
      await downloadFile("/tally/ledgers", "tally-ledgers.xml");
      setDone("The ledger list is downloaded.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={exportVouchers} noValidate className="card" aria-label="Export to Tally">
      <h2>Export vouchers</h2>
      <p className="muted">
        One Tally voucher for each entry in our books: till shifts as Sales, supplier bills as Purchase, payments, receipts, transfers (Contra) and journals and expenses as Journal. Exporting the same period again gives the same file, so your accountant can see whether anything changed. Cancelled entries are exported together with their cancellation, so they add up to zero.
      </p>
      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{done}</Alert>
      <div className="form-grid">
        <TextInput id="tally-from" label="From" type="date" value={from} onChange={(e) => setPeriod({ from: e.target.value, to })} required />
        <TextInput id="tally-to" label="To" type="date" value={to} onChange={(e) => setPeriod({ from, to: e.target.value })} required />
        <SelectInput id="tally-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} hint="All stores, or just one.">
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy === "vouchers"} disabled={busy !== null}>
          Download vouchers for Tally
        </Button>
        <Button busy={busy === "ledgers"} disabled={busy !== null} onClick={() => void exportLedgers()} title="Every ledger with its Tally group, to create missing ledgers in Tally first">
          Download ledger list
        </Button>
      </div>
      <p className="muted">Import the ledger list into Tally first, then the vouchers. Ask your accountant to try a test import into a copy of the Tally company before relying on the file.</p>
    </form>
  );
}

/** Which Tally ledger each of our accounts goes to (pre-filled with our account name). */
export function TallyLedgerMap({ canChange }: { canChange: boolean }) {
  const map = useLoad(() => api.get<TallyMapDto>("/tally/ledger-map"));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const rows = map.data?.rows ?? null;
  const changes = rows ? changedRows(rows, edits) : [];

  async function save() {
    setError(null);
    setSaved(null);
    if (changes.length === 0) return;
    setBusy(true);
    try {
      const next = await api.put<TallyMapDto>("/tally/ledger-map", { rows: changes });
      map.setData(next);
      setEdits({});
      setSaved(`${changes.length} Tally ledger name${changes.length === 1 ? "" : "s"} saved.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<TallyMapRow>[] = [
    { key: "number", header: "Number", render: (r) => <span className="mono">{r.number ?? "—"}</span> },
    { key: "name", header: "Our account", render: (r) => (r.active ? r.name : `${r.name} (inactive)`) },
    { key: "group", header: "Tally group", render: (r) => r.tallyGroup },
    {
      key: "ledger",
      header: "Tally ledger name",
      render: (r) =>
        canChange ? (
          <input
            className="input"
            aria-label={`Tally ledger for ${r.name}`}
            value={edits[r.accountId] ?? r.tallyLedger}
            maxLength={100}
            onChange={(e) => setEdits((x) => ({ ...x, [r.accountId]: e.target.value }))}
          />
        ) : (
          r.tallyLedger
        ),
    },
  ];

  return (
    <section aria-label="Tally ledger names">
      <h2>Tally ledger names</h2>
      <p className="muted">Each of our accounts goes to the Tally ledger named here. Leave a name blank to use our own account name. Customers and suppliers always go to their own names in Tally.</p>
      <Alert kind="error">{map.error ?? error}</Alert>
      <Alert kind="success">{saved}</Alert>
      {canChange ? (
        <div className="toolbar">
          <span className="muted">{changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} not saved yet` : "No changes"}</span>
          <span className="spacer" />
          <Button variant="primary" busy={busy} disabled={changes.length === 0} onClick={() => void save()}>
            Save ledger names
          </Button>
        </div>
      ) : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.accountId} loading={map.loading} empty="No accounts yet." />
    </section>
  );
}

export function TallyView() {
  const { user } = useAuth();
  const canExport = hasPermission(user, "tally.export");
  const canChange = canExport || hasPermission(user, "accounts.manage");
  return (
    <>
      <h1>Export to Tally</h1>
      <p className="muted">For an outside accountant who keeps the books in TallyPrime: download the vouchers of a period as a file Tally imports. Nothing in our books changes.</p>
      {canExport ? <TallyExportForm /> : <Alert kind="info">You can see the Tally ledger names; exporting needs the “Export to Tally” right.</Alert>}
      <TallyLedgerMap canChange={canChange} />
    </>
  );
}
