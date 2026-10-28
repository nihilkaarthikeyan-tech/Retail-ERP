// Copyright (c) 2026, Rademics. All rights reserved.
// GST return screens (module 8, plan 08 §3): the sales tax register, GSTR-1
// figures with the downloads for Excel and the GST portal, GSTR-3B figures
// with the set-off of input credit, and the credit and debit note register.
// Each is per GSTIN for a month or a quarter (the filing frequency setting).
// The figures are worked out by the API; this page only shows them.
"use client";

import Link from "next/link";
import { useState } from "react";
import { INDIAN_STATE_OPTIONS, type PermissionKey } from "shared";
import { Alert, Button, SelectInput, TextInput } from "@/components/ui";
import { api, downloadFile, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import {
  defaultPeriod,
  type Figures,
  type Gstr1B2csRow,
  type Gstr1DocumentRow,
  type Gstr1Dto,
  type Gstr1HsnRow,
  type Gstr1Invoice,
  type Gstr1NilRow,
  type Gstr1NoteRow,
  type Gstr3bDto,
  type GstRegistrationsDto,
  HEAD_NAMES,
  type HeadAmounts,
  NOTE_STATUS_LABELS,
  type NoteRegisterRow,
  type NotesRegisterDto,
  periodOptions,
  SECTION_LABELS,
  type SalesRegisterDto,
  type SalesRegisterRow,
  stateText,
} from "@/lib/gst-returns";
import { canSeeReport, type CsvCell, REPORTS } from "@/lib/reports";
import { useLoad } from "@/lib/use-load";
import { Amount, col, csvName, type CsvOutput, ReportPage, type ReportColumn, ReportTable, tableCsv, useAllowed, useReport, useUrlFilters } from "./report-kit";

const GST: PermissionKey[] = ["gst.returns"];

// ---- Period and GSTIN ----

/** The GSTINs and filing frequency, and the period and GSTIN chosen (kept in the address bar). */
function useGstFilters<K extends string>(extra: Record<K, string>) {
  const access = useAllowed(GST);
  const regs = useLoad<GstRegistrationsDto | null>(() => (access.allowed ? api.get<GstRegistrationsDto>("/reports/gst/registrations") : Promise.resolve(null)), [access.allowed]);
  const f = useUrlFilters({ period: "", gstRegistrationId: "", ...extra } as Record<"period" | "gstRegistrationId" | K, string>);
  const data = regs.data;
  const period = f.values.period || (data ? defaultPeriod(data.currentPeriod) : "");
  const gstRegistrationId = f.values.gstRegistrationId || data?.registrations[0]?.id || "";
  const gstin = data?.registrations.find((r) => r.id === gstRegistrationId)?.gstin ?? "";
  return { f, regs: data, error: regs.error, period, gstRegistrationId, gstin, ready: f.ready && !!data && !!period && !!gstRegistrationId, allowed: access.allowed };
}

function GstFilters({ regs, period, gstRegistrationId, onChange }: { regs: GstRegistrationsDto | null; period: string; gstRegistrationId: string; onChange: (patch: { period?: string; gstRegistrationId?: string }) => void }) {
  if (!regs) return null;
  const options = periodOptions(regs.currentPeriod, regs.filingFrequency === "quarterly" ? 8 : 15);
  return (
    <>
      <SelectInput id="gst-period" label={regs.filingFrequency === "quarterly" ? "Quarter" : "Month"} value={period} onChange={(e) => onChange({ period: e.target.value })}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectInput>
      {regs.registrations.length > 1 ? (
        <SelectInput id="gst-gstin" label="GSTIN" value={gstRegistrationId} onChange={(e) => onChange({ gstRegistrationId: e.target.value })}>
          {regs.registrations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.gstin} ({stateText(r.stateCode)})
            </option>
          ))}
        </SelectInput>
      ) : null}
    </>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <Alert kind="info">
      <strong>Check before filing</strong>
      <ul>
        {list.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </Alert>
  );
}

