// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { type JournalKind, journalSchema } from "shared";
import { PartyPicker } from "@/components/parties/party-picker";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type AccountDto, accountRights, balancingAmounts, dec, documentLabel, JOURNAL_FORM_KINDS, JOURNAL_KIND_LABELS, type JournalDto, journalTotals, needsStore, partyFor, postable, unpaidBills } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { useBusinessToday } from "@/lib/stock";
import { rupees } from "@/lib/purchasing";
import type { PartyRef } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { AccountOptions, AccountSelect, useChart, useOpenItems, usePartyNames } from "./accounts-shared";

export interface JournalLineForm {
  key: string;
  accountId: string;
  storeId: string;
  partyId: string;
  party: PartyRef | null;
  debit: string;
  credit: string;
  /** "billType|billId" of the bill this line settles, or "". */
  against: string;
  remark: string;
}

let lineSeq = 0;
function newLine(over: Partial<JournalLineForm> = {}): JournalLineForm {
  lineSeq += 1;
  return { key: `l${lineSeq}`, accountId: "", storeId: "", partyId: "", party: null, debit: "", credit: "", against: "", remark: "", ...over };
}

function linesOf(journal: JournalDto | null): JournalLineForm[] {
  if (!journal) return [newLine(), newLine()];
  return journal.lines.map((l) =>
    newLine({
      accountId: l.accountId,
      storeId: l.storeId ?? "",
      partyId: l.partyId ?? "",
      debit: dec(l.debit).isZero() ? "" : l.debit,
      credit: dec(l.credit).isZero() ? "" : l.credit,
      against: l.againstType && l.againstId ? `${l.againstType}|${l.againstId}` : "",
      remark: l.remark ?? "",
    }),
  );
}

