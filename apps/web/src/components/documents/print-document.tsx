// Copyright (c) 2026, Rademics. All rights reserved.
// One print layout for every document (plan 10 §1.A): the letterhead, title,
// number and date, the customer or supplier, details, the lines (columns as
// the API sends them), totals, the amount in words, standard terms and
// signature lines. A4 or A5 through the browser's Print / Save as PDF; table
// headings repeat on every printed page and drafts or cancelled documents
// carry a large diagonal mark.
import Image from "next/image";
import { formatDate } from "@/lib/format";
import { printAmount, printCell, type PrintDocumentDto } from "@/lib/documents";
import { dateTimeIn } from "@/lib/till/format";

const GRAND_TOTALS = ["Total", "Amount", "Closing balance"];

interface PrintDocumentProps {
  doc: PrintDocumentDto;
  /** Where the logo image is (GET /print/logo), when the letterhead shows one. */
  logoUrl?: string | null;
  /** Called once the logo has loaded (or failed), so printing waits for it. */
  onLogoSettled?: () => void;
}

/** Audit 4 (rule 48(1)): a tax invoice prints once per copy, each with its marking; other documents once. */
export function PrintDocument({ doc, logoUrl, onLogoSettled }: PrintDocumentProps) {
  const copies = doc.copies?.length ? doc.copies : [null];
  return (
    <>
      {copies.map((copy, i) => (
        <PrintSheet key={copy ?? "only"} doc={doc} logoUrl={logoUrl} onLogoSettled={i === 0 ? onLogoSettled : undefined} copy={copy} last={i === copies.length - 1} />
      ))}
    </>
  );
}

function PrintSheet({ doc, logoUrl, onLogoSettled, copy, last }: PrintDocumentProps & { copy: string | null; last: boolean }) {
  const lh = doc.letterhead;
  const paper = doc.paper === "A5" ? "a5" : "a4";
  // The bottom line is in bold: the total, the amount paid, or the closing balance.
  const grand = doc.totals.findIndex(([k]) => GRAND_TOTALS.includes(k));
  return (
    <article className={`doc-sheet doc-${paper}`} aria-label={`${doc.title}${doc.number ? ` ${doc.number}` : ""}${copy ? `, ${copy.toLowerCase()}` : ""}`} style={last ? undefined : { breakAfter: "page" }}>
      {copy ? (
        <div className="doc-copy" style={{ textAlign: "right", fontWeight: 700, fontSize: "9pt", letterSpacing: "0.05em" }}>
          {copy}
        </div>
      ) : null}
      {doc.mark ? (
        <div className={`doc-mark doc-mark-${doc.mark.toLowerCase()}`} role="note" aria-label={`Marked ${doc.mark}`}>
          {doc.mark}
        </div>
      ) : null}

      <header className="doc-letterhead">
        {lh.showLogo && logoUrl ? <Image className="doc-logo" src={logoUrl} alt={`${lh.name} logo`} width={240} height={96} unoptimized onLoad={onLogoSettled} onError={onLogoSettled} /> : null}
        <div className="doc-letterhead-text">
          <div className="doc-company">{lh.name}</div>
          {lh.legalName && lh.legalName !== lh.name ? <div>{lh.legalName}</div> : null}
          {lh.storeName ? <div className="doc-store">{lh.storeName}</div> : null}
          {lh.address.length ? <div>{lh.address.join(", ")}</div> : null}
          <div>
            {[lh.gstin ? `GSTIN ${lh.gstin}` : null, lh.phone ? `Phone ${lh.phone}` : null, lh.email].filter(Boolean).join(" · ")}
          </div>
        </div>
      </header>

      <div className="doc-title-row">
        <h1 className="doc-title">{doc.title}</h1>
        <dl className="doc-number">
          {doc.number ? (
            <>
              <dt>No.</dt>
              <dd>{doc.number}</dd>
            </>
          ) : null}
          {doc.date ? (
            <>
              <dt>Date</dt>
              <dd>{formatDate(doc.date)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {doc.notice ? (
        <p className="doc-notice" role="note" aria-label="Notice" style={{ border: "2px solid currentColor", padding: "2mm 3mm", fontWeight: 700, whiteSpace: "pre-line" }}>
          {doc.notice}
        </p>
      ) : null}

      {doc.qr ? (
        <figure className="doc-qr" style={{ float: "right", margin: "0 0 3mm 4mm", width: "34mm", textAlign: "center" }}>
          <svg viewBox={`-4 -4 ${doc.qr.size + 8} ${doc.qr.size + 8}`} role="img" aria-label={doc.qr.label} shapeRendering="crispEdges" style={{ width: "100%", height: "auto", background: "#fff" }}>
            <path d={doc.qr.path} fill="#000" />
          </svg>
          <figcaption className="doc-muted">{doc.qr.label}</figcaption>
        </figure>
      ) : null}

      {doc.party || doc.details.length ? (
        <section className="doc-head-grid">
          {doc.party ? (
            <div className="doc-party">
              <div className="doc-caption">{doc.party.label}</div>
              <div className="doc-party-name">
                {doc.party.name}
                {doc.party.code ? <span className="doc-muted"> ({doc.party.code})</span> : null}
              </div>
              {doc.party.address.length ? <div>{doc.party.address.join(", ")}</div> : null}
              {doc.party.gstin ? <div>GSTIN {doc.party.gstin}</div> : null}
              {doc.party.phone ? <div>Phone {doc.party.phone}</div> : null}
            </div>
          ) : (
            <div />
          )}
          {doc.details.length ? (
            <dl className="doc-details">
              {doc.details.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v ? printAmount(v) : "—"}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}

      <table className="doc-lines">
        <thead>
          <tr>
            {doc.columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === "right" ? "doc-num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.lines.length === 0 ? (
            <tr>
              <td colSpan={doc.columns.length} className="doc-muted">
                No lines.
              </td>
            </tr>
          ) : (
            doc.lines.map((line, i) => (
              <tr key={i}>
                {doc.columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "doc-num" : undefined}>
                    {printCell(line[c.key])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {doc.totals.length ? (
        <table className="doc-totals" aria-label="Totals">
          <tbody>
            {doc.totals.map(([k, v], i) => (
              <tr key={`${k}-${i}`} className={i === grand ? "doc-grand" : undefined}>
                <th scope="row">{printCell(k)}</th>
                <td className="doc-num">{printAmount(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {doc.amountInWords ? (
        <p className="doc-words">
          <span className="doc-caption">Amount in words</span> {doc.amountInWords}
        </p>
      ) : null}

      {doc.terms.length ? (
        <section className="doc-terms">
          <div className="doc-caption">Terms</div>
          {doc.terms.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </section>
      ) : null}

      {doc.signatures.length ? (
        <div className="doc-signatures">
          {doc.signatures.map((s) => (
            <div key={s} className="doc-signature">
              <span>{s}</span>
            </div>
          ))}
        </div>
      ) : null}

      <footer className="doc-printed">Printed on {dateTimeIn(doc.printedAt)}</footer>
    </article>
  );
}

/** The paper and its margins for the browser's print window. */
export function DocumentPageStyle({ paper }: { paper: "A4" | "A5" }) {
  const margin = paper === "A5" ? "9mm 9mm 10mm" : "12mm 12mm 14mm";
  return <style>{`@media print { @page { size: ${paper} portrait; margin: ${margin}; } }`}</style>;
}