const money = <T,>(key: string, header: string, get: (r: T) => string, total?: string) => col.money<T>(key, header, get, total);
const taxColumns = <T extends Partial<Figures>,>(totals?: Partial<Figures>): ReportColumn<T>[] => [
  money<T>("taxable", "Taxable value", (r) => r.taxable ?? "", totals?.taxable),
  money<T>("igst", "IGST", (r) => r.igst ?? "", totals?.igst),
  money<T>("cgst", "CGST", (r) => r.cgst ?? "", totals?.cgst),
  money<T>("sgst", "SGST", (r) => r.sgst ?? "", totals?.sgst),
];

// ---- Sales tax register ----

export function SalesTaxRegisterReport() {
  const g = useGstFilters({ kind: "", placeOfSupply: "" });
  const v = g.f.values;
  const r = useReport<SalesRegisterDto>(`/reports/gst/sales-register${query({ period: g.period, gstRegistrationId: g.gstRegistrationId, kind: v.kind, placeOfSupply: v.placeOfSupply })}`, g.ready);
  const columns = (d: SalesRegisterDto): ReportColumn<SalesRegisterRow>[] => [
    col.text<SalesRegisterRow>("number", "Number", (x) => x.number),
    col.date<SalesRegisterRow>("date", "Date", (x) => x.date),
    col.text<SalesRegisterRow>("kind", "Kind", (x) => (x.source === "transfer" ? "Transfer to own GSTIN" : x.kind === "credit_note" ? "Credit note" : x.invoiceKind === "business" ? "Business invoice" : x.invoiceKind === "bill_of_supply" ? "Bill of supply" : "Consumer bill")),
    { ...col.text<SalesRegisterRow>("buyer", "Buyer", (x) => [x.buyerName, x.buyerGstin].filter(Boolean).join(", ") || "Consumer"), wide: true },
    col.text<SalesRegisterRow>("pos", "Place of supply", (x) => stateText(x.placeOfSupply)),
    col.text<SalesRegisterRow>("section", "GSTR-1 table", (x) => SECTION_LABELS[x.section] ?? x.section),
    col.text<SalesRegisterRow>("original", "Original bill", (x) => (x.original ? `${x.original.number}, ${formatDate(x.original.date)}` : "")),
    money<SalesRegisterRow>("value", "Bill value", (x) => x.value, d.totals.value),
    ...taxColumns<SalesRegisterRow>(d.totals),
  ];
  return (
    <ReportPage
      id="gst-sales-register"
      area="accounts"
      needs={GST}
      ready={g.ready}
      state={r}
      note="Every tax invoice and credit note of the period under this GSTIN, read from the till bills. Credit notes are minus figures. Cancelled bills are left out."
      filters={
        <>
          <GstFilters regs={g.regs} period={g.period} gstRegistrationId={g.gstRegistrationId} onChange={(p) => g.f.set(p)} />
          <SelectInput id="gst-kind" label="Bills" value={v.kind} onChange={(e) => g.f.set({ kind: e.target.value })}>
            <option value="">Business and consumer</option>
            <option value="business">Business (with GSTIN)</option>
            <option value="consumer">Consumer</option>
          </SelectInput>
          <SelectInput id="gst-pos" label="Place of supply" value={v.placeOfSupply} onChange={(e) => g.f.set({ placeOfSupply: e.target.value })}>
            <option value="">All states</option>
            {INDIAN_STATE_OPTIONS.map(([code, name]) => (
              <option key={code} value={code}>
                {code} {name}
              </option>
            ))}
          </SelectInput>
        </>
      }
      summary={`${g.gstin} · ${r.data?.periodLabel ?? g.period}`}
      logFilters={{ gstin: g.gstin, period: g.period, bills: v.kind || "all", placeOfSupply: v.placeOfSupply || "all" }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("sales-tax-register", g.gstin, g.period)}
    >
      {(d) => (
        <>
          <Warnings list={d.warnings} />
          <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.billId} empty="No bills in this period." />
        </>
      )}
    </ReportPage>
  );
}

// ---- GSTR-1 ----

type ItemLine = { key: string; buyerGstin?: string | null; number: string; date: string; value: string; placeOfSupply: string; originalNumber?: string | null; rate: string } & Figures;

