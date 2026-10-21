// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { INDIAN_STATES, MATCH_STATUS_LABELS, type MatchRow, type MatchStatus } from "shared";
import { Alert, Badge, Button, DataTable, SelectInput, type Column } from "@/components/ui";
import { api, downloadFile, errorMessage, query } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { type InwardStatementDto, matchTone, type MatchResultDto, monthOf, periodChoices, type PurchaseTaxRegisterDto, type PurchaseTaxRowDto } from "@/lib/gst-inward";
import { rupees } from "@/lib/purchasing";
import { useBusinessToday } from "@/lib/stock";
import type { GstRegistrationDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const stateLabel = (code: string | null) => (code ? `${INDIAN_STATES[code] ?? code} (${code})` : "—");

/** Choose the GSTIN (decision 64: every report is per GSTIN). */
function RegistrationSelect({ value, onChange, registrations }: { value: string; onChange: (id: string) => void; registrations: GstRegistrationDto[] }) {
  return (
    <SelectInput id="gst-registration" label="GSTIN" value={value} onChange={(e) => onChange(e.target.value)}>
      {registrations.map((r) => (
        <option key={r.id} value={r.id}>
          {r.gstin} — {stateLabel(r.stateCode)}
        </option>
      ))}
    </SelectInput>
  );
}

/** Plan 08 §3 and blueprint 13: supplier GSTIN, bill, tax per head, credit claimable or not, reverse charge. */
export function PurchaseTaxRegister() {
  const today = useBusinessToday();
  const regs = useLoad(() => api.get<GstRegistrationDto[]>("/company/gst-registrations"));
  const [regId, setRegId] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registration = regId || regs.data?.find((r) => r.isDefault)?.id || regs.data?.[0]?.id || "";
  const chosen = period || (today ? monthOf(today) : "");
  const report = useLoad(async () => (registration && chosen ? api.get<PurchaseTaxRegisterDto>(`/gst/purchase-register${query({ gstRegistrationId: registration, period: chosen })}`) : null), [registration, chosen]);

  async function download(format: "xlsx" | "csv") {
    setBusy(format);
    setError(null);
    try {
      await downloadFile(`/gst/purchase-register${query({ gstRegistrationId: registration, period: chosen, format })}`, `purchase-tax-register.${format}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<PurchaseTaxRowDto>[] = [
    {
      key: "bill",
      header: "Bill",
      render: (r) => (
        <>
          <Link href={`/purchases/bills/${r.billId}`} className="mono">
            {r.number}
          </Link>
          {r.kind === "debit_note" ? <div className="muted">Debit note</div> : null}
        </>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => (
        <>
          {r.supplier.name}
          <div className="muted mono">{r.supplierGstin ?? "Unregistered"}</div>
        </>
      ),
    },
    {
      key: "no",
      header: "Supplier's bill",
      render: (r) => (
        <>
          <span className="mono">{r.supplierBillNo}</span>
          <div className="muted">{formatDate(r.supplierBillDate)}</div>
        </>
      ),
    },
    { key: "pos", header: "Place of supply", render: (r) => stateLabel(r.placeOfSupply) },
    { key: "rates", header: "Rates", render: (r) => r.rates },
    { key: "taxable", header: "Taxable value", align: "right", render: (r) => rupees(r.taxable) },
    { key: "cgst", header: "CGST", align: "right", render: (r) => rupees(r.cgst) },
    { key: "sgst", header: "SGST", align: "right", render: (r) => rupees(r.sgst) },
    { key: "igst", header: "IGST", align: "right", render: (r) => rupees(r.igst) },
    { key: "credit", header: "Credit claimable", align: "right", render: (r) => rupees(r.creditClaimable) },
    { key: "blocked", header: "Not claimable (in cost)", align: "right", render: (r) => rupees(r.creditNotClaimable) },
    { key: "rcm", header: "Reverse charge", render: (r) => (r.reverseCharge ? <Badge kind="warn">Yes</Badge> : "No") },
  ];

  return (
    <>
      <h1>Purchase tax register</h1>
      <p className="muted">Every supplier bill and debit note of the period under one GSTIN, with the GST per head and how much input credit can be claimed.</p>
      <div className="card toolbar">
        {regs.data ? <RegistrationSelect value={registration} onChange={setRegId} registrations={regs.data} /> : null}
        {today ? (
          <SelectInput id="gst-period" label="Period" value={chosen} onChange={(e) => setPeriod(e.target.value)}>
            {periodChoices(today).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </SelectInput>
        ) : null}
        <Button busy={busy === "xlsx"} disabled={!report.data || busy !== null} onClick={() => void download("xlsx")}>
          Download for Excel
        </Button>
        <Button variant="link" busy={busy === "csv"} disabled={!report.data || busy !== null} onClick={() => void download("csv")}>
          CSV
        </Button>
      </div>
      <Alert kind="error">{error ?? regs.error ?? report.error}</Alert>
      <DataTable columns={columns} rows={report.data?.rows} rowKey={(r) => r.billId} loading={report.loading} empty="No supplier bills under this GSTIN in the period." />
      {report.data ? (
        <div className="card" aria-label="Register totals">
          <dl className="kv">
            <dt>Taxable value</dt>
            <dd>{rupees(report.data.totals.taxable)}</dd>
            <dt>CGST · SGST · IGST</dt>
            <dd>
              {rupees(report.data.totals.cgst)} · {rupees(report.data.totals.sgst)} · {rupees(report.data.totals.igst)}
            </dd>
            <dt>Input credit claimable</dt>
            <dd>
              <strong>{rupees(report.data.totals.creditClaimable)}</strong>
            </dd>
            <dt>Not claimable (added to cost)</dt>
            <dd>{rupees(report.data.totals.creditNotClaimable)}</dd>
            <dt>GST payable by the shop under reverse charge</dt>
            <dd>{rupees(report.data.totals.reverseChargeTax)}</dd>
          </dl>
        </div>
      ) : null}
    </>
  );
}

const STATUS_ORDER: MatchStatus[] = ["value_difference", "only_portal", "only_books", "matched"];

/** Plan 08 §3: upload the GSTR-2B downloaded from the portal and see what matches our bills. */
export function InputCreditMatching() {
  const regs = useLoad(() => api.get<GstRegistrationDto[]>("/company/gst-registrations"));
  const [regId, setRegId] = useState("");
  const registration = regId || regs.data?.find((r) => r.isDefault)?.id || regs.data?.[0]?.id || "";
  const [reload, setReload] = useState(0);
  const uploads = useLoad(async () => (registration ? api.get<InwardStatementDto[]>(`/gst/inward-statements${query({ gstRegistrationId: registration })}`) : []), [registration, reload]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? uploads.data?.[0]?.id ?? null;
  const result = useLoad(async () => (current ? api.get<MatchResultDto>(`/gst/inward-statements/${current}/match`) : null), [current]);
  const [filter, setFilter] = useState<MatchStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await api.upload<InwardStatementDto & { documents: number }>("/gst/inward-statements", form);
      setNote(`${up.fileName}: ${up.documents} documents for ${up.gstin}, ${up.period}.`);
      if (up.gstRegistrationId !== registration) setRegId(up.gstRegistrationId);
      setSelected(up.id);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const rows = (result.data?.rows ?? []).filter((r) => !filter || r.status === filter);
  const amounts = (side: MatchRow["portal"] | MatchRow["books"]) =>
    side ? (
      <>
        {rupees(side.taxable)}
        <div className="muted">GST {rupees((Number(side.cgst) + Number(side.sgst) + Number(side.igst)).toFixed(2))}</div>
      </>
    ) : (
      <span className="muted">—</span>
    );
  const columns: Column<MatchRow>[] = [
    { key: "status", header: "Result", render: (r) => <Badge kind={matchTone(r.status)}>{MATCH_STATUS_LABELS[r.status]}</Badge> },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => (
        <>
          {r.supplierName ?? "—"}
          <div className="muted mono">{r.supplierGstin}</div>
        </>
      ),
    },
    { key: "number", header: "Document", render: (r) => <span className="mono">{r.kind === "note" ? `Note ${r.number}` : r.number}</span> },
    { key: "portal", header: "On the portal", align: "right", render: (r) => amounts(r.portal) },
    {
      key: "books",
      header: "In our books",
      align: "right",
      render: (r) =>
        r.books ? (
          <>
            <Link href={`/purchases/bills/${r.books.id}`} className="mono">
              {r.books.ourNumber}
            </Link>
            <div>{amounts(r.books)}</div>
          </>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: "diff", header: "What differs", render: (r) => (r.differences.length ? r.differences.join("; ") : r.status === "only_books" ? "Not reported by the supplier yet" : r.status === "only_portal" ? "No bill recorded for it" : "") },
  ];

  return (
    <>
      <h1>Input credit matching</h1>
      <p className="muted">
        Download the GSTR-2B for a month from the GST portal (Returns, GSTR-2B, Download JSON), upload it here, and see which supplier bills match what your suppliers reported.
        Credit can be claimed only for what appears on the portal.
      </p>
      <div className="card toolbar">
        {regs.data ? (
          <RegistrationSelect
            value={registration}
            onChange={(id) => {
              setRegId(id);
              setSelected(null);
            }}
            registrations={regs.data}
          />
        ) : null}
        <label className="btn btn-secondary" htmlFor="gstr2b-file">
          {busy ? "Uploading…" : "Upload GSTR-2B (JSON)"}
        </label>
        <input
          ref={fileRef}
          id="gstr2b-file"
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="GSTR-2B JSON file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {uploads.data && uploads.data.length > 0 ? (
          <SelectInput id="gstr2b-upload" label="Statement" value={current ?? ""} onChange={(e) => setSelected(e.target.value)}>
            {uploads.data.map((u) => (
              <option key={u.id} value={u.id}>
                {u.period} · {u.fileName} · {formatDateTime(u.uploadedAt)}
              </option>
            ))}
          </SelectInput>
        ) : null}
      </div>
      <Alert kind="error">{error ?? regs.error ?? uploads.error ?? result.error}</Alert>
      {note ? <Alert kind="info">{note}</Alert> : null}
      {uploads.data && uploads.data.length === 0 ? <p className="muted">No statement has been uploaded for this GSTIN yet.</p> : null}
      {result.data ? (
        <>
          <div className="toolbar" role="group" aria-label="Show">
            <Button size="small" variant={filter === "" ? "primary" : undefined} onClick={() => setFilter("")}>
              All ({result.data.rows.length})
            </Button>
            {STATUS_ORDER.map((s) => (
              <Button key={s} size="small" variant={filter === s ? "primary" : undefined} onClick={() => setFilter(s)}>
                {MATCH_STATUS_LABELS[s]} ({result.data!.summary[s]})
              </Button>
            ))}
          </div>
          <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.status}|${r.supplierGstin}|${r.kind}|${r.number}|${r.books?.id ?? ""}`} loading={result.loading} empty="Nothing in this group." />
        </>
      ) : null}
    </>
  );
}
