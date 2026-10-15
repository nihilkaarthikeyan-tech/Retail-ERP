// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { Decimal, receiveTransferSchema } from "shared";
import { Alert, Button, Dialog, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import { showQuantity, splitLines, stockLocationsOf, useBusinessToday } from "@/lib/stock";
import type { StockDocumentDto, StockLocationDto } from "@/lib/types";

interface ReceiveDialogProps {
  /** A finalised transfer send with lines still in transit. */
  send: StockDocumentDto;
  locations: StockLocationDto[];
  onClose: () => void;
  onReceived: (receipt: StockDocumentDto) => void;
}

/** Basic units of a send line still in transit. */
export function openQuantity(line: { basicQuantity: string; receivedQuantity: string }): string {
  return new Decimal(line.basicQuantity).sub(line.receivedQuantity).toString();
}

interface LineState {
  quantity: string;
  serials: string;
}

/** Receives a transfer, in full or in part, into a location of the receiving store. */
export function ReceiveDialog({ send, locations, onClose, onReceived }: ReceiveDialogProps) {
  const today = useBusinessToday();
  const openLines = send.lines.filter((l) => new Decimal(l.receivedQuantity).lt(l.basicQuantity));
  const destinations = send.toStoreId ? stockLocationsOf(locations, send.toStoreId) : [];
  const [toLocationId, setToLocationId] = useState("");
  const [postingDate, setPostingDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      openLines.map((l) => [l.id, { quantity: openQuantity(l), serials: l.item.trackSerials && new Decimal(l.receivedQuantity).isZero() ? l.serialNumbers.join("\n") : "" }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problems: string[] = [];
    const out: { sendLineId: string; quantity: string; serialNumbers?: string[] }[] = [];
    for (const l of openLines) {
      const state = lines[l.id];
      const typed = state.quantity.trim() || "0";
      let q: Decimal;
      try {
        q = new Decimal(typed);
      } catch {
        problems.push(`${l.item.code}: the quantity must be a number`);
        continue;
      }
      if (q.isNegative()) problems.push(`${l.item.code}: the quantity cannot be below zero`);
      else if (q.gt(openQuantity(l))) problems.push(`${l.item.code}: only ${showQuantity(openQuantity(l))} still in transit`);
      else if (q.gt(0)) {
        const serials = splitLines(state.serials);
        if (l.item.trackSerials && !q.eq(serials.length)) problems.push(`${l.item.code}: list the ${q.toString()} serial numbers being received`);
        out.push({ sendLineId: l.id, quantity: q.toString(), ...(l.item.trackSerials ? { serialNumbers: serials } : {}) });
      }
    }
    if (problems.length) {
      setError(problems.join("; "));
      return;
    }
    if (out.length === 0) {
      setError("Nothing to receive: every quantity is zero.");
      return;
    }
    const parsed = receiveTransferSchema.safeParse({
      toLocationId: toLocationId || undefined,
      postingDate: postingDate || undefined,
      remarks: blankToNull(remarks),
      lines: out,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    setBusy(true);
    try {
      const receipt = await api.post<StockDocumentDto>(`/stock/transfers/${send.id}/receive`, parsed.data);
      onReceived(receipt);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={`Receive ${send.number}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <SelectInput id="receive-location" label="Put the goods in" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} hint="Leave on the default to use the store's shop floor.">
          <option value="">Default location</option>
          {destinations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="receive-date" label="Date received" type="date" value={postingDate || today} max={today || undefined} min={send.postingDate} onChange={(e) => setPostingDate(e.target.value)} />
        <div className="table-wrap line-grid">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Still in transit
                </th>
                <th scope="col" className="num">
                  Receive now
                </th>
                {openLines.some((l) => l.item.trackSerials) ? <th scope="col">Serial numbers</th> : null}
              </tr>
            </thead>
            <tbody>
              {openLines.map((l, i) => (
                <tr key={l.id}>
                  <td>
                    <span className="mono">{l.item.code}</span> {l.item.name}
                    {l.batch ? <span className="muted"> · batch {l.batch.batchNumber}</span> : null}
                  </td>
                  <td className="num">{showQuantity(openQuantity(l))}</td>
                  <td className="num">
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`Quantity to receive for ${l.item.code}`}
                      value={lines[l.id].quantity}
                      onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], quantity: e.target.value } })}
                    />
                  </td>
                  {openLines.some((x) => x.item.trackSerials) ? (
                    <td>
                      {l.item.trackSerials ? (
                        <textarea className="input" aria-label={`Serial numbers received for line ${i + 1}`} value={lines[l.id].serials} onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], serials: e.target.value } })} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Quantities are in basic units. Whatever is not received now stays in transit.</p>
        <TextareaInput id="receive-remarks" label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={300} />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Receive
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}
