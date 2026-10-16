// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

// Supplier sale-or-return (plan 11 part 2 §3): goods held by supplier, sold but
// not settled, the statements, and one statement with "Make bill" and "Cancel".
// Every amount shown is what the API worked out; nothing is calculated here.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { consignmentBillSchema, createConsignmentStatementSchema } from "shared";
import { PartyPicker } from "@/components/parties/party-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { purchaseRights, rupees, statusTone } from "@/lib/purchasing";
import { defaultStoreId, showQuantity, storesFromLocations, useBusinessToday } from "@/lib/stock";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { issuesToFieldErrors } from "@/lib/validation";
import { ReasonDialog } from "./receipts-parts";

interface Ref {
  id: string;
  code: string;
  name: string;
}

interface StockFigures {
  heldQuantity: string;
  soldNotSettledQuantity: string;
  heldValue?: string;
  soldNotSettledAmount?: string;
  owed?: string;
}

export interface ConsignmentStockDto {
  rows: (StockFigures & { supplier: Ref; store: Ref; items: (StockFigures & { item: Ref })[] })[];
  totals: StockFigures;
  check?: { fromGoods: string; ledger: string; difference: string; ok: boolean };
}

export type StatementStatus = "draft" | "billed" | "cancelled";

export interface ConsignmentStatementDto {
  id: string;
  number: string;
  status: StatementStatus;
  supplier: Ref;
  store: Ref;
  fromDate: string;
  toDate: string;
  remarks: string | null;
  bill: { id: string; number: string; status: string; total?: string } | null;
  amount?: string;
  createdAt: string;
  lines: { item: Ref; received: string; sold: string; returned: string; held: string; rate?: string; amount?: string }[];
}

export const STATEMENT_STATUS_LABELS: Record<StatementStatus, string> = { draft: "Draft", billed: "Billed", cancelled: "Cancelled" };

export function StatementStatusBadge({ status }: { status: StatementStatus }) {
  return <Badge kind={status === "billed" ? "ok" : statusTone(status)}>{STATEMENT_STATUS_LABELS[status] ?? status}</Badge>;
}

/** The "Sale or return" page: stock by supplier, the balance check, statements and a new statement. */
export function ConsignmentOverview() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const router = useRouter();
  const stock = useLoad(() => api.get<ConsignmentStockDto>("/purchase/consignment/stock"));
  const statements = useLoad(() => api.get<ConsignmentStatementDto[]>("/purchase/consignment/statements"));

  const stockColumns: Column<ConsignmentStockDto["rows"][number]>[] = [
    { key: "supplier", header: "Supplier", render: (r) => r.supplier.name },
    { key: "store", header: "Store", render: (r) => r.store.code },
    { key: "held", header: "Held", align: "right", render: (r) => showQuantity(r.heldQuantity) },
    ...(rights.prices ? [{ key: "heldValue", header: "Held value", align: "right", render: (r: StockFigures) => rupees(r.heldValue) } satisfies Column<ConsignmentStockDto["rows"][number]>] : []),
    { key: "sold", header: "Sold, not settled", align: "right", render: (r) => showQuantity(r.soldNotSettledQuantity) },
    ...(rights.prices
      ? [
          { key: "soldAmount", header: "Sold amount", align: "right", render: (r: StockFigures) => rupees(r.soldNotSettledAmount) } satisfies Column<ConsignmentStockDto["rows"][number]>,
          { key: "owed", header: "Owed on consignment", align: "right", render: (r: StockFigures) => rupees(r.owed) } satisfies Column<ConsignmentStockDto["rows"][number]>,
        ]
      : []),
  ];

  const statementColumns: Column<ConsignmentStatementDto>[] = [
    {
      key: "number",
      header: "Number",
      render: (s) => (
        <Link href={`/purchases/consignment/${s.id}`} className="mono">
          {s.number}
        </Link>
      ),
    },
    { key: "supplier", header: "Supplier", render: (s) => s.supplier.name },
    { key: "store", header: "Store", render: (s) => s.store.code },
    { key: "period", header: "Period", render: (s) => `${formatDate(s.fromDate)} to ${formatDate(s.toDate)}` },
    { key: "status", header: "Status", render: (s) => <StatementStatusBadge status={s.status} /> },
    { key: "bill", header: "Bill", render: (s) => (s.bill ? <Link href={`/purchases/bills/${s.bill.id}`}>{s.bill.number}</Link> : "—") },
    ...(rights.prices ? [{ key: "amount", header: "Amount", align: "right", render: (s: ConsignmentStatementDto) => rupees(s.amount) } satisfies Column<ConsignmentStatementDto>] : []),
  ];

  return (
    <>
      <h1>Sale or return</h1>
      <p className="muted">
        Goods suppliers leave with us on sale or return. They are our stock, but the supplier is owed only for what sells: a statement turns the sold goods into the supplier&apos;s bill, paid as usual.
        Unsold goods go back with a return on the goods receipt.
      </p>
      <h2>Held by supplier</h2>
      <Alert kind="error">{stock.error}</Alert>
      <DataTable columns={stockColumns} rows={stock.data?.rows} rowKey={(r) => `${r.supplier.id}|${r.store.id}`} loading={stock.loading} empty="No sale-or-return goods yet." />
      {stock.data?.check ? (
        stock.data.check.ok ? (
          <p className="muted">Check: the goods agree with the &quot;Owed to suppliers on consignment&quot; account ({rupees(stock.data.check.ledger)}).</p>
        ) : (
          <Alert kind="error">
            The goods say {rupees(stock.data.check.fromGoods)} is owed on consignment but the account shows {rupees(stock.data.check.ledger)} (difference {rupees(stock.data.check.difference)}). Please tell the
            Accountant.
          </Alert>
        )
      ) : null}

      <h2>Statements</h2>
      {rights.bill ? <NewStatementForm onCreated={(s) => router.push(`/purchases/consignment/${s.id}`)} /> : null}
      <Alert kind="error">{statements.error}</Alert>
      <DataTable columns={statementColumns} rows={statements.data} rowKey={(s) => s.id} loading={statements.loading} empty="No statements yet." />
    </>
  );
}

