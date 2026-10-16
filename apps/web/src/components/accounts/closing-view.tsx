// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { lockDateSchema, yearEndClosingSchema } from "shared";
import { OrdersReasonDialog } from "@/components/purchasing/orders-shared";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, TextareaInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type AccountingSettingsDto, accountName, accountRights, postable, type YearEndClosingDto } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import type { FinancialYearDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { AccountSelect, useChart } from "./accounts-shared";
import { LedgerEntryButton } from "./ledger-entry";

/** "Books locked up to": only the Accountant may post on or before this date. */
function LockDateForm({ current, canLock, onSaved }: { current: string | null; canLock: boolean; onSaved: () => void }) {
  const [lockDate, setLockDate] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = lockDateSchema.safeParse({ lockDate: lockDate || null, reason });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.patch("/accounting/lock-date", parsed.data);
      setNotice(parsed.data.lockDate ? `Books locked up to ${formatDate(parsed.data.lockDate)}.` : "The books are no longer locked.");
      setReason("");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Books locked up to">
      <h2>Books locked up to</h2>
      <p>
        {current ? (
          <>
            Locked up to <strong>{formatDate(current)}</strong>. Only the Accountant can post on or before this date.
          </>
        ) : (
          "The books are not locked. Anyone with the right can post on any open date."
        )}
      </p>
      {canLock ? (
        <form onSubmit={submit} noValidate>
          <Alert kind="error">{error}</Alert>
          <Alert kind="success">{notice}</Alert>
          <div className="form-grid">
            <TextInput id="lock-date" label="Lock up to" type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} error={errors.lockDate} hint="Leave empty to unlock." />
            <TextareaInput id="lock-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} maxLength={300} required hint="For example: September GST return filed." />
          </div>
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy}>
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function CloseYearDialog({ years, onClose, onDone }: { years: FinancialYearDto[]; onClose: () => void; onDone: () => void }) {
  const chart = useChart();
  const accounts = postable(chart.data?.accounts ?? []).filter((a) => a.family === "equity" || a.family === "liability");
  const retained = accounts.find((a) => a.systemKey === "retained_earnings");
  const [yearId, setYearId] = useState(years[0]?.id ?? "");
  const [accountId, setAccountId] = useState("");
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = accountId || retained?.id || "";
  const year = years.find((y) => y.id === yearId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = yearEndClosingSchema.safeParse({ financialYearId: yearId, closingAccountId: chosen, remark: blankToNull(remark) });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/year-end-closings", parsed.data);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Close a financial year" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error ?? chart.error}</Alert>
        <p>Every income and expense account is brought to zero at the end of the year, shop by shop, and the year&apos;s profit or loss moves to the closing account. The new year starts fresh. A closing can be cancelled while no later year is closed.</p>
        <SelectInput id="close-year" label="Financial year" value={yearId} onChange={(e) => setYearId(e.target.value)} error={errors.financialYearId} required>
          <option value="">Choose</option>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name} ({formatDate(y.startDate)} to {formatDate(y.endDate)})
            </option>
          ))}
        </SelectInput>
        <AccountSelect id="close-account" label="Move the profit or loss to" accounts={accounts} value={chosen} onChange={setAccountId} error={errors.closingAccountId} required hint="Usually Retained earnings." />
        <TextareaInput id="close-remark" label="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={300} />
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Close {year?.name ?? "the year"}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Go back
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Protecting the books: the locked date and year-end closings. */
export function ClosingView() {
  const { user } = useAuth();
  const rights = accountRights(user);
  const settings = useLoad(() => api.get<AccountingSettingsDto>("/accounting/settings"));
  const closings = useLoad(() => api.get<YearEndClosingDto[]>("/year-end-closings"));
  const years = useLoad<FinancialYearDto[] | null>(() => (rights.lockBooks ? api.get<FinancialYearDto[]>("/financial-years") : Promise.resolve(null)), [rights.lockBooks]);
  const chart = useChart();
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState<YearEndClosingDto | null>(null);
  const closedYears = new Set((closings.data ?? []).filter((c) => c.status === "posted").map((c) => c.financialYearId));
  const openYears = (years.data ?? []).filter((y) => !closedYears.has(y.id)).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const columns: Column<YearEndClosingDto>[] = [
    { key: "year", header: "Financial year", render: (c) => c.financialYear ?? "—" },
    { key: "end", header: "Year ended", render: (c) => formatDate(c.periodEnd) },
    { key: "account", header: "Profit or loss moved to", render: (c) => accountName(chart.data?.accounts.find((a) => a.id === c.closingAccountId)) },
    { key: "status", header: "Status", render: (c) => <Badge kind={c.status === "posted" ? "ok" : "off"}>{c.status === "posted" ? "Closed" : "Closing cancelled"}</Badge> },
    { key: "remark", header: "Remark", render: (c) => c.remark ?? "" },
    {
      key: "actions",
      header: "",
      render: (c) => (
        <span className="row-actions">
          <LedgerEntryButton documentType="year_end_closing" documentId={c.id} />
          {rights.lockBooks && c.status === "posted" ? (
            <Button size="small" variant="danger" onClick={() => setCancelling(c)}>
              Cancel closing
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <h1>Closing the books</h1>
      <Alert kind="error">{settings.error ?? closings.error ?? years.error}</Alert>
      {settings.data ? <LockDateForm key={settings.data.lockDate ?? ""} current={settings.data.lockDate} canLock={rights.lockBooks} onSaved={() => void settings.reload()} /> : <p className="muted">Loading…</p>}
      <h2>Year-end closing</h2>
      {rights.lockBooks ? (
        <div className="toolbar">
          <Button variant="primary" disabled={!years.data} onClick={() => setClosing(true)}>
            Close a financial year
          </Button>
        </div>
      ) : null}
      <DataTable columns={columns} rows={closings.data} rowKey={(c) => c.id} loading={closings.loading} empty="No year has been closed yet." />
      {closing && years.data ? (
        <CloseYearDialog
          years={openYears}
          onClose={() => setClosing(false)}
          onDone={() => void closings.reload()}
        />
      ) : null}
      <OrdersReasonDialog
        open={cancelling !== null}
        title={`Cancel the closing of ${cancelling?.financialYear ?? "the year"}`}
        explain="Equal and opposite entries are posted, so income and expenses of that year show again. Only possible while no later year is closed."
        confirmLabel="Cancel the closing"
        danger
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          await api.post(`/year-end-closings/${cancelling.id}/cancel`, { reason });
          await closings.reload();
        }}
      />
    </>
  );
}
