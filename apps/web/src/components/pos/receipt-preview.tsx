// Copyright (c) 2026, Rademics. All rights reserved.
// An 80 mm till receipt on screen, and printing it.
"use client";

import { useRef } from "react";
import { Button } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import type { ReceiptDto } from "./pos-shared";

const paper = {
  width: "80mm",
  maxWidth: "100%",
  padding: "4mm",
  background: "#fff",
  color: "#000",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.35,
  border: "1px dashed #999",
} as const;

const row = { display: "flex", justifyContent: "space-between", gap: 8 } as const;
const rule = { borderTop: "1px dashed #000", margin: "4px 0" } as const;

export function ReceiptPreview({ receipt }: { receipt: ReceiptDto }) {
  const ref = useRef<HTMLDivElement>(null);

  function print() {
    const html = ref.current?.outerHTML;
    // A separate window holds only the receipt, so the menu and buttons are not printed.
    const w = html ? window.open("", "_blank", "width=420,height=640") : null;
    if (!w || !html) {
      window.print();
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${receipt.number}</title><style>@page{size:80mm auto;margin:0}body{margin:0}</style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  }

  return (
    <>
      <div ref={ref} style={paper} aria-label={`Receipt ${receipt.number}`}>
        <div style={{ textAlign: "center", fontWeight: 700 }}>{receipt.kind === "return" ? "RETURN RECEIPT" : "RECEIPT"}</div>
        {receipt.duplicate ? <div style={{ textAlign: "center" }}>** DUPLICATE **</div> : null}
        {receipt.provisional ? <div style={{ textAlign: "center" }}>GST provisional (rate not approved yet)</div> : null}
        <div style={rule} />
        <div style={row}>
          <span>Bill {receipt.number}</span>
          <span>Till {receipt.till}</span>
        </div>
        <div>{formatDateTime(receipt.soldAt)}</div>
        <div style={rule} />
        {receipt.lines.map((l, i) => (
          <div key={i}>
            <div>
              {l.name}
              {l.free ? " (FREE)" : ""}
            </div>
            <div style={row}>
              <span>
                {showQuantity(l.quantity)} × {l.price}
                {l.hsn ? ` HSN ${l.hsn}` : ""}
              </span>
              <span>{l.amount}</span>
            </div>
            {l.discount !== "0.00" ? <div style={row}><span>  discount</span><span>−{l.discount}</span></div> : null}
            {l.serials.length ? <div>  S/N {l.serials.join(", ")}</div> : null}
          </div>
        ))}
        <div style={rule} />
        <div style={row}>
          <span>Discount</span>
          <span>{receipt.totals.discount}</span>
        </div>
        <div style={row}>
          <span>Rounding</span>
          <span>{receipt.totals.rounding}</span>
        </div>
        <div style={{ ...row, fontWeight: 700, fontSize: 14 }}>
          <span>TOTAL</span>
          <span>{rupees(receipt.totals.total)}</span>
        </div>
        <div style={rule} />
        <div style={row}>
          <span>GST %</span>
          <span>Taxable</span>
          <span>CGST</span>
          <span>SGST</span>
          <span>IGST</span>
        </div>
        {receipt.gstTable.map((g) => (
          <div key={g.rate} style={row}>
            <span>{showQuantity(g.rate)}</span>
            <span>{g.taxable}</span>
            <span>{g.cgst}</span>
            <span>{g.sgst}</span>
            <span>{g.igst}</span>
          </div>
        ))}
        <div style={rule} />
        {receipt.payments.map((p, i) => (
          <div key={i} style={row}>
            <span>
              {p.method}
              {p.reference ? ` (${p.reference})` : ""}
            </span>
            <span>{p.amount}</span>
          </div>
        ))}
        {receipt.change !== "0.00" ? (
          <div style={row}>
            <span>Change</span>
            <span>{receipt.change}</span>
          </div>
        ) : null}
        {receipt.footer ? (
          <>
            <div style={rule} />
            <div style={{ textAlign: "center", whiteSpace: "pre-wrap" }}>{receipt.footer}</div>
          </>
        ) : null}
      </div>
      <div className="actions">
        <Button variant="primary" onClick={print}>
          Print
        </Button>
      </div>
    </>
  );
}