/** Supplier, store and period; the period starts after the last billed statement when no start is given. */
export function NewStatementForm({ onCreated }: { onCreated: (s: ConsignmentStatementDto) => void }) {
  const { user } = useAuth();
  const today = useBusinessToday();
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  const [supplier, setSupplier] = useState<PartyRef | null>(null);
  const [storeId, setStoreId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const store = storeId || defaultStoreId(user, stores);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = { supplierId: supplier?.id, storeId: store || undefined, fromDate: fromDate || undefined, toDate: toDate || today };
    const parsed = createConsignmentStatementSchema.safeParse(body);
    const errs = issuesToFieldErrors(parsed);
    if (!supplier) errs.supplierId = "Choose the supplier";
    setErrors(errs);
    if (!parsed.success || !supplier) return;
    setBusy(true);
    try {
      onCreated(await api.post<ConsignmentStatementDto>("/purchase/consignment/statements", parsed.data));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate aria-label="New statement">
      <div className="form-grid">
        <PartyPicker id="cs-supplier" label="Supplier" kind="supplier" value={supplier} onChange={setSupplier} error={errors.supplierId} />
        <SelectInput id="cs-store" label="Store" value={store} onChange={(e) => setStoreId(e.target.value)} error={errors.storeId} required>
          <option value="">Choose…</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="cs-from" label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} error={errors.fromDate} hint="Leave empty to start after the last billed statement." />
        <TextInput id="cs-to" label="To" type="date" value={toDate || today} max={today || undefined} onChange={(e) => setToDate(e.target.value)} error={errors.toDate} />
      </div>
      <Alert kind="error">{error ?? locations.error}</Alert>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Make statement
        </Button>
      </div>
    </form>
  );
}

