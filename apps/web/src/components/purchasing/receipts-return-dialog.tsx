// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { Decimal, purchaseReturnSchema } from "shared";
import { Alert, Button, Dialog, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { GoodsReceiptDto, GoodsReceiptLineDto } from "@/lib/purchasing";
import { showQuantity, splitLines, useBusinessToday } from "@/lib/stock";

/** A quantity in basic units shown in the line's own unit. */
export function inLineUnit(basic: string, factor: string): Decimal {
  const f = new Decimal(factor);
  return new Decimal(basic).div(f.isZero() ? 1 : f).toDecimalPlaces(3);
}

/** Accepted and rejected still on hand from this line, in the line's unit. */
export function leftToReturn(l: GoodsReceiptLineDto): { accepted: Decimal; rejected: Decimal } {
  return {
    accepted: Decimal.max(0, inLineUnit(new Decimal(l.basicAcceptedQuantity).sub(l.returnedAcceptedQuantity).toString(), l.factor)),
    rejected: Decimal.max(0, inLineUnit(new Decimal(l.basicRejectedQuantity).sub(l.returnedRejectedQuantity).toString(), l.factor)),
  };
}

interface LineState {
  accepted: string;
  rejected: string;
  serials: string;
}

interface ReturnDialogProps {
  receipt: GoodsReceiptDto;
  onClose: () => void;
  onReturned: (ret: GoodsReceiptDto) => void;
}

function parse(text: string): Decimal | null {
  try {
    const d = new Decimal(text.trim() || "0");
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Sends goods of a receipt back to the supplier, from the shelf or from the Rejected location, at their original cost. */
export function ReceiptsReturnDialog({ receipt, onClose, onReturned }: ReturnDialogProps) {
  const today = useBusinessToday();
  const open = receipt.lines.filter((l) => {
    const left = leftToReturn(l);
    return left.accepted.gt(0) || left.rejected.gt(0);
  });
  const [lines, setLines] = useState<Record<string, LineState>>(() => Object.fromEntries(open.map((l) => [l.id, { accepted: "", rejected: "", serials: "" }])));
  const [postingDate, setPostingDate] = useState("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const anySerials = open.some((l) => l.item.trackSerials);

  function update(id: string, patch: Partial<LineState>) {
    setLines((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setReasonError(reason.trim() ? null : "Give the reason for the return");
    const problems: string[] = [];
    const out: { originalLineId: string; acceptedQuantity: string | null; rejectedQuantity: string | null; serialNumbers?: string[] }[] = [];
    for (const l of open) {
      const s = lines[l.id];
      const acc = parse(s.accepted);
      const rej = parse(s.rejected);
      const left = leftToReturn(l);
      if (!acc || !rej || acc.isNegative() || rej.isNegative()) {
        problems.push(`${l.item.code}: quantities must be zero or more`);
        continue;
      }
      if (acc.gt(left.accepted)) problems.push(`${l.item.code}: only ${left.accepted.toString()} accepted left to return`);
      if (rej.gt(left.rejected)) problems.push(`${l.item.code}: only ${left.rejected.toString()} rejected left to return`);
      if (acc.add(rej).isZero()) continue;
      const serials = splitLines(s.serials);
      if (l.item.trackSerials) {
        const basic = acc.add(rej).mul(l.factor);
        if (!basic.eq(serials.length)) problems.push(`${l.item.code}: list the ${basic.toString()} serial numbers going back`);
      }
      out.push({
        originalLineId: l.id,
        acceptedQuantity: acc.gt(0) ? acc.toString() : null,
        rejectedQuantity: rej.gt(0) ? rej.toString() : null,
        ...(l.item.trackSerials ? { serialNumbers: serials } : {}),
      });
    }
    if (problems.length) {
      setError(problems.join("; "));
      return;
    }
    if (out.length === 0) {
      setError("Nothing to return: every quantity is zero.");
      return;
    }
    if (!reason.trim()) return;
    const parsed = purchaseReturnSchema.safeParse({ postingDate: postingDate || undefined, reason, lines: out });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    setBusy(true);
    try {
      const ret = await api.post<GoodsReceiptDto>(`/purchase/receipts/${receipt.id}/return`, parsed.data);
      onReturned(ret);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={`Return goods of ${receipt.number}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>The goods leave stock at the cost they came in at. Rejected goods go back from the Rejected location.</p>
        <TextInput id="return-date" label="Date of return" type="date" value={postingDate || today} max={today || undefined} min={receipt.postingDate} onChange={(e) => setPostingDate(e.target.value)} />
        <div className="table-wrap line-grid">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Accepted left
                </th>
                <th scope="col" className="num">
                  Return accepted
                </th>
                <th scope="col" className="num">
                  Rejected left
                </th>
                <th scope="col" className="num">
                  Return rejected
                </th>
                {anySerials ? <th scope="col">Serial numbers going back</th> : null}
              </tr>
            </thead>
            <tbody>
              {open.map((l) => {
                const left = leftToReturn(l);
                return (
                  <tr key={l.id}>
                    <td>
                      <span className="mono">{l.item.code}</span> {l.item.name}
                    </td>
                    <td className="num">{showQuantity(left.accepted.toString())}</td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Accepted to return for ${l.item.code}`} placeholder="0" value={lines[l.id].accepted} disabled={left.accepted.isZero()} onChange={(e) => update(l.id, { accepted: e.target.value })} />
                    </td>
                    <td className="num">{showQuantity(left.rejected.toString())}</td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Rejected to return for ${l.item.code}`} placeholder="0" value={lines[l.id].rejected} disabled={left.rejected.isZero()} onChange={(e) => update(l.id, { rejected: e.target.value })} />
                    </td>
                    {anySerials ? (
                      <td>
                        {l.item.trackSerials ? (
                          <textarea className="input" aria-label={`Serial numbers to return for ${l.item.code}`} placeholder="One per line" value={lines[l.id].serials} onChange={(e) => update(l.id, { serials: e.target.value })} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open.length === 0 ? <p className="muted">Everything on this receipt has already gone back.</p> : null}
        <TextareaInput id="return-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={reasonError} required maxLength={300} />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy} disabled={open.length === 0}>
            Return the goods
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}