/** The bill a line settles: the party's unpaid bills, loaded when the party is chosen. */
function AgainstBill({ index, partyType, partyId, value, onChange }: { index: number; partyType: "customer" | "supplier" | null; partyId: string; value: string; onChange: (v: string) => void }) {
  const items = useOpenItems(partyType, partyId || null);
  if (!partyType || !partyId) return <span className="muted">—</span>;
  const bills = unpaidBills(items.data ?? []);
  return (
    <select className="input" aria-label={`Against bill, line ${index + 1}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{items.loading ? "Loading…" : "Not against a bill"}</option>
      {bills.map((b) => (
        <option key={`${b.itemType}|${b.itemId}`} value={`${b.itemType}|${b.itemId}`}>
          {documentLabel(b.itemType)} {b.number ?? ""} of {formatDate(b.date)}, owes {rupees(b.owed)}
        </option>
      ))}
    </select>
  );
}

interface JournalFormProps {
  journal: JournalDto | null;
  /** Kind to start a new journal with (for example "opening"). */
  presetKind?: JournalKind;
  onSaved: (journal: JournalDto) => void;
  onClose?: () => void;
  /** For tests: the accounts, instead of loading the chart. */
  accounts?: AccountDto[];
}

/** New or draft journal: lines with live totals, a "balance against…" helper, save as draft or post. */
export function JournalForm({ journal, presetKind, onSaved, onClose, accounts: given }: JournalFormProps) {
  const { user } = useAuth();
  const rights = accountRights(user);
  const chart = useChart();
  const { stores } = useOrderStores();
  const kinds: JournalKind[] = rights.cashJournalsOnly ? ["cash"] : [...JOURNAL_FORM_KINDS];
  const [chosenKind, setKind] = useState<JournalKind | null>(journal?.kind ?? presetKind ?? null);
  // The rights are known only once the user has loaded; a kind the user may not use falls back to the first allowed.
  const kind: JournalKind = chosenKind && kinds.includes(chosenKind) ? chosenKind : kinds[0];
  const today = useBusinessToday();
  const [dateTyped, setJournalDate] = useState(journal?.journalDate ?? "");
  // Blank means today (Indian business date, read in the browser).
  const journalDate = dateTyped || today;
  const [reference, setReference] = useState(journal?.reference ?? "");
  const [referenceDate, setReferenceDate] = useState(journal?.referenceDate ?? "");
  const [remark, setRemark] = useState(journal?.remark ?? "");
  const [lines, setLines] = useState<JournalLineForm[]>(() => linesOf(journal));
  const [balanceAccount, setBalanceAccount] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "post" | null>(null);
  const names = usePartyNames(lines.map((l) => ({ type: partyFor(accountById(l.accountId)), id: l.partyId || null })));

  const all = given ?? chart.data?.accounts ?? [];
  const usable = postable(all).filter((a) => !rights.cashJournalsOnly || !partyFor(a));
  function accountById(id: string): AccountDto | undefined {
    return (given ?? chart.data?.accounts ?? []).find((a) => a.id === id);
  }
  const totals = journalTotals(lines);

  function update(key: string, patch: Partial<JournalLineForm>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function setAccount(l: JournalLineForm, accountId: string) {
    const before = partyFor(accountById(l.accountId));
    const after = partyFor(accountById(accountId));
    // A different kind of party (or none) clears the party and the bill.
    update(l.key, before === after ? { accountId } : { accountId, partyId: "", party: null, against: "" });
  }

  function setAmount(l: JournalLineForm, side: "debit" | "credit", value: string) {
    // A line is either a debit or a credit: typing one clears the other.
    const other = side === "debit" ? "credit" : "debit";
    update(l.key, dec(value).isZero() ? { [side]: value } : { [side]: value, [other]: "" });
  }

  function addBalancingLine() {
    if (!balanceAccount || totals.difference.isZero()) return;
    setLines((ls) => [...ls.filter((l) => l.accountId || l.debit || l.credit), newLine({ accountId: balanceAccount, ...balancingAmounts(totals.difference) })]);
    setBalanceAccount("");
  }

  function input() {
    return {
      kind,
      journalDate,
      reference: blankToNull(reference),
      referenceDate: referenceDate || null,
      remark: blankToNull(remark),
      lines: lines
        .filter((l) => l.accountId || l.debit.trim() || l.credit.trim())
        .map((l) => {
          const [againstType, againstId] = l.against ? l.against.split("|") : [null, null];
          const party = partyFor(accountById(l.accountId));
          return {
            accountId: l.accountId,
            storeId: l.storeId || null,
            partyType: party && l.partyId ? party : null,
            partyId: party && l.partyId ? l.partyId : null,
            debit: l.debit.trim() || null,
            credit: l.credit.trim() || null,
            againstType,
            againstId,
            remark: blankToNull(l.remark),
          };
        }),
    };
  }

  async function submit(post: boolean) {
    setError(null);
    const body = input();
    const parsed = journalSchema.safeParse(body);
    const errs = issuesToFieldErrors(parsed);
    body.lines.forEach((l, i) => {
      const a = accountById(l.accountId);
      if (!l.accountId) errs[`lines.${i}.accountId`] = "Choose an account";
      else if (partyFor(a) && !l.partyId) errs[`lines.${i}.partyId`] = `Choose the ${partyFor(a)}`;
      if (needsStore(a) && !l.storeId) errs[`lines.${i}.storeId`] = "Choose the store";
    });
    if (post && !totals.balanced) errs.balance = "Debits and credits must be equal before posting.";
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) {
      setError(errs.lines ?? errs.balance ?? "Please check the marked fields.");
      return;
    }
    setBusy(post ? "post" : "draft");
    try {
      let saved = journal ? await api.patch<JournalDto>(`/journals/${journal.id}`, parsed.data) : await api.post<JournalDto>("/journals", parsed.data);
      if (post) {
        try {
          saved = await api.post<JournalDto>(`/journals/${saved.id}/post`);
        } catch (err) {
          // Saved as a draft but not posted: show the draft with the reason.
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

  const lineError = (i: number, field: string) => errors[`lines.${i}.${field}`] ?? (field === "debit" ? errors[`lines.${i}`] : undefined);

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(false);
      }}
      noValidate
    >
      <h1>{journal ? "Change draft journal" : "New journal"}</h1>
      <Alert kind="error">{error ?? chart.error}</Alert>
      <div className="form-grid">
        <SelectInput id="jv-kind" label="What is it for" value={kind} onChange={(e) => setKind(e.target.value as JournalKind)} disabled={kinds.length === 1}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {JOURNAL_KIND_LABELS[k]}
            </option>
          ))}
        </SelectInput>
        <TextInput id="jv-date" label="Date" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} error={errors.journalDate} required />
        <TextInput id="jv-ref" label="Reference" hint="Voucher, cheque or bill number, if any." value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} />
        <TextInput id="jv-ref-date" label="Reference date" type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} error={errors.referenceDate} />
        <div className="span-2">
          <TextareaInput id="jv-remark" label="What happened" hint="In plain words, for whoever reads the books later." value={remark} onChange={(e) => setRemark(e.target.value)} error={errors.remark} maxLength={300} />
        </div>
      </div>
      {kind === "opening" ? <Alert kind="info">An opening journal brings in balances from before going live. Put the other side of every balance on the Temporary opening account; it must end at zero.</Alert> : null}
      {rights.cashJournalsOnly ? <p className="muted">You can record cash spent or received at your own stores. Customer and supplier balances are for the Accountant.</p> : null}

      <div className="table-wrap line-grid">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">#</th>
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
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const account = accountById(l.accountId);
              const party = partyFor(account);
              const shownParty = l.partyId ? (l.party ?? names[l.partyId] ?? { id: l.partyId, code: "…", name: "" }) : null;
              return (
                <tr key={l.key}>
                  <td>{i + 1}</td>
                  <td>
                    <select className="input" aria-label={`Account, line ${i + 1}`} aria-invalid={lineError(i, "accountId") ? true : undefined} value={l.accountId} onChange={(e) => setAccount(l, e.target.value)}>
                      <AccountOptions accounts={usable} />
                    </select>
                    {lineError(i, "accountId") ? <p className="field-error">{lineError(i, "accountId")}</p> : null}
                  </td>
                  <td>
                    <select className="input" aria-label={`Store, line ${i + 1}`} value={l.storeId} onChange={(e) => update(l.key, { storeId: e.target.value })}>
                      <option value="">{needsStore(account) ? "Choose" : "None"}</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code}
                        </option>
                      ))}
                    </select>
                    {lineError(i, "storeId") ? <p className="field-error">{lineError(i, "storeId")}</p> : null}
                  </td>
                  <td>
                    {party ? (
                      <PartyPicker
                        id={`jv-party-${l.key}`}
                        label={party === "customer" ? "Customer" : "Supplier"}
                        kind={party}
                        value={shownParty}
                        onChange={(p) => update(l.key, { partyId: p?.id ?? "", party: p, against: "" })}
                        error={lineError(i, "partyId")}
                        hint="Type two letters to search."
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">
                    <input className="input" inputMode="decimal" aria-label={`Debit, line ${i + 1}`} value={l.debit} onChange={(e) => setAmount(l, "debit", e.target.value)} />
                    {lineError(i, "debit") ? <p className="field-error">{lineError(i, "debit")}</p> : null}
                  </td>
                  <td className="num">
                    <input className="input" inputMode="decimal" aria-label={`Credit, line ${i + 1}`} value={l.credit} onChange={(e) => setAmount(l, "credit", e.target.value)} />
                    {lineError(i, "credit") ? <p className="field-error">{lineError(i, "credit")}</p> : null}
                  </td>
                  <td>
                    <AgainstBill index={i} partyType={party} partyId={l.partyId} value={l.against} onChange={(v) => update(l.key, { against: v })} />
                  </td>
                  <td>
                    <input className="input" aria-label={`Remark, line ${i + 1}`} value={l.remark} maxLength={200} onChange={(e) => update(l.key, { remark: e.target.value })} />
                  </td>
                  <td>
                    <Button size="small" variant="link" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      ✕
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <strong>Totals</strong>
              </td>
              <td className="num" aria-label="Total debits">
                <strong>{rupees(totals.debit.toFixed(2))}</strong>
              </td>
              <td className="num" aria-label="Total credits">
                <strong>{rupees(totals.credit.toFixed(2))}</strong>
              </td>
              <td colSpan={3}>
                {totals.debit.isZero() && totals.credit.isZero() ? (
                  <span className="muted">Nothing entered yet</span>
                ) : totals.difference.isZero() ? (
                  <span>Balanced</span>
                ) : (
                  <span className="num-negative" aria-label="Difference">
                    Difference {rupees(totals.difference.abs().toFixed(2))} ({totals.difference.gt(0) ? "credits are short" : "debits are short"})
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="toolbar">
        <Button size="small" onClick={() => setLines((ls) => [...ls, newLine()])}>
          Add a line
        </Button>
        <span className="spacer" />
        <div style={{ minWidth: 260 }}>
          <AccountSelect id="jv-balance-account" label="Balance against…" accounts={usable} value={balanceAccount} onChange={setBalanceAccount} hint="Adds a line with the difference to this account." />
        </div>
        <Button size="small" disabled={!balanceAccount || totals.difference.isZero()} onClick={addBalancingLine}>
          Add the difference
        </Button>
      </div>
      <div className="actions">
        <Button type="submit" busy={busy === "draft"} disabled={busy !== null}>
          Save as draft
        </Button>
        <Button variant="primary" busy={busy === "post"} disabled={!totals.balanced || busy !== null} onClick={() => void submit(true)}>
          Post
        </Button>
        {onClose ? (
          <Button onClick={onClose} disabled={busy !== null}>
            Go back
          </Button>
        ) : null}
      </div>
      {!totals.balanced ? <p className="muted">Post becomes available when debits and credits are equal.</p> : <p className="muted">Posting writes the entry to the books. After that it can only be cancelled, never changed.</p>}
    </form>
  );
}
