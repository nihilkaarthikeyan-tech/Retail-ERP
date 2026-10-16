// Copyright (c) 2026, Rademics. All rights reserved.
// Going live (decision 72; plan 10 §1.E), for the Owner only: the figures to
// compare with the old system, clearing the transactions of a trial period,
// and recording the go-live date, which switches clearing off for good.
"use client";

import { type FormEvent, useState } from "react";
import { Decimal } from "shared";
import { Alert, Badge, Button, DataTable, Dialog, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type ClearResultDto, type ClearingStepDto, companyNameMatches, type GoLiveDto, TRANSACTION_COUNT_LABELS } from "@/lib/documents";
import { formatDate, formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useBusinessToday } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

const dec = (v: string | null | undefined) => {
  try {
    return new Decimal(v ?? "0");
  } catch {
    return new Decimal(0);
  }
};

export function GoLiveScreen() {
  const { user, loading } = useAuth();
  const allowed = !!user?.isOwnerAdmin;
  const status = useLoad<GoLiveDto | null>(() => (allowed ? api.get<GoLiveDto>("/go-live") : Promise.resolve(null)), [allowed]);
  const [dialog, setDialog] = useState<"clear" | "date" | null>(null);
  const [cleared, setCleared] = useState<ClearResultDto | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <>
        <h1>Going live</h1>
        <Alert kind="error">Only the Owner can see this page.</Alert>
      </>
    );
  }
  if (status.error) {
    return (
      <>
        <h1>Going live</h1>
        <Alert kind="error">{status.error}</Alert>
      </>
    );
  }
  const s = status.data;
  if (!s) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Going live</h1>
      {s.goLiveDate ? (
        <Alert kind="success">
          The shop went live on <strong>{formatDate(s.goLiveDate)}</strong>. Trial data can no longer be cleared.
        </Alert>
      ) : (
        <p className="muted">While you try the system out, the bills, stock and accounts made can be cleared. When you start for real, record the go-live date; from then on nothing can be cleared.</p>
      )}

      {cleared ? (
        <Alert kind="success">
          <strong>The trial data was cleared.</strong> {cleared.note}
          <StepsTable steps={cleared.steps} />
        </Alert>
      ) : null}

      <CheckFigures check={s.check} />

      <h2>Transactions in the system now</h2>
      <div className="tiles">
        {Object.entries(s.transactions).map(([k, n]) => (
          <div key={k} className="tile">
            <p className="tile-label">{TRANSACTION_COUNT_LABELS[k] ?? k}</p>
            <p className="tile-value">{n.toLocaleString("en-IN")}</p>
          </div>
        ))}
      </div>

      {s.clearingAllowed ? (
        <div className="golive-actions">
          <section className="card golive-danger">
            <h2 style={{ marginTop: 0 }}>Clear trial data</h2>
            <p>Removes every bill, stock movement, purchase document, payment, journal and ledger entry made so far. Items, prices, customers, suppliers, accounts, users and settings stay.</p>
            <Button variant="danger" onClick={() => setDialog("clear")}>
              Clear trial data…
            </Button>
          </section>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Record the go-live date</h2>
            <p>The day the shop starts using the system for real. After this, trial data can never be cleared.</p>
            <Button variant="primary" onClick={() => setDialog("date")}>
              Record the go-live date…
            </Button>
          </section>
        </div>
      ) : null}

      <h2>Past clearings</h2>
      {s.clearings.length === 0 ? (
        <p className="muted">Trial data has never been cleared.</p>
      ) : (
        s.clearings.map((c) => (
          <section key={c.id} className="card">
            <p>
              <strong>{formatDateTime(c.finishedAt ?? c.requestedAt)}</strong> · {c.reason}
            </p>
            <StepsTable steps={c.steps} />
          </section>
        ))
      )}

      {dialog === "clear" ? (
        <ClearTrialDataDialog
          companyName={s.companyName}
          onClose={() => setDialog(null)}
          onCleared={(r) => {
            setCleared(r);
            setDialog(null);
            void status.reload();
          }}
        />
      ) : null}
      {dialog === "date" ? (
        <GoLiveDateDialog
          companyName={s.companyName}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            status.setData(next);
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
}

function StepsTable({ steps }: { steps: ClearingStepDto[] }) {
  return (
    <DataTable
      columns={[
        { key: "step", header: "Step", render: (st) => st.step },
        { key: "rows", header: "Rows", align: "right", render: (st) => st.rows.toLocaleString("en-IN") },
        { key: "outcome", header: "Done", render: (st) => (st.outcome === "cleared" ? "Cleared" : st.outcome === "reset" ? "Reset" : st.outcome) },
      ]}
      rows={steps}
      rowKey={(st) => st.step}
    />
  );
}

function CheckFigures({ check }: { check: GoLiveDto["check"] }) {
  const tb = check.trialBalance;
  const debits = tb.closingDebit ?? tb.debit ?? "0.00";
  const credits = tb.closingCredit ?? tb.credit ?? "0.00";
  const balanced = dec(debits).eq(dec(credits));
  const stock = check.stockAgainstAccounts;
  return (
    <>
      <h2>Check the figures (as on {formatDate(check.asOf)})</h2>
      <p className="muted">Compare these with your old system’s figures on the go-live date.</p>
      <h3>Trial balance</h3>
      <div className="tiles">
        <div className="tile">
          <p className="tile-label">Total debits</p>
          <p className="tile-value">{rupees(debits)}</p>
        </div>
        <div className="tile">
          <p className="tile-label">Total credits</p>
          <p className="tile-value">{rupees(credits)}</p>
        </div>
        <div className="tile">
          <p className="tile-label">Do they agree?</p>
          <p className="tile-value">{balanced ? <Badge kind="ok">Yes</Badge> : <Badge kind="off">No: tell the Accountant</Badge>}</p>
        </div>
      </div>

      <h3>Stock against the accounts</h3>
      <p>{stock.ok ? <Badge kind="ok">Stock value and the accounts agree</Badge> : <Badge kind="off">They differ: tell the Accountant</Badge>}</p>
      <DataTable
        columns={[
          { key: "name", header: "Store", render: (r) => r.name },
          { key: "stock", header: "Stock value", align: "right", render: (r) => rupees(r.stockValue) },
          { key: "books", header: "In the accounts", align: "right", render: (r) => rupees(r.accounts) },
          { key: "diff", header: "Difference", align: "right", render: (r) => rupees(r.difference) },
        ]}
        rows={stock.rows}
        rowKey={(r) => r.key}
        empty="No stock and no stock in the accounts."
      />

      <div className="golive-dues">
        <Dues title="What customers owe, by age" bands={check.customerDues} />
        <Dues title="What the shop owes suppliers, by age" bands={check.supplierDues} />
      </div>
    </>
  );
}

function Dues({ title, bands }: { title: string; bands: Record<string, string> }) {
  const rows = Object.entries(bands);
  const total = rows.reduce((sum, [, v]) => sum.add(dec(v)), new Decimal(0));
  return (
    <section>
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {rows.map(([band, amount]) => (
              <tr key={band}>
                <td>{band}</td>
                <td className="num">{rupees(amount)}</td>
              </tr>
            ))}
            <tr className="report-totals">
              <td>
                <strong>Total</strong>
              </td>
              <td className="num">
                <strong>{rupees(total.toFixed(2))}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface ClearTrialDataDialogProps {
  companyName: string;
  onClose: () => void;
  onCleared: (result: ClearResultDto) => void;
}

/** The confirmation for clearing trial data: what goes and what stays, a reason, and the company name typed in. */
export function ClearTrialDataDialog({ companyName, onClose, onCleared }: ClearTrialDataDialogProps) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = reason.trim() !== "" && companyNameMatches(typed, companyName);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onCleared(await api.post<ClearResultDto>("/go-live/clear-trial-data", { reason: reason.trim(), confirmCompanyName: typed.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Clear trial data" onClose={onClose}>
      <form onSubmit={submit} noValidate className="doc-form">
        <Alert kind="error">This deletes data and cannot be undone. Use it only to wipe a trial period before going live.</Alert>
        <div className="golive-lists">
          <div>
            <h3>Removed</h3>
            <ul>
              <li>Till bills, payments, shifts and cash closings</li>
              <li>Stock movements and stock totals (all stock goes to zero), stock documents, batches and serial numbers</li>
              <li>Purchase orders, goods receipts, supplier bills, freight charges and reorder suggestions</li>
              <li>Receipts and payments, journals, opening bills, year-end closings and the whole ledger</li>
              <li>Document number counters (numbering starts again), past imports and summary emails</li>
              <li>Prices for single batches, coupon use counts, last purchase prices and the books-locked date are reset</li>
            </ul>
          </div>
          <div>
            <h3>Kept</h3>
            <ul>
              <li>Items, units, barcodes and prices</li>
              <li>Customers and suppliers</li>
              <li>The chart of accounts</li>
              <li>Users, roles, stores, tills and all settings</li>
              <li>The change history, including this clearing</li>
            </ul>
          </div>
        </div>
        <TextareaInput id="clear-reason" label="Why are you clearing it?" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} required hint="For example: “End of the two-week trial”. It is kept in the history." />
        <TextInput
          id="clear-confirm"
          label={
            <>
              Type the company name <strong>{companyName}</strong> to confirm
            </>
          }
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          required
        />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="danger" busy={busy} disabled={!ready}>
            Clear the trial data
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

interface GoLiveDateDialogProps {
  companyName: string;
  onClose: () => void;
  onSaved: (status: GoLiveDto) => void;
}

/** Recording the go-live date: a date, the company name typed in, and a warning that it is for good. */
export function GoLiveDateDialog({ companyName, onClose, onSaved }: GoLiveDateDialogProps) {
  const today = useBusinessToday();
  const [date, setDate] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = date || today;
  const ready = value !== "" && companyNameMatches(typed, companyName);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.post<GoLiveDto>("/go-live/date", { goLiveDate: value, confirmCompanyName: typed.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="Record the go-live date" onClose={onClose}>
      <form onSubmit={submit} noValidate className="doc-form">
        <Alert kind="error">
          <strong>This can never be undone.</strong> Once the go-live date is recorded, trial data can never be cleared again, not even by the Owner, and the date cannot be changed.
        </Alert>
        <TextInput id="golive-date" label="The shop goes live on" type="date" value={value} onChange={(e) => setDate(e.target.value)} required />
        <TextInput
          id="golive-confirm"
          label={
            <>
              Type the company name <strong>{companyName}</strong> to confirm
            </>
          }
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          required
        />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
            Record the go-live date
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