/** One row per invoice and rate, as the return lists them. */
function itemLines(list: (Gstr1Invoice | Gstr1NoteRow)[]): ItemLine[] {
  return list.flatMap((x) =>
    x.items.map((it) => ({
      key: `${x.number}-${it.rate}`,
      buyerGstin: x.buyerGstin,
      number: x.number,
      date: x.date,
      value: x.value,
      placeOfSupply: x.placeOfSupply,
      originalNumber: "originalNumber" in x ? x.originalNumber : undefined,
      ...it,
      tax: "",
    })),
  );
}

function invoiceColumns(withBuyer: boolean, note: boolean): ReportColumn<ItemLine>[] {
  return [
    ...(withBuyer ? [col.text<ItemLine>("ctin", "GSTIN of buyer", (x) => x.buyerGstin ?? "")] : []),
    col.text<ItemLine>("number", note ? "Note number" : "Invoice number", (x) => x.number),
    col.date<ItemLine>("date", "Date", (x) => x.date),
    ...(note ? [col.text<ItemLine>("original", "Original invoice", (x) => x.originalNumber ?? "")] : []),
    money<ItemLine>("value", note ? "Note value" : "Invoice value", (x) => x.value),
    col.text<ItemLine>("pos", "Place of supply", (x) => stateText(x.placeOfSupply)),
    col.text<ItemLine>("rate", "Rate", (x) => `${Number(x.rate)}%`),
    ...taxColumns<ItemLine>(),
  ];
}

const B2CS_COLUMNS: ReportColumn<Gstr1B2csRow>[] = [
  col.text<Gstr1B2csRow>("type", "Supply", (x) => (x.supplyType === "INTER" ? "Other state" : "Same state")),
  col.text<Gstr1B2csRow>("pos", "Place of supply", (x) => stateText(x.placeOfSupply)),
  col.text<Gstr1B2csRow>("rate", "Rate", (x) => `${Number(x.rate)}%`),
  ...taxColumns<Gstr1B2csRow>(),
];

const NIL_COLUMNS: ReportColumn<Gstr1NilRow>[] = [
  col.text<Gstr1NilRow>("type", "Supply", (x) => ({ INTRB2B: "Other state, registered", INTRAB2B: "Same state, registered", INTRB2C: "Other state, consumers", INTRAB2C: "Same state, consumers" })[x.supplyType]),
  money<Gstr1NilRow>("nil", "Nil rated", (x) => x.nil),
  money<Gstr1NilRow>("exempt", "Exempted", (x) => x.exempt),
  money<Gstr1NilRow>("nonGst", "Non-GST", (x) => x.nonGst),
];

const HSN_COLUMNS: ReportColumn<Gstr1HsnRow>[] = [
  col.text<Gstr1HsnRow>("hsn", "HSN", (x) => x.hsn || "(none)"),
  { ...col.text<Gstr1HsnRow>("desc", "Description", (x) => x.description), wide: true },
  col.text<Gstr1HsnRow>("uqc", "Unit (UQC)", (x) => x.uqc),
  col.qty<Gstr1HsnRow>("qty", "Quantity", (x) => x.quantity),
  col.text<Gstr1HsnRow>("rate", "Rate", (x) => `${Number(x.rate)}%`),
  ...taxColumns<Gstr1HsnRow>(),
];

const DOC_COLUMNS: ReportColumn<Gstr1DocumentRow>[] = [
  col.text<Gstr1DocumentRow>("nature", "Nature of document", (x) => x.natureLabel),
  col.text<Gstr1DocumentRow>("from", "From", (x) => x.from),
  col.text<Gstr1DocumentRow>("to", "To", (x) => x.to),
  col.count<Gstr1DocumentRow>("total", "Total", (x) => x.total),
  col.count<Gstr1DocumentRow>("cancelled", "Cancelled", (x) => x.cancelled),
  col.count<Gstr1DocumentRow>("net", "Net issued", (x) => x.net),
  col.count<Gstr1DocumentRow>("missing", "Numbers missing", (x) => x.missing),
];

const SECTION_ORDER = ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "nil", "excluded"];
type SectionRow = { key: string; label: string } & Figures;

function sectionRows(d: Gstr1Dto): SectionRow[] {
  const rec = d.reconciliation;
  return [
    ...SECTION_ORDER.filter((k) => rec.sections[k]).map((k) => ({ key: k, label: SECTION_LABELS[k] ?? k, ...rec.sections[k] })),
    { key: "all", label: "All sections", ...rec.sectionsTotal },
    { key: "register", label: "Sales tax register", ...rec.register },
  ];
}

