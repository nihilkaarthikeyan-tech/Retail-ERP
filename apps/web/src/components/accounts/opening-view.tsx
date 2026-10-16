// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { openingBillSchema } from "shared";
import { PartyPicker } from "@/components/parties/party-picker";
import { OrdersReasonDialog, useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Badge, Button, DataTable, RadioInput, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { accountRights, type OpeningBillDto, type OpeningCheckDto, type PartyKind } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { partyText, usePartyNames } from "./accounts-shared";
import { LedgerEntryButton } from "./ledger-entry";

/** The temporary opening account must end at zero once every opening balance is in. */
export function OpeningCheckPanel({ check }: { check: OpeningCheckDto }) {
  return (
    <section className="card" aria-label="Opening check">
      <h2>Opening check</h2>
      <p>
        {check.ok ? <Badge kind="ok">All in order</Badge> : <Badge kind="warn">Not zero yet</Badge>} The <strong>{check.account.name}</strong> account holds the other side of every opening balance. When everything is entered it must be exactly zero.
      </p>
      <dl className="kv">
        <dt>Debits</dt>
        <dd>{rupees(check.debit)}</dd>
        <dt>Credits</dt>
        <dd>{rupees(check.credit)}</dd>
        <dt>Difference</dt>
        <dd className={check.ok ? undefined : "num-negative"}>{rupees(check.difference)}</dd>
      </dl>
      {!check.ok ? <p className="muted">A difference means some balance is missing or entered twice. Check the opening journal, the opening bills and the opening stock count.</p> : null}
    </section>
  );
}

interface BillForm {
  partyType: PartyKind;
  party: PartyRef | null;
  storeId: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  amount: string;
}

const emptyBill: BillForm = { partyType: "customer", party: null, storeId: "", billNumber: "", billDate: "", dueDate: "", amount: "" };

function OpeningBillForm({ onSaved }: { onSaved: () => void }) {
  const { stores } = useOrderStores();
  const [form, setForm] = useState<BillForm>(emptyBill);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BillForm>(k: K, v: BillForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = openingBillSchema.safeParse({
      partyType: form.partyType,
      partyId: form.party?.id ?? "",
      storeId: form.storeId || null,
      billNumber: form.billNumber,
      billDate: form.billDate,
      dueDate: form.dueDate || null,
      amount: form.amount.trim(),
    });
    const errs = issuesToFieldErrors(parsed);
    if (!form.party) errs.partyId = `Choose the ${form.partyType}`;
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post("/opening-bills", parsed.data);
      setNotice(`Opening bill ${form.billNumber} entered.`);
      setForm({ ...emptyBill, partyType: form.partyType, storeId: form.storeId });
      onSaved();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate aria-label="Add an opening bill">
      <h2>Add an unpaid bill from before going live</h2>
      <p className="muted">Enter each unpaid bill separately with its own date, so the ageing report shows how old it really is. It is posted against the temporary opening account.</p>
      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>
      <div className="toolbar" role="radiogroup" aria-label="Whose bill">
        <RadioInput id="ob-customer" name="ob-type" label="A customer owes us" checked={form.partyType === "customer"} onChange={() => setForm((f) => ({ ...f, partyType: "customer", party: null }))} />
        <RadioInput id="ob-supplier" name="ob-type" label="We owe a supplier" checked={form.partyType === "supplier"} onChange={() => setForm((f) => ({ ...f, partyType: "supplier", party: null }))} />
      </div>
      <div className="form-grid">
        <div className="span-2">
          <PartyPicker id="ob-party" label={form.partyType === "customer" ? "Customer" : "Supplier"} kind={form.partyType} value={form.party} onChange={(p) => set("party", p)} error={errors.partyId} />
        </div>
        <TextInput id="ob-number" label="Bill number" value={form.billNumber} onChange={(e) => set("billNumber", e.target.value)} error={errors.billNumber} maxLength={40} required />
        <TextInput id="ob-amount" label="Still owed" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} error={errors.amount} required hint="What was unpaid on the go-live date." />
        <TextInput id="ob-date" label="Bill date" type="date" value={form.billDate} onChange={(e) => set("billDate", e.target.value)} error={errors.billDate} required />
        <TextInput id="ob-due" label="Due date" type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} error={errors.dueDate} />
        <SelectInput id="ob-store" label="Store" value={form.storeId} onChange={(e) => set("storeId", e.target.value)}>
          <option value="">Head office / not a store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Enter opening bill
        </Button>
      </div>
    </form>
  );
}

