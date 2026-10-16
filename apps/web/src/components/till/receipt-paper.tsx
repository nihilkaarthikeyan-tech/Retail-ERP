// Copyright (c) 2026, Rademics. All rights reserved.
// The 80 mm till receipt as HTML (blueprint 16 "Till receipt"), used for the
// on-screen preview and for the browser print window when the Till Helper is
// not there. Reprints say "Duplicate". The layout is approved with the GST
// module (decision 43); figures are shown as the server (or till) gave them.
"use client";

import { useEffect } from "react";
import { dateTimeIn, nonZero, qty, rupees } from "@/lib/till/format";
import type { PrintableReceipt } from "@/lib/till/receipt";

export function ReceiptPaper({ receipt }: { receipt: PrintableReceipt }) {
  const r = receipt;
  const igst = r.gstTable.some((g) => nonZero(g.igst));
  return (
    <article className="till-receipt" aria-label={`Receipt ${r.number}`}>
      <header className="till-receipt-head">
        <strong>{r.store.name}</strong>
        {r.company.legalName && r.company.legalName !== r.store.name ? <div>{r.company.legalName}</div> : null}
        {r.company.gstin ? <div>GSTIN: {r.company.gstin}</div> : null}
        {r.store.address ? <div>{r.store.address}</div> : null}
        {r.store.phone ? <div>Phone: {r.store.phone}</div> : null}
      </header>
      {r.duplicate ? <p className="till-receipt-mark">DUPLICATE</p> : null}
      <p className="till-receipt-mark">{r.kind === "return" ? "RETURN / CREDIT NOTE" : "BILL"}</p>
      <div className="till-receipt-meta">
        <div>No: {r.number}</div>
        <div>{dateTimeIn(typeof r.soldAt === "string" ? r.soldAt : new Date(r.soldAt).toISOString())}</div>
        <div>Till: {r.till}</div>
        {r.cashier ? <div>Cashier: {r.cashier}</div> : null}
        {r.customer ? <div>Customer: {r.customer}</div> : null}
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
                {nonZero(l.discount) && !l.free ? <div className="till-receipt-small">Discount {rupees(l.discount)}</div> : null}
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
      {r.provisional ? <p className="till-receipt-small">GST rates not yet approved (provisional)</p> : null}
      {r.footer ? <p className="till-receipt-foot">{r.footer}</p> : null}
    </article>
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