const SECTION_COLUMNS: ReportColumn<SectionRow>[] = [{ ...col.text<SectionRow>("label", "Section", (x) => x.label), wide: true }, ...taxColumns<SectionRow>()];

function gstr1Csv(d: Gstr1Dto): CsvOutput {
  const rows = sectionRows(d);
  return tableCsv(SECTION_COLUMNS, rows, false);
}

function Section<T>({ title, hint, columns, rows, rowKey }: { title: string; hint?: string; columns: ReportColumn<T>[]; rows: T[]; rowKey: (r: T, i: number) => string }) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
      <ReportTable columns={columns} rows={rows} rowKey={rowKey} empty="Nothing in this period." totals={false} />
    </section>
  );
}

function PortalDownloads({ path, gstin, fp }: { path: string; gstin: string; fp: string }) {
  const [busy, setBusy] = useState<"excel" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function get(kind: "excel" | "json") {
    setBusy(kind);
    setError(null);
    try {
      await downloadFile(`/reports/gst/gstr1/${kind}${path}`, `GSTR1-${gstin}-${fp}.${kind === "excel" ? "xlsx" : "json"}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="toolbar report-no-print">
      <Button size="small" busy={busy === "excel"} disabled={busy !== null} onClick={() => void get("excel")} title="One sheet per GSTR-1 section">
        Download GSTR-1 for Excel
      </Button>
      <Button size="small" busy={busy === "json"} disabled={busy !== null} onClick={() => void get("json")} title="The JSON file the GST portal accepts for GSTR-1">
        Download GSTR-1 for the GST portal (JSON)
      </Button>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface FiledRow {
  id: string;
  period: string;
  returnType: "gstr1" | "iff";
  filedOn: string;
}

/** Audit 4 (T15): mark the period as filed, so bills that arrive later go into the next open month. */
function FiledMark({ d }: { d: Gstr1Dto }) {
  const returnType = d.iff ? "iff" : "gstr1";
  const filed = useLoad(() => api.get<FiledRow[]>(`/reports/gst/filed${query({ gstRegistrationId: d.gstRegistrationId })}`), [d.gstRegistrationId]);
  const [filedOn, setFiledOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mark = filed.data?.find((f) => f.period === d.to.slice(0, 7) && f.returnType === returnType);
  const what = d.iff ? "IFF" : "GSTR-1";
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mark) await api.delete(`/reports/gst/filed/${mark.id}`);
      else await api.post("/reports/gst/filed", { gstRegistrationId: d.gstRegistrationId, period: d.period, returnType, filedOn });
      await filed.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (filed.loading && !filed.data) return null;
  return (
    <div className="toolbar report-no-print">
      {mark ? (
        <>
          <span>
            {what} for {d.periodLabel} marked as filed on {formatDate(mark.filedOn)}. Bills arriving later for it go into the next open month.
          </span>
          <Button size="small" variant="secondary" busy={busy} onClick={() => void save()}>
            Remove the filed mark
          </Button>
        </>
      ) : (
        <>
          <TextInput id="gst-filed-on" label={`Filed ${what} on`} type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
          <Button size="small" busy={busy} disabled={!filedOn} onClick={() => void save()} title="After filing on the GST portal: bills that arrive later for this period go into the next open month">
            Mark {what} as filed
          </Button>
        </>
      )}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Gstr1Report() {
  const g = useGstFilters({});
  const path = query({ period: g.period, gstRegistrationId: g.gstRegistrationId });
  const r = useReport<Gstr1Dto>(`/reports/gst/gstr1${path}`, g.ready);
  return (
    <ReportPage
      id="gst-gstr1"
      area="accounts"
      needs={GST}
      ready={g.ready}
      state={r}
      note="The outward supplies return, worked out from the till bills. Credit notes against business invoices and large other-state consumer invoices are listed; those against other consumer bills are netted into B2C small. Check the figures with your accountant before filing."
      filters={<GstFilters regs={g.regs} period={g.period} gstRegistrationId={g.gstRegistrationId} onChange={(p) => g.f.set(p)} />}
      summary={`${g.gstin} · ${r.data?.periodLabel ?? g.period}`}
      logFilters={{ gstin: g.gstin, period: g.period }}
      csv={gstr1Csv}
      fileName={csvName("gstr1-summary", g.gstin, g.period)}
    >
      {(d) => {
        const rec = d.reconciliation;
        const agrees = rec.sectionsAgree && rec.hsnAgrees && rec.documentsAgree;
        return (
          <>
            {d.iff ? <Alert kind="info">This month is an IFF (invoice furnishing facility): only business invoices and their credit notes. Consumer sales, nil-rated supplies, the HSN summary and documents issued go into the quarter&apos;s GSTR-1.</Alert> : null}
            {d.filedInIff ? <Alert kind="info">{d.filedInIff} business invoice{d.filedInIff === 1 ? "" : "s"} and note{d.filedInIff === 1 ? "" : "s"} already filed in this quarter&apos;s IFF {d.filedInIff === 1 ? "is" : "are"} left out of tables 4 and 9B.</Alert> : null}
            <PortalDownloads path={path} gstin={d.gstin} fp={d.fp} />
            <FiledMark d={d} />
            {agrees ? (
              <Alert kind="success">Every section, the HSN summary and the documents issued add up to the sales tax register.</Alert>
            ) : (
              <Alert kind="error">
                The sections do not add up to the sales tax register
                {!rec.sectionsAgree ? " (sections)" : ""}
                {!rec.hsnAgrees ? " (HSN summary)" : ""}
                {!rec.documentsAgree ? " (documents issued)" : ""}. Please tell your accountant before filing.
              </Alert>
            )}
            <Warnings list={d.warnings} />
            <Section title="Summary" columns={SECTION_COLUMNS} rows={sectionRows(d)} rowKey={(x) => x.key} />
            <Section title="B2B: business invoices (table 4)" columns={invoiceColumns(true, false)} rows={itemLines(d.b2b)} rowKey={(x) => x.key} />
            <Section title="B2C large: other-state consumer invoices above the limit (table 5)" hint="Above ₹1 lakh from the August 2024 return period (₹2.5 lakh before)." columns={invoiceColumns(false, false)} rows={itemLines(d.b2cl)} rowKey={(x) => x.key} />
            <Section title="B2C small: other consumer sales by state and rate (table 7)" hint="Net of credit notes against these bills." columns={B2CS_COLUMNS} rows={d.b2cs} rowKey={(x) => `${x.supplyType}${x.placeOfSupply}${x.rate}`} />
            <Section title="Credit notes to registered buyers (table 9B, CDNR)" columns={invoiceColumns(true, true)} rows={itemLines(d.cdnr)} rowKey={(x) => x.key} />
            <Section title="Credit notes to unregistered buyers (table 9B, CDNUR)" columns={invoiceColumns(false, true)} rows={itemLines(d.cdnur)} rowKey={(x) => x.key} />
            <Section title="Nil-rated and exempt supplies (table 8)" columns={NIL_COLUMNS} rows={d.nil} rowKey={(x) => x.supplyType} />
            <Section title="HSN summary: business (table 12, B2B)" columns={HSN_COLUMNS} rows={d.hsnBusiness} rowKey={(x) => `${x.hsn}${x.uqc}${x.rate}`} />
            <Section title="HSN summary: consumers (table 12, B2C)" columns={HSN_COLUMNS} rows={d.hsnConsumer} rowKey={(x) => `${x.hsn}${x.uqc}${x.rate}`} />
            <Section title="Documents issued (table 13)" columns={DOC_COLUMNS} rows={d.documents} rowKey={(x) => `${x.nature}${x.series}`} />
            {d.combineSmallSales ? (
              <section className="report-section">
                <h2>Sales under ₹200 as one invoice a day</h2>
                <p className="muted">Consumer sales under ₹200 with no buyer details, shown as one combined invoice per day and store. A view only: every bill is still recorded.</p>
                <ReportTable
                  columns={[col.date("date", "Date", (x: Gstr1Dto["smallSales"][number]) => x.date), col.text("store", "Store", (x: Gstr1Dto["smallSales"][number]) => x.store), col.count("bills", "Bills", (x: Gstr1Dto["smallSales"][number]) => x.bills), money("value", "Value", (x: Gstr1Dto["smallSales"][number]) => x.value), ...taxColumns<Gstr1Dto["smallSales"][number]>()]}
                  rows={d.smallSales}
                  rowKey={(x) => `${x.date}${x.store}`}
                  empty="No small sales in this period."
                  totals={false}
                />
              </section>
            ) : null}
          </>
        );
      }}
    </ReportPage>
  );
}

// ---- GSTR-3B ----

type HeadRow = { key: string; label: string; strong?: boolean } & HeadAmounts;
const HEAD_COLUMNS: ReportColumn<HeadRow>[] = [
  { key: "label", header: "", value: (x) => x.label, render: (x) => (x.strong ? <strong>{x.label}</strong> : x.label), wide: true },
  money<HeadRow>("igst", "IGST", (x) => x.igst),
  money<HeadRow>("cgst", "CGST", (x) => x.cgst),
  money<HeadRow>("sgst", "SGST", (x) => x.sgst),
  money<HeadRow>("total", "Total", (x) => x.total),
];
const hr = (key: string, label: string, h: HeadAmounts, strong = false): HeadRow => ({ key, label, strong, ...h });

function gstr3bLines(d: Gstr3bDto) {
  const o = d.outward;
  const outward = [
    { key: "a", label: "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", ...o.taxable },
    { key: "b", label: "(b) Outward taxable supplies (zero rated)", ...o.zeroRated },
    { key: "c", label: "(c) Other outward supplies (nil rated, exempted)", taxable: o.nilExempt, igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00", tax: "0.00" },
    { key: "d", label: "(d) Inward supplies (liable to reverse charge)", ...o.reverseChargeInward },
    { key: "e", label: "(e) Non-GST outward supplies", taxable: o.nonGst, igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00", tax: "0.00" },
  ];
  const c = d.credit;
  const credit = [
    hr("rc", "(A)(3) Inward supplies liable to reverse charge", c.reverseCharge),
    hr("other", "(A)(5) All other input credit", c.allOther),
    hr("reversed", "(B) Input credit reversed", c.reversed),
    hr("net", "(C) Net input credit of the period", c.net, true),
    hr("ineligible", "(D)(1) Ineligible input credit (added to cost; not claimed)", c.ineligible),
    ...(c.timeBarred ? [hr("barred", "(D)(2) Past the time limit (section 16(4); not claimed)", c.timeBarred)] : []),
    ...(c.notInGstr2b ? [hr("held", "Held back: not in this period’s GSTR-2B (claimed when the supplier reports it)", c.notInGstr2b)] : []),
    ...(c.fromEarlierGstr2b ? [hr("released", "Included in (A)(5): earlier bills now in GSTR-2B", c.fromEarlierGstr2b)] : []),
    hr("bf", "Credit brought forward from the period before", c.broughtForward),
    hr("available", "Credit available for set-off", c.available, true),
  ];
  const pay = [
    hr("output", "Output tax (from the accounts)", d.outputTaxFromAccounts),
    hr("credit", "Paid from input credit", d.setOff.paidByCredit),
    hr("cash", "Left to pay in cash", d.setOff.cash),
    hr("rcm", "Reverse-charge tax (cash only)", d.reverseChargePayable),
    hr("net", "Net GST payable", d.netPayable, true),
    hr("cf", "Input credit carried forward", d.creditCarriedForward, true),
  ];
  return { outward, credit, pay };
}

function gstr3bCsv(d: Gstr3bDto): CsvOutput {
  const { outward, credit, pay } = gstr3bLines(d);
  const rows: CsvCell[][] = [
    ...outward.map((x) => ["3.1", x.label, x.taxable, x.igst, x.cgst, x.sgst]),
    ...credit.map((x) => ["4", x.label, "", x.igst, x.cgst, x.sgst]),
    ...d.setOff.steps.map((s) => ["Set-off", `${HEAD_NAMES[s.credit]} credit used for ${HEAD_NAMES[s.against]}`, "", "", "", s.amount]),
    ...pay.map((x) => ["6.1", x.label, "", x.igst, x.cgst, x.sgst]),
    ...(d.inwardNoTax ? [["5", "Inward supplies with no GST: from another state", d.inwardNoTax.interState, "", "", ""], ["5", "Inward supplies with no GST: within the state", d.inwardNoTax.intraState, "", "", ""]] : []),
  ];
  return { headers: ["Table", "What", "Taxable value", "IGST", "CGST", "SGST"], rows, count: rows.length };
}

export function Gstr3bReport() {
  const g = useGstFilters({});
  const r = useReport<Gstr3bDto>(`/reports/gst/gstr3b${query({ period: g.period, gstRegistrationId: g.gstRegistrationId })}`, g.ready);
  return (
    <ReportPage
      id="gst-gstr3b"
      area="accounts"
      needs={GST}
      ready={g.ready}
      state={r}
      note="Tax and input credit per head are read from the accounts. Input credit is set off in the legal order: IGST credit first (against IGST, then CGST and SGST), then CGST credit (against CGST, then IGST) and SGST credit (against SGST, then IGST). CGST credit never pays SGST, nor SGST credit CGST. Reverse-charge tax is paid in cash."
      filters={<GstFilters regs={g.regs} period={g.period} gstRegistrationId={g.gstRegistrationId} onChange={(p) => g.f.set(p)} />}
      summary={`${g.gstin} · ${r.data?.periodLabel ?? g.period}`}
      logFilters={{ gstin: g.gstin, period: g.period }}
      csv={gstr3bCsv}
      fileName={csvName("gstr3b", g.gstin, g.period)}
    >
      {(d) => {
        const { outward, credit, pay } = gstr3bLines(d);
        return (
          <>
            <p className="report-headline">
              GST to pay for {d.periodLabel}: <strong><Amount value={d.totalPayable} /></strong>
            </p>
            <Warnings list={d.notes} />
            {d.composition ? (
              <section className="report-section">
                <h2>CMP-08 (composition) for {d.composition.periodLabel}</h2>
                <p className="muted">{d.composition.note}</p>
                <dl className="report-facts">
                  <dt>Taxable turnover in the state</dt>
                  <dd><Amount value={d.composition.outward.taxable} /></dd>
                  <dt>Exempt supplies (no tax)</dt>
                  <dd><Amount value={d.composition.outward.exempt} /></dd>
                  <dt>Tax at {d.composition.outward.rate}% (CGST + SGST)</dt>
                  <dd><Amount value={d.composition.outward.cgst} /> + <Amount value={d.composition.outward.sgst} /></dd>
                  <dt>Purchases on reverse charge (tax)</dt>
                  <dd><Amount value={d.composition.reverseCharge.tax} /></dd>
                  <dt><strong>Total to pay</strong></dt>
                  <dd><strong><Amount value={d.composition.payable.total} /></strong></dd>
                </dl>
              </section>
            ) : null}
            <Section title="3.1 Outward supplies and inward supplies liable to reverse charge" columns={[{ ...col.text<(typeof outward)[number]>("label", "Nature of supplies", (x) => x.label), wide: true }, ...taxColumns<(typeof outward)[number]>()]} rows={outward} rowKey={(x) => x.key} />
            <Section
              title="3.2 Of 3.1 (a), other-state supplies to unregistered persons"
              columns={[col.text<Gstr3bDto["interStateUnregistered"][number]>("pos", "Place of supply", (x) => stateText(x.placeOfSupply)), money("taxable", "Taxable value", (x: Gstr3bDto["interStateUnregistered"][number]) => x.taxable), money("igst", "IGST", (x: Gstr3bDto["interStateUnregistered"][number]) => x.igst)]}
              rows={d.interStateUnregistered}
              rowKey={(x) => x.placeOfSupply}
            />
            <Section title="4 Eligible input credit" columns={HEAD_COLUMNS} rows={credit} rowKey={(x) => x.key} />
            <section className="report-section">
              <h2>Set-off of input credit</h2>
              {d.setOff.steps.length === 0 ? (
                <p className="muted">No input credit was used this period.</p>
              ) : (
                <ol>
                  {d.setOff.steps.map((s, i) => (
                    <li key={i}>
                      {HEAD_NAMES[s.credit]} credit used for {HEAD_NAMES[s.against]}: <Amount value={s.amount} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {d.inwardNoTax && (
              <section className="report-section">
                <h2>5 Inward supplies with no GST (nil rated, exempt, composition suppliers)</h2>
                <p>
                  From another state: <Amount value={d.inwardNoTax.interState} /> · Within the state: <Amount value={d.inwardNoTax.intraState} />
                </p>
              </section>
            )}
            <Section title="6.1 Payment of tax" columns={HEAD_COLUMNS} rows={pay} rowKey={(x) => x.key} />
          </>
        );
      }}
    </ReportPage>
  );
}

// ---- Credit and debit note register ----

export function NotesRegisterReport() {
  const g = useGstFilters({});
  const r = useReport<NotesRegisterDto>(`/reports/gst/notes${query({ period: g.period, gstRegistrationId: g.gstRegistrationId })}`, g.ready);
  const columns: ReportColumn<NoteRegisterRow>[] = [
    col.text<NoteRegisterRow>("kind", "Kind", (x) => (x.kind === "credit_note" ? "Credit note (sales return)" : "Debit note (purchase return)")),
    col.text<NoteRegisterRow>("number", "Number", (x) => x.number),
    col.date<NoteRegisterRow>("date", "Date", (x) => x.date),
    { ...col.text<NoteRegisterRow>("party", "Customer or supplier", (x) => x.party), wide: true },
    col.text<NoteRegisterRow>("original", "Original bill", (x) => x.originalNumber ?? ""),
    col.date<NoteRegisterRow>("originalDate", "Original date", (x) => x.originalDate),
    col.date<NoteRegisterRow>("deadline", "Report by", (x) => x.deadline),
    { key: "status", header: "Deadline", value: (x) => NOTE_STATUS_LABELS[x.status], render: (x) => <span className={x.status === "late" ? "num-negative" : undefined}>{NOTE_STATUS_LABELS[x.status]}</span> },
    money<NoteRegisterRow>("value", "Value", (x) => x.value),
    ...taxColumns<NoteRegisterRow>(),
  ];
  return (
    <ReportPage
      id="gst-notes"
      area="accounts"
      needs={GST}
      ready={g.ready}
      state={r}
      note="A credit note reduces the tax of a sale only if it is reported by 30 November after the end of the sale's financial year (CGST Act section 34). Later notes still return the goods and the money, but the tax cannot be reduced."
      filters={<GstFilters regs={g.regs} period={g.period} gstRegistrationId={g.gstRegistrationId} onChange={(p) => g.f.set(p)} />}
      summary={`${g.gstin} · ${r.data?.periodLabel ?? g.period}`}
      logFilters={{ gstin: g.gstin, period: g.period }}
      csv={(d) => tableCsv(columns, d.rows, false)}
      fileName={csvName("credit-debit-notes", g.gstin, g.period)}
    >
      {(d) => (
        <>
          {d.totals.late ? <Alert kind="error">{d.totals.late} credit notes are after the 30 November deadline: their tax cannot be reduced in the return.</Alert> : null}
          <ReportTable columns={columns} rows={d.rows} rowKey={(x) => x.billId} empty="No credit or debit notes in this period." />
        </>
      )}
    </ReportPage>
  );
}

// ---- The GST returns area ----

/** The GST reports the user may run (the "GST returns" area of the report centre). */
export function GstReturnsHome() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  const list = REPORTS.filter((r) => r.frequency === "gst" && canSeeReport(user, r));
  return (
    <div className="area-accounts">
      <p className="report-crumbs">
        <Link href="/reports">All reports</Link>
      </p>
      <h1>GST returns</h1>
      <p className="muted">The figures for the monthly or quarterly GST returns, per GSTIN. Check them with your accountant before filing.</p>
      {list.length === 0 ? <Alert kind="info">You do not have the right to see the GST returns. Ask the owner if you need them.</Alert> : null}
      <ul className="report-list">
        {list.map((r) => (
          <li key={r.id} className={`area-${r.area}`}>
            <Link href={r.href} className="report-link">
              {r.title}
            </Link>
            {r.where ? <span className="report-where">{r.where}</span> : null}
            <p className="muted">{r.question}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
