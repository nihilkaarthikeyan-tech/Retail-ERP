// Copyright (c) 2026, Rademics. All rights reserved.
// E-invoices (plan 08 §4, scenario 8.10): business invoices and their credit notes
// waiting for registration on the government's e-invoice portal. Export them as the
// portal's bulk file, upload it there, then import the portal's answer to attach the
// reference number (IRN) and signed QR code. Cancelling is possible within 24 hours.
"use client";

import { useRef, useState } from "react";
import { EINVOICE_CANCEL_REASONS } from "shared";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, TextInput, TextareaInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { documentPrintHref, EINVOICE_STATUS, type EInvoiceList, type EInvoiceRow, type ExportResult, saveTextFile } from "@/lib/gst-portal";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

type Filter = "" | "waiting" | "near_limit" | "failed" | "registered" | "cancelled";

interface ImportSummary {
  registered: number;
  failed: number;
  cancelled: number;
  unchanged: number;
  unmatched: string[];
  problems: string[];
}

export function EInvoicesScreen() {
  const [filter, setFilter] = useState<Filter>("waiting");
  const [search, setSearch] = useState("");
  const list = useLoad(() => api.get<EInvoiceList>(`/gst/e-invoices${query({ status: filter || undefined, search: search.trim() || undefined })}`), [filter, search]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string; details?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cancelling, setCancelling] = useState<EInvoiceRow | null>(null);
  const [typing, setTyping] = useState<EInvoiceRow | null>(null);

  const rows = list.data?.rows ?? null;
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  async function exportFile() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<ExportResult>("/gst/e-invoices/export", selected.size ? { ids: [...selected] } : {});
      if (res.fileName && res.content) saveTextFile(res.fileName, res.content);
      const left = res.skipped.map((s) => `${s.documentNumber}: ${s.problems.join("; ")}`);
      setMessage({
        kind: res.count ? "success" : "error",
        text: res.count ? `${res.count} e-invoice${res.count === 1 ? "" : "s"} saved to ${res.fileName}. Upload the file on the e-invoice portal (Bulk upload), then import the portal’s answer here.` : "Nothing could be exported.",
        details: left.length ? [`Left out (correct them and export again):`, ...left] : undefined,
      });
      setSelected(new Set());
      await list.reload();
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const s = await api.upload<ImportSummary>("/gst/e-invoices/import", form);
      const details = [...(s.unmatched.length ? [`Not found here: ${s.unmatched.join(", ")}`] : []), ...s.problems];
      setMessage({ kind: details.length ? "info" : "success", text: `Registered ${s.registered}, failed ${s.failed}, cancelled ${s.cancelled}, already up to date ${s.unchanged}.`, details: details.length ? details : undefined });
      await list.reload();
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function retry(r: EInvoiceRow) {
    try {
      await api.post(`/gst/e-invoices/${r.id}/retry`);
      await list.reload();
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    }
  }

  const columns: Column<EInvoiceRow>[] = [
    {
      key: "pick",
      header: "",
      render: (r) => (r.status === "waiting" || r.status === "failed" ? <input type="checkbox" aria-label={`Choose ${r.documentNumber}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> : null),
    },
    {
      key: "document",
      header: "Document",
      render: (r) => (
        <>
          <a className="mono" href={documentPrintHref(r.documentType, r.documentId)} target="_blank" rel="noreferrer">
            {r.documentNumber}
          </a>
          <div className="muted">
            {r.documentKind} of {formatDate(r.documentDate)}
            {r.store ? ` · ${r.store}` : ""}
          </div>
        </>
      ),
    },
    {
      key: "buyer",
      header: "Buyer",
      render: (r) => (
        <>
          {r.buyerName ?? "—"}
          {r.buyerGstin ? <div className="mono muted">{r.buyerGstin}</div> : null}
        </>
      ),
    },
    { key: "total", header: "Value", align: "right", render: (r) => (r.total ? rupees(r.total) : "—") },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <>
          <Badge kind={EINVOICE_STATUS[r.status].kind}>{EINVOICE_STATUS[r.status].label}</Badge>
          {r.nearLimit ? (
            <div>
              <Badge kind="off">Register by {r.lastDay ? formatDate(r.lastDay) : "now"}</Badge>
            </div>
          ) : null}
          {r.error ? <div className="field-error">{r.error}</div> : null}
          {r.billCancelled && r.status === "registered" ? <div className="field-error">The bill was cancelled: cancel the IRN on the portal too.</div> : null}
          {r.exportedAt && r.status === "waiting" ? <div className="muted">Exported {formatDateTime(r.exportedAt)}</div> : null}
        </>
      ),
    },
    {
      key: "irn",
      header: "IRN and acknowledgement",
      render: (r) =>
        r.irn ? (
          <>
            <div className="mono" style={{ wordBreak: "break-all", maxWidth: "24rem" }}>
              {r.irn}
            </div>
            <div className="muted">
              Ack. {r.ackNumber} · {formatDateTime(r.ackDate)}
            </div>
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <span className="row-actions">
          {r.status === "failed" ? (
            <Button size="small" onClick={() => void retry(r)}>
              Try again
            </Button>
          ) : null}
          {r.status === "waiting" || r.status === "failed" ? (
            <Button size="small" onClick={() => setTyping(r)}>
              Enter IRN
            </Button>
          ) : null}
          {r.status === "registered" && r.canCancel ? (
            <Button size="small" onClick={() => setCancelling(r)}>
              Record cancellation
            </Button>
          ) : null}
          {r.status === "registered" && !r.canCancel ? <span className="muted">Over 24 hours: correct it with a credit note</span> : null}
        </span>
      ),
    },
  ];

  const counts = list.data?.counts;
  const filters: [Filter, string][] = [
    ["waiting", "Waiting"],
    ...(list.data?.thirtyDayLimit ? ([["near_limit", "Near the 30-day limit"]] as [Filter, string][]) : []),
    ["failed", "Failed"],
    ["registered", "Registered"],
    ["cancelled", "Cancelled"],
    ["", "All"],
  ];

  return (
    <>
      <h1>E-invoices</h1>
      <p className="muted">
        Business invoices and their credit notes must be registered on the government’s e-invoice portal before they are handed over. Until then they print as “not yet registered”.
      </p>
      {list.data && !list.data.applies ? <Alert kind="info">E-invoicing is switched off in the GST settings, so no new invoices are added here.</Alert> : null}
      <div className="filter-row">
        <SelectInput id="einv-status" label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {filters.map(([k, label]) => (
            <option key={k || "all"} value={k}>
              {label}
              {k && counts ? ` (${counts[k as keyof typeof counts] ?? 0})` : ""}
            </option>
          ))}
        </SelectInput>
        <TextInput id="einv-search" label="Document number" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void exportFile()}>
          {selected.size ? `Export ${selected.size} chosen for the portal` : "Export all waiting for the portal"}
        </Button>
        <Button busy={busy} onClick={() => fileRef.current?.click()}>
          Import the portal’s answer
        </Button>
        <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" hidden aria-label="Portal answer file" onChange={(e) => void importFile(e.target.files?.[0])} />
      </div>
      {message ? (
        <Alert kind={message.kind}>
          {message.text}
          {message.details ? (
            <ul>
              {message.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <Alert kind="error">{list.error}</Alert>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={list.loading} empty="No e-invoices here." />
      <CancelDialog row={cancelling} onClose={() => setCancelling(null)} onDone={() => void list.reload()} />
      <TypeInDialog row={typing} onClose={() => setTyping(null)} onDone={() => void list.reload()} />
    </>
  );
}

function CancelDialog({ row, onClose, onDone }: { row: EInvoiceRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<keyof typeof EINVOICE_CANCEL_REASONS>("2");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gst/e-invoices/${row.id}/cancel`, { reason, remark: remark.trim() || undefined });
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={row !== null} title="Record the cancellation" onClose={onClose}>
      <p>
        Cancel IRN of <span className="mono">{row?.documentNumber}</span> on the e-invoice portal first (allowed within 24 hours of registration), then record it here.
      </p>
      <Alert kind="error">{error}</Alert>
      <SelectInput id="einv-cancel-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value as keyof typeof EINVOICE_CANCEL_REASONS)}>
        {Object.entries(EINVOICE_CANCEL_REASONS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectInput>
      <TextareaInput id="einv-cancel-remark" label="Remark (optional)" rows={2} maxLength={100} value={remark} onChange={(e) => setRemark(e.target.value)} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Record cancellation
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function TypeInDialog({ row, onClose, onDone }: { row: EInvoiceRow | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ irn: "", ackNumber: "", ackDate: "", signedQr: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gst/e-invoices/${row.id}/registration`, { ...form, ackDate: form.ackDate.replace("T", " ") });
      setForm({ irn: "", ackNumber: "", ackDate: "", signedQr: "" });
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={row !== null} title="Enter the registration by hand" onClose={onClose}>
      <p>
        For <span className="mono">{row?.documentNumber}</span>, copy the details shown by the e-invoice portal. Importing the portal’s answer file is quicker for many invoices.
      </p>
      <Alert kind="error">{error}</Alert>
      <TextInput id="einv-irn" label="IRN (64 characters)" value={form.irn} onChange={(e) => setForm({ ...form, irn: e.target.value })} />
      <TextInput id="einv-ack" label="Acknowledgement number" value={form.ackNumber} onChange={(e) => setForm({ ...form, ackNumber: e.target.value })} />
      <TextInput id="einv-ackdt" label="Acknowledgement date and time" type="datetime-local" value={form.ackDate} onChange={(e) => setForm({ ...form, ackDate: e.target.value })} />
      <TextareaInput id="einv-qr" label="Signed QR code" rows={3} value={form.signedQr} onChange={(e) => setForm({ ...form, signedQr: e.target.value })} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