/** One statement: what was received, sold, returned and held; Make bill and Cancel. */
export function ConsignmentStatementView({ statement: s, onChanged }: { statement: ConsignmentStatementDto; onChanged: (s: ConsignmentStatementDto) => void }) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const [billOpen, setBillOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const columns: Column<ConsignmentStatementDto["lines"][number]>[] = [
    { key: "item", header: "Item", render: (l) => `${l.item.code} ${l.item.name}` },
    { key: "received", header: "Received", align: "right", render: (l) => showQuantity(l.received) },
    { key: "sold", header: "Sold", align: "right", render: (l) => showQuantity(l.sold) },
    { key: "returned", header: "Returned", align: "right", render: (l) => showQuantity(l.returned) },
    { key: "held", header: "Held", align: "right", render: (l) => showQuantity(l.held) },
    ...(rights.prices
      ? [
          { key: "rate", header: "Agreed rate", align: "right", render: (l: ConsignmentStatementDto["lines"][number]) => rupees(l.rate) } satisfies Column<ConsignmentStatementDto["lines"][number]>,
          { key: "amount", header: "Amount", align: "right", render: (l: ConsignmentStatementDto["lines"][number]) => rupees(l.amount) } satisfies Column<ConsignmentStatementDto["lines"][number]>,
        ]
      : []),
  ];

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Sale-or-return statement {s.number}</h1>
        <StatementStatusBadge status={s.status} />
      </div>
      <p>
        {s.supplier.name}, store {s.store.code}, {formatDate(s.fromDate)} to {formatDate(s.toDate)}.
        {s.bill ? (
          <>
            {" "}
            Bill <Link href={`/purchases/bills/${s.bill.id}`}>{s.bill.number}</Link>
            {s.bill.total ? ` for ${rupees(s.bill.total)}` : ""}.
          </>
        ) : null}
      </p>
      <DataTable columns={columns} rows={s.lines} rowKey={(l) => `${l.item.id}|${l.rate ?? ""}`} empty="Nothing on this statement." />
      {rights.prices ? (
        <p>
          <strong>Amount for the sold goods: {rupees(s.amount)}</strong>
        </p>
      ) : null}
      <p className="muted">Sold counts till sales not settled by an earlier statement (sale-or-return goods are sold first, oldest first). Held is what is still in the shop at the end of the period.</p>
      <div className="actions">
        {s.status === "draft" && rights.bill ? (
          <Button variant="primary" onClick={() => setBillOpen(true)}>
            Make bill
          </Button>
        ) : null}
        {s.status !== "cancelled" && rights.bill ? (
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            Cancel statement
          </Button>
        ) : null}
      </div>
      <MakeBillDialog open={billOpen} statement={s} onClose={() => setBillOpen(false)} onDone={onChanged} />
      <ReasonDialog<ConsignmentStatementDto>
        open={cancelOpen}
        title={`Cancel statement ${s.number}`}
        explanation={
          s.status === "billed"
            ? "Its supplier bill is cancelled too, so the sold goods are owed on consignment again. A bill with payments linked cannot be cancelled until the links are undone."
            : "The draft is set aside. Nothing has been billed."
        }
        path={`/purchase/consignment/statements/${s.id}/cancel`}
        confirmLabel="Cancel statement"
        danger
        onClose={() => setCancelOpen(false)}
        onDone={onChanged}
      />
    </div>
  );
}

function MakeBillDialog({ open, statement, onClose, onDone }: { open: boolean; statement: ConsignmentStatementDto; onClose: () => void; onDone: (s: ConsignmentStatementDto) => void }) {
  const today = useBusinessToday();
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = consignmentBillSchema.safeParse({ supplierBillNo: billNo.trim() || null, supplierBillDate: billDate || undefined });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      onDone(await api.post<ConsignmentStatementDto>(`/purchase/consignment/statements/${statement.id}/bill`, parsed.data));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={`Make the bill for ${statement.number}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <p>The sold goods are worked out again (late till bills included) and become {statement.supplier.name}&apos;s bill, owed and paid as usual.</p>
        <TextInput id="cs-bill-no" label="Supplier's bill number" value={billNo} onChange={(e) => setBillNo(e.target.value)} error={errors.supplierBillNo} maxLength={60} hint={`Leave empty to use ${statement.number}.`} />
        <TextInput id="cs-bill-date" label="Supplier's bill date" type="date" value={billDate || today} max={today || undefined} onChange={(e) => setBillDate(e.target.value)} error={errors.supplierBillDate} />
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Make bill
          </Button>
          <Button onClick={onClose}>Go back</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Loads one statement (for the detail route). */
export function useStatement(id: string) {
  return useLoad(() => api.get<ConsignmentStatementDto>(`/purchase/consignment/statements/${id}`), [id]);
}