/** Going live: the opening journal, opening bills and the opening check. */
export function OpeningBalances() {
  const { user } = useAuth();
  const rights = accountRights(user);
  const bills = useLoad(() => api.get<OpeningBillDto[]>("/opening-bills"));
  const check = useLoad(() => api.get<OpeningCheckDto>("/accounting/opening-check"));
  const names = usePartyNames((bills.data ?? []).map((b) => ({ type: b.partyType, id: b.partyId })));
  const [cancelling, setCancelling] = useState<OpeningBillDto | null>(null);
  const reloadAll = () => void Promise.all([bills.reload(), check.reload()]);

  const columns: Column<OpeningBillDto>[] = [
    { key: "party", header: "Customer / supplier", render: (b) => `${b.partyType === "customer" ? "Customer" : "Supplier"}: ${partyText(names[b.partyId])}` },
    { key: "number", header: "Bill", render: (b) => <span className="mono">{b.billNumber}</span> },
    { key: "date", header: "Bill date", render: (b) => formatDate(b.billDate) },
    { key: "due", header: "Due", render: (b) => formatDate(b.dueDate) },
    { key: "amount", header: "Amount", align: "right", render: (b) => rupees(b.amount) },
    { key: "owed", header: "Still owed", align: "right", render: (b) => (b.status === "posted" ? rupees(b.owed) : "—") },
    { key: "status", header: "Status", render: (b) => <Badge kind={b.status === "posted" ? "ok" : "off"}>{b.status === "posted" ? "Entered" : "Cancelled"}</Badge> },
    {
      key: "actions",
      header: "",
      render: (b) => (
        <span className="row-actions">
          <LedgerEntryButton documentType="opening_bill" documentId={b.id} />
          {rights.journals && b.status === "posted" ? (
            <Button size="small" variant="danger" onClick={() => setCancelling(b)}>
              Cancel
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <h1>Opening balances</h1>
      <p>Going live takes three steps. Do them with the books dated the day before going live.</p>
      <ol>
        <li>
          <strong>Opening journal</strong> for every balance: cash, bank, capital, loans, assets.{" "}
          {rights.journals ? <Link href="/accounts/journals/new?kind=opening">Make an opening journal</Link> : null}
        </li>
        <li>
          <strong>Opening bills</strong>: one for every unpaid customer or supplier bill (below).
        </li>
        <li>
          <strong>Opening stock</strong>: counted in Inventory with an opening stock count. <Link href="/stock/documents">Stock documents</Link>
        </li>
      </ol>
      <Alert kind="error">{check.error}</Alert>
      {check.data ? <OpeningCheckPanel check={check.data} /> : null}
      {rights.journals ? <OpeningBillForm onSaved={reloadAll} /> : null}
      <h2>Opening bills</h2>
      <Alert kind="error">{bills.error}</Alert>
      <DataTable columns={columns} rows={bills.data} rowKey={(b) => b.id} loading={bills.loading} empty="No opening bills yet." rowClassName={(b) => (b.status === "cancelled" ? "row-muted" : undefined)} />
      <OrdersReasonDialog
        open={cancelling !== null}
        title={`Cancel opening bill ${cancelling?.billNumber ?? ""}`}
        explain="Equal and opposite entries are posted. A bill with payments linked to it cannot be cancelled until those links are undone."
        confirmLabel="Cancel the bill"
        danger
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          await api.post(`/opening-bills/${cancelling.id}/cancel`, { reason });
          reloadAll();
        }}
      />
    </>
  );
}
