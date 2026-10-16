// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { expenseSchema, hasPermission } from "shared";
import { OrdersReasonDialog } from "@/components/purchasing/orders-shared";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { accountName, type ExpenseDto, type ExpenseOptionsDto, type ExpensePage, payFromChoices } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useBusinessToday } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { DocStatusBadge } from "./accounts-shared";
import { LedgerEntryButton } from "./ledger-entry";

interface FormValues {
  expenseDate: string;
  storeId: string;
  expenseAccountId: string;
  paidFromAccountId: string;
  amount: string;
  reference: string;
  remark: string;
}

const emptyForm = (date: string, storeId: string): FormValues => ({ expenseDate: date, storeId, expenseAccountId: "", paidFromAccountId: "", amount: "", reference: "", remark: "" });

/** "Add expense": a few fields, and behind them a normal posted entry (plan 11 C8). */
export function ExpenseForm({ options, today, onSaved }: { options: ExpenseOptionsDto; today: string; onSaved: (e: ExpenseDto) => void }) {
  const firstStore = options.stores[0]?.id ?? "";
  const [form, setForm] = useState<FormValues>(() => emptyForm(today, firstStore));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const payFrom = payFromChoices(options, form.storeId);
  // The store's cash in hand is the usual choice; it follows the store until another is picked.
  const paidFromAccountId = payFrom.some((a) => a.id === form.paidFromAccountId) ? form.paidFromAccountId : (payFrom[0]?.id ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      expenseDate: form.expenseDate,
      storeId: form.storeId,
      expenseAccountId: form.expenseAccountId,
      paidFromAccountId,
      amount: form.amount.trim(),
      reference: blankToNull(form.reference),
      remark: blankToNull(form.remark),
    };
    const parsed = expenseSchema.safeParse(body);
    const issues = issuesToFieldErrors(parsed);
    if (!form.expenseAccountId) issues.expenseAccountId = "Choose what the money was spent on";
    if (!form.storeId) issues.storeId = "Choose the store";
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length) return;
    setBusy(true);
    try {
      const saved = await api.post<ExpenseDto>("/expenses", parsed.data);
      setForm(emptyForm(form.expenseDate, form.storeId));
      setErrors({});
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card" aria-label="Add expense">
      <h2>Add expense</h2>
      <Alert kind="error">{error}</Alert>
      <div className="form-grid">
        <TextInput id="exp-date" label="Date" type="date" value={form.expenseDate} onChange={set("expenseDate")} error={errors.expenseDate} required />
        <SelectInput id="exp-store" label="Store" value={form.storeId} onChange={set("storeId")} error={errors.storeId} required hint="The expense counts against this store's profit.">
          {options.stores.length === 0 ? <option value="">No store</option> : null}
          {options.stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="exp-head" label="Spent on" value={form.expenseAccountId} onChange={set("expenseAccountId")} error={errors.expenseAccountId} required>
          <option value="">Choose the expense</option>
          {options.heads.map((h) => (
            <option key={h.id} value={h.id}>
              {accountName(h)}
              {h.locked ? " (locked)" : ""}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="exp-from" label="Paid from" value={paidFromAccountId} onChange={set("paidFromAccountId")} error={errors.paidFromAccountId} required hint="The store's cash in hand, or a bank account.">
          {payFrom.map((a) => (
            <option key={a.id} value={a.id}>
              {a.kind === "bank" ? `Bank: ${accountName(a)}` : `Cash: ${a.name}`}
            </option>
          ))}
        </SelectInput>
        <TextInput id="exp-amount" label="Amount (₹)" value={form.amount} onChange={set("amount")} error={errors.amount} inputMode="decimal" className="num" required autoComplete="off" />
        <TextInput id="exp-ref" label="Reference" hint="Bill, receipt or cheque number, if any." value={form.reference} onChange={set("reference")} error={errors.reference} maxLength={60} />
        <TextInput id="exp-remark" label="Remark" className="span-2" value={form.remark} onChange={set("remark")} error={errors.remark} maxLength={300} />
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={options.stores.length === 0}>
          Save expense
        </Button>
      </div>
    </form>
  );
}

/** Expenses: add one, see the list, cancel a mistake (reversed on the same date). */
export function ExpensesView() {
  const { user } = useAuth();
  const canPost = hasPermission(user, "expenses.post");
  const today = useBusinessToday();
  const options = useLoad(() => api.get<ExpenseOptionsDto>("/expenses/options"));
  const [f, setF] = useState({ storeId: "", from: "", to: "", status: "" });
  const [page, setPage] = useState(1);
  const q = query({ ...f, page: page > 1 ? String(page) : undefined });
  const list = useLoad(() => api.get<ExpensePage>(`/expenses${q}`), [q]);
  const [saved, setSaved] = useState<ExpenseDto | null>(null);
  const [cancelling, setCancelling] = useState<ExpenseDto | null>(null);
  const setFilter = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(1);
  };

  const columns: Column<ExpenseDto>[] = [
    { key: "number", header: "Number", render: (e) => <span className="mono">{e.number ?? "—"}</span> },
    { key: "date", header: "Date", render: (e) => formatDate(e.expenseDate) },
    { key: "store", header: "Store", render: (e) => e.store?.code ?? "—" },
    { key: "head", header: "Spent on", render: (e) => e.expenseAccount?.name ?? "—" },
    { key: "from", header: "Paid from", render: (e) => (e.paidFromKind === "bank" ? `Bank: ${e.paidFrom?.name ?? ""}` : (e.paidFrom?.name ?? "Cash")) },
    { key: "note", header: "Reference / remark", render: (e) => [e.reference, e.remark].filter(Boolean).join(" · ") || "—" },
    { key: "amount", header: "Amount", align: "right", render: (e) => rupees(e.amount) },
    { key: "status", header: "Status", render: (e) => (e.status === "cancelled" ? <span title={e.cancelReason ?? undefined}><DocStatusBadge status="cancelled" /></span> : <DocStatusBadge status="posted" />) },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      render: (e) => (
        <span className="toolbar">
          <LedgerEntryButton documentType="journal" documentId={e.id} />
          {canPost && e.status === "posted" ? (
            <Button size="small" variant="danger" onClick={() => setCancelling(e)}>
              Cancel
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
  const d = list.data;
  const pageCount = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <h1>Expenses</h1>
      <p className="muted">
        Rent, salaries, power and other spending paid in cash or from the bank. Each one is posted to the accounts at once: the expense against the store, and the cash or bank it was paid from. See the money day by day in the <Link href="/accounts/reports?tab=cash-book">cash book</Link> and <Link href="/accounts/reports?tab=bank-book">bank book</Link>.
      </p>
      <Alert kind="error">{options.error}</Alert>
      {saved ? <Alert kind="success">{`Expense ${saved.number ?? ""} saved: ${rupees(saved.amount)} for ${saved.expenseAccount?.name ?? "the expense"}.`}</Alert> : null}
      {canPost && options.data && today ? (
        <ExpenseForm
          options={options.data}
          today={today}
          onSaved={(e) => {
            setSaved(e);
            list.reload();
          }}
        />
      ) : null}

      <h2>Expenses entered</h2>
      <div className="filter-row">
        <SelectInput id="exp-f-store" label="Store" value={f.storeId} onChange={(e) => setFilter("storeId", e.target.value)}>
          <option value="">All my stores</option>
          {(options.data?.stores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="exp-f-from" label="From" type="date" value={f.from} onChange={(e) => setFilter("from", e.target.value)} />
        <TextInput id="exp-f-to" label="To" type="date" value={f.to} onChange={(e) => setFilter("to", e.target.value)} />
        <SelectInput id="exp-f-status" label="Status" value={f.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </SelectInput>
      </div>
      <Alert kind="error">{list.error}</Alert>
      {d ? (
        <p>
          {d.total} expense{d.total === 1 ? "" : "s"} · posted total <strong>{rupees(d.postedTotal)}</strong>
        </p>
      ) : null}
      <DataTable columns={columns} rows={d?.rows} rowKey={(e) => e.id} loading={list.loading} empty="No expenses match." rowClassName={(e) => (e.status === "cancelled" ? "row-muted" : undefined)} />
      {pageCount > 1 ? (
        <div className="toolbar">
          <span className="muted">
            Page {page} of {pageCount}
          </span>
          <span className="spacer" />
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button size="small" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
      <OrdersReasonDialog
        open={cancelling !== null}
        title={`Cancel expense ${cancelling?.number ?? ""}`}
        explain="Equal and opposite entries are posted on the same date as the expense, so the books are as if it never happened. Both stay visible in the ledger."
        confirmLabel="Cancel it"
        danger
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          await api.post<ExpenseDto>(`/expenses/${cancelling!.id}/cancel`, { reason });
          setSaved(null);
          list.reload();
        }}
      />
    </>
  );
}
