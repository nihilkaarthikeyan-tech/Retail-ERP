// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { Decimal, paymentSchema } from "shared";
import { PartyPicker } from "@/components/parties/party-picker";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, Field, RadioInput, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type AccountDto, accountRights, type BankAccountDto, dec, documentLabel, type OpenItemDto, PAYMENT_KIND_LABELS, type PaymentDto, type PaymentKind, partyFor, postable, previewOldestFirst, sum } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { useBusinessToday } from "@/lib/stock";
import { rupees } from "@/lib/purchasing";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { AccountSelect, useChart, useOpenItems, usePartyNames } from "./accounts-shared";

interface DeductionForm {
  key: string;
  accountId: string;
  amount: string;
  remark: string;
}

let seq = 0;
const newDeduction = (over: Partial<DeductionForm> = {}): DeductionForm => ({ key: `d${++seq}`, accountId: "", amount: "", remark: "", ...over });

const itemKey = (i: Pick<OpenItemDto, "itemType" | "itemId">) => `${i.itemType}|${i.itemId}`;

interface SettleTableProps {
  items: OpenItemDto[];
  covers: Decimal;
  mode: "auto" | "manual";
  manual: Record<string, string>;
  onManual: (key: string, value: string) => void;
}

/** The party's unpaid bills with what each still owes, and what this payment settles on each. */
export function SettleTable({ items, covers, mode, manual, onManual }: SettleTableProps) {
  const preview = previewOldestFirst(covers, items);
  const allocated = mode === "auto" ? sum(preview.rows.map((r) => r.amount.toFixed(2))) : sum(Object.values(manual));
  const unused = covers.sub(allocated);
  const credits = items.filter((i) => dec(i.owed).lt(0));
  return (
    <>
      <div className="table-wrap">
        <table className="table" aria-label="Unpaid bills">
          <thead>
            <tr>
              <th scope="col">Bill</th>
              <th scope="col">Date</th>
              <th scope="col">Due</th>
              <th scope="col" className="num">
                Bill amount
              </th>
              <th scope="col" className="num">
                Still owed
              </th>
              <th scope="col" className="num">
                This settles
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No unpaid bills. The whole amount is kept as an advance.
                </td>
              </tr>
            ) : (
              preview.rows.map((r) => {
                const k = itemKey(r.item);
                return (
                  <tr key={k}>
                    <td>
                      {documentLabel(r.item.itemType)} <span className="mono">{r.item.number ?? ""}</span>
                    </td>
                    <td>{formatDate(r.item.date)}</td>
                    <td>{formatDate(r.item.dueDate)}</td>
                    <td className="num">{rupees(r.item.amount)}</td>
                    <td className="num">{rupees(r.item.owed)}</td>
                    <td className="num">
                      {mode === "auto" ? (
                        <span aria-label={`Settles on ${r.item.number ?? k}`}>{r.amount.isZero() ? "—" : rupees(r.amount.toFixed(2))}</span>
                      ) : (
                        <input className="input" inputMode="decimal" aria-label={`Amount for ${r.item.number ?? k}`} value={manual[k] ?? ""} onChange={(e) => onManual(k, e.target.value)} />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <dl className="kv" aria-label="Settlement summary">
        <dt>Settled against bills</dt>
        <dd>{rupees(allocated.toFixed(2))}</dd>
        <dt>Left as an advance (unused)</dt>
        <dd className={unused.lt(0) ? "num-negative" : undefined}>{unused.lt(0) ? `${rupees(unused.neg().toFixed(2))} more than the payment covers` : rupees(unused.toFixed(2))}</dd>
      </dl>
      {credits.length > 0 ? <p className="muted">Unused from earlier: {rupees(sum(credits.map((c) => dec(c.owed).neg().toFixed(2))).toFixed(2))}. It can be linked to bills from that payment&apos;s page.</p> : null}
    </>
  );
}

interface PaymentFormProps {
  payment: PaymentDto | null;
  onSaved: (payment: PaymentDto) => void;
  onClose?: () => void;
}

/** New or draft receipt, payment or transfer. */
export function PaymentForm({ payment, onSaved, onClose }: PaymentFormProps) {
  const { user } = useAuth();
  const rights = accountRights(user);
  const chart = useChart();
  const banks = useLoad(() => api.get<BankAccountDto[]>("/bank-accounts"));
  const { stores } = useOrderStores();
  const kinds: PaymentKind[] = rights.makePayments ? ["receipt", "payment", "transfer"] : ["transfer"];
  const [chosenKind, setKind] = useState<PaymentKind | null>(payment?.kind ?? null);
  // The rights are known only once the user has loaded; a kind the user may not use falls back to the first allowed.
  const kind: PaymentKind = chosenKind && kinds.includes(chosenKind) ? chosenKind : kinds[0];
  const today = useBusinessToday();
  const [dateTyped, setPaymentDate] = useState(payment?.paymentDate ?? "");
  // Blank means today (Indian business date, read in the browser).
  const paymentDate = dateTyped || today;
  const [storeId, setStoreId] = useState(payment?.storeId ?? "");
  const [party, setParty] = useState<PartyRef | null>(null);
  const [partyId, setPartyId] = useState(payment?.partyId ?? "");
  const [fromAccountId, setFrom] = useState(payment?.fromAccountId ?? "");
  const [toAccountId, setTo] = useState(payment?.toAccountId ?? "");
  const [amount, setAmount] = useState(payment?.amount ?? "");
  const [reference, setReference] = useState(payment?.reference ?? "");
  const [referenceDate, setReferenceDate] = useState(payment?.referenceDate ?? "");
  const [remark, setRemark] = useState(payment?.remark ?? "");
  const [deductions, setDeductions] = useState<DeductionForm[]>(() => (payment?.deductions ?? []).map((d) => newDeduction({ accountId: d.accountId, amount: d.amount, remark: d.remark ?? "" })));
  const [mode, setMode] = useState<"auto" | "manual">(payment && payment.allocations.length ? "manual" : "auto");
  const [manual, setManual] = useState<Record<string, string>>(() => Object.fromEntries((payment?.allocations ?? []).map((a) => [`${a.billType}|${a.billId}`, a.amount])));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "post" | null>(null);

  const partyType = kind === "receipt" ? "customer" : kind === "payment" ? "supplier" : null;
  const names = usePartyNames([{ type: payment?.partyType ?? null, id: payment?.partyId ?? null }]);
  const shownParty = partyId ? (party ?? names[partyId] ?? { id: partyId, code: "…", name: "" }) : null;
  const items = useOpenItems(partyType, partyId || null);

  const storeIds = new Set(stores.map((s) => s.id));
  const usable = postable(chart.data?.accounts ?? []).filter((a) => !a.storeId || storeIds.has(a.storeId));
  const cashOrBank = usable.filter((a) => a.kind === "cash" || a.kind === "bank");
  const transferAccounts = rights.makePayments ? usable.filter((a) => !partyFor(a)) : cashOrBank;
  const deductionAccounts = usable.filter((a) => !partyFor(a));
  const byId = (id: string): AccountDto | undefined => chart.data?.accounts.find((a) => a.id === id);
  const bankChosen = [kind !== "receipt" ? fromAccountId : "", kind !== "payment" ? toAccountId : ""].some((id) => byId(id)?.kind === "bank");
  const deducted = sum(deductions.map((d) => d.amount));
  const covers = dec(amount).add(deducted);

  function changeKind(k: PaymentKind) {
    setKind(k);
    setParty(null);
    setPartyId("");
    setManual({});
    setFrom("");
    setTo("");
    // The main bank account is offered first.
    const main = banks.data?.find((b) => b.isDefault && b.active)?.account.id ?? "";
    if (k === "receipt") setTo(main);
    if (k === "payment") setFrom(main);
  }

  function body() {
    const allocations = Object.entries(manual)
      .filter(([, v]) => dec(v).gt(0))
      .map(([k, v]) => {
        const [billType, billId] = k.split("|");
        return { billType, billId, amount: v.trim() };
      });
    return {
      kind,
      paymentDate,
      storeId: storeId || null,
      partyType: partyType && partyId ? partyType : null,
      partyId: partyType && partyId ? partyId : null,
      fromAccountId: kind === "receipt" ? null : fromAccountId || null,
      toAccountId: kind === "payment" ? null : toAccountId || null,
      amount: amount.trim(),
      reference: blankToNull(reference),
      referenceDate: referenceDate || null,
      remark: blankToNull(remark),
      ...(kind !== "transfer" && mode === "manual" ? { allocations, autoSettle: false } : { autoSettle: kind !== "transfer" }),
      deductions: deductions.filter((d) => d.accountId || d.amount.trim()).map((d) => ({ accountId: d.accountId, amount: d.amount.trim(), remark: blankToNull(d.remark) })),
    };
  }

  async function submit(post: boolean) {
    setError(null);
    const input = body();
    const parsed = paymentSchema.safeParse(input);
    const errs = issuesToFieldErrors(parsed);
    if (partyType && !partyId) errs.partyId = `Choose the ${partyType}`;
    if (bankChosen && kind !== "transfer") {
      if (!reference.trim()) errs.reference = "A bank receipt or payment needs the cheque or transfer number";
      if (!referenceDate) errs.referenceDate = "And its date";
    }
    input.deductions.forEach((d, i) => {
      if (!d.accountId) errs[`deductions.${i}.accountId`] = "Choose the account";
    });
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) {
      setError(errs[""] ?? "Please check the marked fields.");
      return;
    }
    setBusy(post ? "post" : "draft");
    try {
      let saved = payment ? await api.patch<PaymentDto>(`/payments/${payment.id}`, parsed.data) : await api.post<PaymentDto>("/payments", parsed.data);
      if (post) {
        try {
          saved = await api.post<PaymentDto>(`/payments/${saved.id}/post`);
        } catch (err) {
          onSaved(saved);
          throw err;
        }
      }
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const deductionHint =
    kind === "receipt"
      ? "Bank charges, card commission, or a few rupees the customer did not pay. They settle more of the customer's bills."
      : kind === "payment"
        ? "A discount the supplier gave, or a small amount not paid. They settle more of the supplier's bills."
        : "Bank or card commission taken out of the payout. The receiving account gets the amount less these.";

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(false);
      }}
      noValidate
    >
      <h1>{payment ? "Change draft" : "New receipt, payment or transfer"}</h1>
      <Alert kind="error">{error ?? chart.error ?? banks.error}</Alert>
      <Field id="pay-kind" label="What is it">
        <div id="pay-kind" role="radiogroup" aria-label="What is it">
          {kinds.map((k) => (
            <RadioInput key={k} id={`pay-kind-${k}`} name="pay-kind" label={PAYMENT_KIND_LABELS[k]} checked={kind === k} disabled={!!payment} onChange={() => changeKind(k)} />
          ))}
        </div>
      </Field>
      {kind === "transfer" ? <p className="muted">A card or UPI payout is a transfer from Card settlement (or UPI settlement) to the bank, with the commission as a deduction.</p> : null}

      <div className="form-grid">
        <TextInput id="pay-date" label="Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} error={errors.paymentDate} required />
        <SelectInput id="pay-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} error={errors.storeId} hint="Which shop the money belongs to. Leave empty for the head office.">
          <option value="">Head office / not a store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        {partyType ? (
          <div className="span-2">
            <PartyPicker
              id="pay-party"
              label={partyType === "customer" ? "Customer" : "Supplier"}
              kind={partyType}
              value={shownParty}
              onChange={(p) => {
                setParty(p);
                setPartyId(p?.id ?? "");
                setManual({});
              }}
              error={errors.partyId}
            />
          </div>
        ) : null}
        {kind !== "receipt" ? (
          <AccountSelect
            id="pay-from"
            label={kind === "transfer" ? "From account" : "Money comes from"}
            accounts={kind === "transfer" ? transferAccounts : cashOrBank}
            value={fromAccountId}
            onChange={setFrom}
            error={errors.fromAccountId}
            required
            hint={kind === "transfer" ? "For a card payout: Card settlement." : "The cash or bank account it is paid from."}
          />
        ) : null}
        {kind !== "payment" ? (
          <AccountSelect
            id="pay-to"
            label={kind === "transfer" ? "To account" : "Money goes into"}
            accounts={kind === "transfer" ? transferAccounts : cashOrBank}
            value={toAccountId}
            onChange={setTo}
            error={errors.toAccountId}
            required
            hint={kind === "transfer" ? "For a card payout: the bank account." : "The cash or bank account it is received into."}
          />
        ) : null}
        <TextInput id="pay-amount" label={kind === "transfer" ? "Amount sent" : "Amount"} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} required hint={kind === "transfer" ? "The full amount, before the commission." : "The money that actually moves."} />
        {bankChosen || kind === "transfer" ? (
          <>
            <TextInput id="pay-ref" label="Cheque or transfer number" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} required={bankChosen && kind !== "transfer"} />
            <TextInput id="pay-ref-date" label="Its date" type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} error={errors.referenceDate} required={bankChosen && kind !== "transfer"} />
          </>
        ) : null}
        <div className="span-2">
          <TextareaInput id="pay-remark" label="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} error={errors.remark} maxLength={300} />
        </div>
      </div>

      <h2>Deductions</h2>
      <p className="muted">{deductionHint}</p>
      {deductions.map((d, i) => (
        <div className="filter-row" key={d.key}>
          <AccountSelect id={`ded-account-${d.key}`} label={`Deduction ${i + 1}: account`} accounts={deductionAccounts} value={d.accountId} onChange={(v) => setDeductions((ds) => ds.map((x) => (x.key === d.key ? { ...x, accountId: v } : x)))} error={errors[`deductions.${i}.accountId`]} />
          <TextInput id={`ded-amount-${d.key}`} label="Amount" inputMode="decimal" value={d.amount} onChange={(e) => setDeductions((ds) => ds.map((x) => (x.key === d.key ? { ...x, amount: e.target.value } : x)))} error={errors[`deductions.${i}.amount`]} />
          <TextInput id={`ded-remark-${d.key}`} label="Remark" value={d.remark} maxLength={200} onChange={(e) => setDeductions((ds) => ds.map((x) => (x.key === d.key ? { ...x, remark: e.target.value } : x)))} />
          <Button size="small" variant="link" aria-label={`Remove deduction ${i + 1}`} onClick={() => setDeductions((ds) => ds.filter((x) => x.key !== d.key))}>
            ✕
          </Button>
        </div>
      ))}
      <div className="toolbar">
        <Button size="small" disabled={deductions.length >= 10} onClick={() => setDeductions((ds) => [...ds, newDeduction()])}>
          Add a deduction
        </Button>
        {deductions.length > 0 ? <span className="muted">Deductions: {rupees(deducted.toFixed(2))}</span> : null}
      </div>

      {partyType && partyId ? (
        <>
          <h2>Bills it settles</h2>
          <div className="toolbar" role="radiogroup" aria-label="How to settle bills">
            <RadioInput id="settle-auto" name="settle-mode" label="Oldest bills first" checked={mode === "auto"} onChange={() => setMode("auto")} />
            <RadioInput id="settle-manual" name="settle-mode" label="I will type the amount for each bill" checked={mode === "manual"} onChange={() => setMode("manual")} />
          </div>
          <Alert kind="error">{items.error}</Alert>
          {items.data ? <SettleTable items={items.data} covers={covers} mode={mode} manual={manual} onManual={(k, v) => setManual((m) => ({ ...m, [k]: v }))} /> : <p className="muted">Loading the unpaid bills…</p>}
        </>
      ) : null}

      <div className="actions">
        <Button type="submit" busy={busy === "draft"} disabled={busy !== null}>
          Save as draft
        </Button>
        <Button variant="primary" busy={busy === "post"} disabled={busy !== null} onClick={() => void submit(true)}>
          Post
        </Button>
        {onClose ? (
          <Button onClick={onClose} disabled={busy !== null}>
            Go back
          </Button>
        ) : null}
      </div>
      <p className="muted">Posting writes it to the books. After that it can only be cancelled, never changed.</p>
    </form>
  );
}
