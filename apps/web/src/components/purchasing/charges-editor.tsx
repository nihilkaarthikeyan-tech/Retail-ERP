// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { CHARGE_TYPES, Decimal, landedChargeSchema, manualSharesProblem } from "shared";
import { Alert, Button, CheckInput, DataTable, RadioInput, TextareaInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { CHARGE_TYPE_LABELS, type ChargePreview, type GoodsReceiptDto, type GoodsReceiptHeader, type LandedChargeDto, type Page, purchaseRights, rupees } from "@/lib/purchasing";
import { showQuantity, useBusinessToday } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

type ShareBy = "quantity" | "value" | "manual";

interface ChargeRow {
  key: string;
  description: string;
  chargeType: string;
  amount: string;
}

let keySeq = 0;
function newCharge(): ChargeRow {
  keySeq += 1;
  return { key: `charge-${keySeq}`, description: "", chargeType: "freight", amount: "" };
}

function parse(text: string): Decimal | null {
  try {
    const d = new Decimal(text.trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Sum of the typed charge amounts; blanks and typos count as zero (they are reported separately). */
export function chargesTotal(rows: { amount: string }[]): Decimal {
  return rows.reduce((s, r) => s.add(parse(r.amount) ?? 0), new Decimal(0));
}

const SHARE_LABELS: Record<ShareBy, { label: string; description: string }> = {
  quantity: { label: "By quantity", description: "Each line gets a share in proportion to the units received." },
  value: { label: "By value", description: "Each line gets a share in proportion to its amount before GST." },
  manual: { label: "By hand", description: "Type the amount for each line; they must add up to the total (within ₹0.02)." },
};

/** Finalised goods receipts that can take extra charges (not returns). */
function useChargeableReceipts() {
  return useLoad(async () => {
    const statuses = ["to_bill", "partly_billed", "completed"] as const;
    const pages = await Promise.all(statuses.map((status) => api.get<Page<GoodsReceiptHeader>>(`/purchase/receipts${query({ status, isReturn: "false", pageSize: 200 })}`)));
    return pages.flatMap((p) => p.rows).sort((a, b) => b.postingDate.localeCompare(a.postingDate) || b.number.localeCompare(a.number));
  });
}

interface ChargesEditorProps {
  onSaved: (charge: LandedChargeDto) => void;
}

/** New extra-charge entry: pick receipts, enter the charges, choose how to share, preview, save. */
export function ChargesEditor({ onSaved }: ChargesEditorProps) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const today = useBusinessToday();
  const receipts = useChargeableReceipts();
  const [chosen, setChosen] = useState<string[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>(() => [newCharge()]);
  const [shareBy, setShareBy] = useState<ShareBy>("value");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [postingDate, setPostingDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const details = useLoad<GoodsReceiptDto[]>(
    () => (shareBy === "manual" ? Promise.all(chosen.map((id) => api.get<GoodsReceiptDto>(`/purchase/receipts/${id}`))) : Promise.resolve([])),
    [shareBy, chosen.join(",")],
  );
  const manualLines = (details.data ?? []).flatMap((r) => r.lines.map((l) => ({ ...l, receiptNumber: r.number })));
  const total = chargesTotal(charges);
  const manualSum = manualLines.reduce((s, l) => s.add(parse(manual[l.id] ?? "") ?? 0), new Decimal(0));

  function changed() {
    setPreview(null);
    setError(null);
  }

  function toggle(id: string, on: boolean) {
    setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));
    changed();
  }

  function updateCharge(key: string, patch: Partial<ChargeRow>) {
    setCharges((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    changed();
  }

  /** Checks everything locally; returns the body, or null (and shows why). */
  function prepare(): Record<string, unknown> | null {
    setError(null);
    if (chosen.length === 0) {
      setError("Tick at least one goods receipt.");
      return null;
    }
    const problems: string[] = [];
    charges.forEach((c, i) => {
      if (!c.description.trim()) problems.push(`Charge ${i + 1}: describe it (for example "Lorry freight")`);
      const a = parse(c.amount);
      if (!a || a.lte(0)) problems.push(`Charge ${i + 1}: the amount must be more than zero`);
    });
    if (charges.length === 0) problems.push("Add at least one charge");
    let manualShares: { receiptLineId: string; amount: string }[] | undefined;
    if (shareBy === "manual") {
      const amounts = manualLines.map((l) => (manual[l.id] ?? "").trim() || "0");
      if (amounts.some((a) => parse(a) === null)) problems.push("Every share must be a number");
      else {
        const p = manualSharesProblem(total, amounts);
        if (p) problems.push(p);
      }
      manualShares = manualLines.map((l, i) => ({ receiptLineId: l.id, amount: amounts[i] })).filter((s) => parse(s.amount)?.gt(0));
    }
    if (postingDate && today && postingDate > today) problems.push("The date cannot be in the future");
    if (problems.length) {
      setError(problems.join("; "));
      return null;
    }
    const parsed = landedChargeSchema.safeParse({
      postingDate: postingDate || undefined,
      shareBy,
      receiptIds: chosen,
      charges: charges.map((c) => ({ description: c.description.trim(), chargeType: c.chargeType, amount: c.amount.trim() })),
      ...(manualShares ? { manualShares } : {}),
      remarks: blankToNull(remarks),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return null;
    }
    return parsed.data as Record<string, unknown>;
  }

  async function runPreview() {
    const body = prepare();
    if (!body) return;
    setBusy("preview");
    try {
      setPreview(await api.post<ChargePreview>("/purchase/charges/preview", body));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const body = prepare();
    if (!body) return;
    setBusy("save");
    try {
      onSaved(await api.post<LandedChargeDto>("/purchase/charges", body));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const receiptColumns: Column<GoodsReceiptHeader>[] = [
    {
      key: "pick",
      header: "",
      render: (r) => <CheckInput id={`pick-${r.id}`} label={<span className="sr-only">Add {r.number}</span>} checked={chosen.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />,
    },
    { key: "number", header: "Receipt", render: (r) => <span className="mono">{r.number}</span> },
    { key: "date", header: "Date", render: (r) => formatDate(r.postingDate) },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier.name },
    { key: "store", header: "Store", render: (r) => r.store.code },
    ...(hasTotals(receipts.data) ? [{ key: "total", header: "Total", align: "right", render: (r: GoodsReceiptHeader) => rupees(r.total) } satisfies Column<GoodsReceiptHeader>] : []),
  ];

  if (!rights.charges) return <Alert kind="error">You do not have the right to enter extra charges.</Alert>;

  return (
    <div>
      <h1>New extra charges</h1>
      <p>The freight (or loading, insurance…) is added to the cost of the goods received, and sales made since then are re-costed.</p>

      <h2>1. Goods receipts</h2>
      <Alert kind="error">{receipts.error}</Alert>
      <DataTable columns={receiptColumns} rows={receipts.data} rowKey={(r) => r.id} loading={receipts.loading} empty="No finalised goods receipts." />
      <p className="muted">{chosen.length} receipt{chosen.length === 1 ? "" : "s"} chosen.</p>

      <h2>2. Charges</h2>
      <div className="table-wrap line-grid">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">
                Amount (₹)
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {charges.map((c, i) => (
              <tr key={c.key}>
                <td>
                  <input className="input" aria-label={`Description of charge ${i + 1}`} value={c.description} maxLength={120} onChange={(e) => updateCharge(c.key, { description: e.target.value })} />
                </td>
                <td>
                  <select className="input" aria-label={`Type of charge ${i + 1}`} value={c.chargeType} onChange={(e) => updateCharge(c.key, { chargeType: e.target.value })}>
                    {CHARGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CHARGE_TYPE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <input className="input" inputMode="decimal" aria-label={`Amount of charge ${i + 1}`} value={c.amount} onChange={(e) => updateCharge(c.key, { amount: e.target.value })} />
                </td>
                <td>
                  {charges.length > 1 ? (
                    <Button size="small" variant="link" aria-label={`Remove charge ${i + 1}`} onClick={() => { setCharges(charges.filter((x) => x.key !== c.key)); changed(); }}>
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <Button size="small" onClick={() => { setCharges([...charges, newCharge()]); changed(); }}>
          Add another charge
        </Button>
        <span className="spacer" />
        <strong>Total: {rupees(total.toFixed(2))}</strong>
      </div>

      <h2>3. How to share it</h2>
      <fieldset className="check-list">
        <legend className="sr-only">Share by</legend>
        {(Object.keys(SHARE_LABELS) as ShareBy[]).map((s) => (
          <RadioInput key={s} id={`share-${s}`} name="share-by" label={SHARE_LABELS[s].label} description={SHARE_LABELS[s].description} checked={shareBy === s} onChange={() => { setShareBy(s); changed(); }} />
        ))}
      </fieldset>
      {shareBy === "manual" ? (
        chosen.length === 0 ? (
          <p className="muted">Tick the receipts first; their lines appear here.</p>
        ) : details.error ? (
          <Alert kind="error">{details.error}</Alert>
        ) : !details.data ? (
          <p className="muted">Loading the lines…</p>
        ) : (
          <div className="table-wrap line-grid">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">
                    Received
                  </th>
                  <th scope="col" className="num">
                    Share (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {manualLines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.receiptNumber}</td>
                    <td>
                      <span className="mono">{l.item.code}</span> {l.item.name}
                    </td>
                    <td className="num">{showQuantity(l.receivedQuantity)}</td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Share for ${l.receiptNumber} ${l.item.code}`} placeholder="0" value={manual[l.id] ?? ""} onChange={(e) => { setManual({ ...manual, [l.id]: e.target.value }); changed(); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={manualSum.sub(total).abs().gt("0.02") ? "field-error" : "muted"}>
              Shares typed: {rupees(manualSum.toFixed(2))} of {rupees(total.toFixed(2))}
            </p>
          </div>
        )
      ) : null}

      <div className="card">
        <div className="form-grid">
          <TextInput id="charge-date" label="Date" type="date" value={postingDate || today} max={today || undefined} onChange={(e) => { setPostingDate(e.target.value); changed(); }} hint="Indian date." />
        </div>
        <TextareaInput id="charge-remarks" label="Remarks" value={remarks} onChange={(e) => { setRemarks(e.target.value); changed(); }} maxLength={500} hint="For example the transporter's bill number." />
      </div>

      <Alert kind="error">{error}</Alert>
      {preview ? (
        <>
          <h2>Preview</h2>
          <DataTable
            columns={[
              { key: "receipt", header: "Receipt", render: (s) => <span className="mono">{s.receipt}</span> },
              { key: "item", header: "Item", render: (s) => `${s.item.code} ${s.item.name}` },
              { key: "qty", header: "Basic units", align: "right", render: (s) => showQuantity(s.quantity) },
              { key: "value", header: "Value", align: "right", render: (s) => rupees(s.value) },
              { key: "share", header: "Share", align: "right", render: (s) => rupees(s.share) },
            ]}
            rows={preview.shares}
            rowKey={(s) => s.receiptLineId}
            caption={`Total ${rupees(preview.total)}`}
          />
        </>
      ) : null}
      <div className="actions">
        <Button busy={busy === "preview"} disabled={busy !== null} onClick={runPreview}>
          Preview
        </Button>
        <Button variant="primary" busy={busy === "save"} disabled={busy !== null} onClick={save}>
          Save
        </Button>
      </div>
      <p className="muted">Saving keeps a draft; finalise it on the next page to change the costs.</p>
    </div>
  );
}

function hasTotals(rows: GoodsReceiptHeader[] | null): boolean {
  return (rows ?? []).some((r) => r.total !== undefined);
}
