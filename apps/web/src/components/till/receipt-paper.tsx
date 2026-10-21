// Copyright (c) 2026, Rademics. All rights reserved.
// The 80 mm till receipt as HTML (blueprint 16 "Till receipt"), used for the
// on-screen preview and for the browser print window when the Till Helper is
// not there. Reprints say "Duplicate". The layout is approved with the GST
// module (decision 43); figures are shown as the server (or till) gave them.
// Plan 13: points earned and spent with the balance, and gift cards sold or used.
"use client";

import { useEffect } from "react";
import { addDays } from "shared";
import { formatDate } from "@/lib/format";
import { dateTimeIn, nonZero, qty, rupees } from "@/lib/till/format";
import type { PrintableReceipt } from "@/lib/till/receipt";

export function ReceiptPaper({ receipt }: { receipt: PrintableReceipt }) {
  const r = receipt;
  const igst = r.gstTable.some((g) => nonZero(g.igst));
  // Plan 08 (CBIC invoice rules): title, seller and buyer GSTIN, place of supply, original bill, declaration.
  const gst = r.gst;
  const sellerGstin = gst?.sellerGstin ?? r.company.gstin;
  return (
    <article className="till-receipt" aria-label={`Receipt ${r.number}`}>
      <header className="till-receipt-head">
        <strong>{r.store.name}</strong>
        {r.company.legalName && r.company.legalName !== r.store.name ? <div>{r.company.legalName}</div> : null}
        {sellerGstin ? <div>GSTIN: {sellerGstin}</div> : null}
        {r.store.address ? <div>{r.store.address}</div> : null}
        {r.store.phone ? <div>Phone: {r.store.phone}</div> : null}
      </header>
      {r.duplicate ? <p className="till-receipt-mark">DUPLICATE</p> : null}
      <p className="till-receipt-mark">{r.title ? r.title.toUpperCase() : gst ? gst.title.toUpperCase() : r.kind === "return" ? "RETURN / CREDIT NOTE" : "BILL"}</p>
      {gst?.declaration ? <p className="till-receipt-small">{gst.declaration}</p> : null}
      <div className="till-receipt-meta">
        <div>No: {r.number}</div>
        <div>{dateTimeIn(typeof r.soldAt === "string" ? r.soldAt : new Date(r.soldAt).toISOString())}</div>
        <div>Till: {r.till}</div>
        {r.cashier ? <div>Cashier: {r.cashier}</div> : null}
        {r.customer ? <div>Customer: {r.customer}</div> : null}
        {r.salesStaff ? <div>Salesperson: {r.salesStaff}</div> : null}
        {gst?.original ? (
          <div>
            Against bill {gst.original.number}
            {gst.original.date ? ` dated ${gst.original.date}` : ""}
          </div>
        ) : null}
        {gst?.buyer ? (
          <div>
            Buyer: {gst.buyer.name ?? ""}
            {gst.buyer.gstin ? <div>Buyer GSTIN: {gst.buyer.gstin}</div> : null}
            {gst.buyer.address ? <div>{gst.buyer.address}</div> : null}
            {gst.buyer.state ? (
              <div>
                State: {gst.buyer.state.name} ({gst.buyer.state.code})
              </div>
            ) : null}
          </div>
        ) : null}
        {gst?.placeOfSupply ? (
          <div>
            Place of supply: {gst.placeOfSupply.name} ({gst.placeOfSupply.code})
          </div>
        ) : null}
        {gst && gst.invoiceKind === "business" ? <div>Reverse charge: {gst.reverseCharge ? "Yes" : "No"}</div> : null}
      </div>
      <table className="till-receipt-lines">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.name}
                {l.free ? " (free)" : ""}
                {l.hsn ? <div className="till-receipt-small">HSN {l.hsn}</div> : null}
                {l.offer ? <div className="till-receipt-small">{l.offer}</div> : null}
                {nonZero(l.discount) && !l.free ? <div className="till-receipt-small">Discount {rupees(l.discount)}</div> : null}
                {l.salesStaff ? <div className="till-receipt-small">Sold by {l.salesStaff}</div> : null}
                {l.serials.length ? <div className="till-receipt-small">S/N {l.serials.join(", ")}</div> : null}
              </td>
              <td className="num">{qty(l.quantity)}</td>
              <td className="num">{rupees(l.price)}</td>
              <td className="num">{rupees(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="till-receipt-totals">
        {(r.offers ?? []).map((o) => (
          <OfferRow key={o.name} name={o.name} saving={o.saving} />
        ))}
        {nonZero(r.totals.discount) ? (
          <>
            <dt>You saved</dt>
            <dd>{rupees(r.totals.discount)}</dd>
          </>
        ) : null}
        {nonZero(r.totals.rounding) ? (
          <>
            <dt>Rounding</dt>
            <dd>{rupees(r.totals.rounding)}</dd>
          </>
        ) : null}
        <dt className="till-receipt-total">Total</dt>
        <dd className="till-receipt-total">{rupees(r.totals.total)}</dd>
        {r.payments.map((p, i) => (
          <PaymentRow key={i} method={p.method} amount={p.amount} reference={p.reference} />
        ))}
        {nonZero(r.change) ? (
          <>
            <dt>Change</dt>
            <dd>{rupees(r.change)}</dd>
          </>
        ) : null}
      </dl>
      {r.gstTable.length ? (
        <table className="till-receipt-gst">
          <thead>
            <tr>
              <th>GST %</th>
              <th className="num">Taxable</th>
              {igst ? <th className="num">IGST</th> : (
                <>
                  <th className="num">CGST</th>
                  <th className="num">SGST</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {r.gstTable.map((g) => (
              <tr key={g.rate}>
                <td>{g.rate}%</td>
                <td className="num">{rupees(g.taxable)}</td>
                {igst ? <td className="num">{rupees(g.igst)}</td> : (
                  <>
                    <td className="num">{rupees(g.cgst)}</td>
                    <td className="num">{rupees(g.sgst)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {r.delivery ? (
        <div className="till-receipt-meta">
          <div>
            <strong>Home delivery</strong>
            {r.delivery.deliverOn ? ` on ${r.delivery.deliverOn}` : ""}
          </div>
          {r.delivery.name ? <div>{r.delivery.name}</div> : null}
          <div>{r.delivery.address}</div>
          {r.delivery.phone ? <div>Phone: {r.delivery.phone}</div> : null}
        </div>
      ) : null}
      {(r.giftCards ?? []).map((g, i) => (
        <div key={i} className="till-receipt-meta" data-testid="receipt-gift-card">
          <div>
            <strong>{GIFT_CARD_ACTION[g.action]}</strong> {rupees(g.amount)}
          </div>
          {/* Sale and reload receipts carry the full number (the Till Helper prints it as a barcode too). */}
          <div className={g.barcode ? "till-receipt-total" : undefined}>Card: {g.number}</div>
          <div>Balance on card: {rupees(g.balance)}</div>
          <div>Valid until {formatDate(addDays(g.expiresOn, -1))}</div>
        </div>
      ))}
      {r.loyalty ? (
        <div className="till-receipt-meta" data-testid="receipt-loyalty">
          <div>
            <strong>{r.loyalty.scheme}</strong>
          </div>
          {r.loyalty.earned ? <div>Points earned: {r.loyalty.earned}</div> : null}
          {r.loyalty.spent ? <div>Points spent: {r.loyalty.spent}</div> : null}
          {r.loyalty.restored ? <div>Points given back: {r.loyalty.restored}</div> : null}
          {r.loyalty.reversed ? <div>Points taken back: {r.loyalty.reversed}</div> : null}
          {r.loyalty.balance !== null ? <div>Points balance: {r.loyalty.balance}</div> : null}
          {r.loyalty.note ? <div className="till-receipt-small">{r.loyalty.note}</div> : null}
        </div>
      ) : null}
      {gst?.creditNoteLate ? <p className="till-receipt-small">Issued after the GST time limit: the tax of the original bill is not reduced in the return.</p> : null}
      {r.provisional ? <p className="till-receipt-small">GST rates not yet approved (provisional)</p> : null}
      {gst ? <p className="till-receipt-small">Authorised signatory</p> : null}
      {r.footer ? <p className="till-receipt-foot">{r.footer}</p> : null}
    </article>
  );
}

/** Plan 13: how each gift card line of a receipt starts. */
const GIFT_CARD_ACTION = { sold: "Gift card sold", loaded: "Gift card loaded", spent: "Paid by gift card", refunded: "Back on gift card" } as const;

/** Plan 11 B3: each offer on the bill and what it saved. */
function OfferRow({ name, saving }: { name: string; saving: string }) {
  return (
    <>
      <dt className="till-receipt-small">Offer: {name}</dt>
      <dd className="till-receipt-small">−{rupees(saving)}</dd>
    </>
  );
}

function PaymentRow({ method, amount, reference }: { method: string; amount: string; reference: string | null }) {
  return (
    <>
      <dt>
        {method}
        {reference ? ` (${reference})` : ""}
      </dt>
      <dd>{rupees(amount)}</dd>
    </>
  );
}

/**
 * Receipts for the browser's print window: hidden on screen, the only thing
 * printed (80 mm page). `job` changes for each print so the same receipt can
 * be printed again.
 */
export function PrintArea({ receipts, job }: { receipts: PrintableReceipt[]; job: number }) {
  useEffect(() => {
    if (!job || !receipts.length || typeof window.print !== "function") return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        // Printing is not available here (tests); the receipt stays on screen.
      }
    }, 50);
    return () => clearTimeout(t);
  }, [job, receipts]);
  return (
    <div className="till-print-area" aria-hidden="true">
      {receipts.map((r) => (
        <ReceiptPaper key={`${r.number}-${job}`} receipt={r} />
      ))}
    </div>
  );
}
