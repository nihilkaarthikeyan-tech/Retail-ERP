// Copyright (c) 2026, Rademics. All rights reserved.
// E-way bills (plan 08 §4, scenario 8.10): goods moving above the limit need one.
// Make a draft from a bill or transfer (distance, transporter or vehicle), export
// the drafts as the e-way bill portal's bulk file, then enter or import the number
// the portal gives. Validity: one day per 200 km or part, ending at midnight.
"use client";

import { useRef, useState } from "react";
import { eWayValidityDays } from "shared";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { documentPrintHref, EWAY_STATUS, type EWayList, type EWayNeeded, type EWayRow, type ExportResult, indianDateTime, saveTextFile, stateName } from "@/lib/gst-portal";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

type Filter = "" | "draft" | "generated" | "expiring" | "expired" | "cancelled";

interface ImportSummary {
  generated: number;
  failed: number;
  unchanged: number;
  unmatched: string[];
  problems: string[];
}

export function EWayBillsScreen() {
  const [filter, setFilter] = useState<Filter>("");
  const [search, setSearch] = useState("");
  const list = useLoad(() => api.get<EWayList>(`/gst/e-way-bills${query({ status: filter || undefined, search: search.trim() || undefined })}`), [filter, search]);
  const needed = useLoad(() => api.get<EWayNeeded[]>("/gst/e-way-bills/needed"), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string; details?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [making, setMaking] = useState<EWayNeeded | null>(null);
  const [numbering, setNumbering] = useState<EWayRow | null>(null);
  const [cancelling, setCancelling] = useState<EWayRow | null>(null);

  const reload = async () => {
    await Promise.all([list.reload(), needed.reload()]);
  };
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  async function exportFile() {
    if (!selected.size) return setMessage({ kind: "error", text: "Choose the drafts to export." });
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<ExportResult>("/gst/e-way-bills/export", { ids: [...selected] });
      if (res.fileName && res.content) saveTextFile(res.fileName, res.content);
      const left = res.skipped.map((s) => `${s.documentNumber}: ${s.problems.join("; ")}`);
      setMessage({
        kind: res.count ? "success" : "error",
        text: res.count ? `${res.count} e-way bill${res.count === 1 ? "" : "s"} saved to ${res.fileName}. Upload it on the e-way bill portal (Bulk generation), then enter or import the numbers.` : "Nothing could be exported.",
        details: left.length ? ["Left out:", ...left] : undefined,
      });
      setSelected(new Set());
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
      const s = await api.upload<ImportSummary>("/gst/e-way-bills/import", form);
      const details = [...(s.unmatched.length ? [`Not found here: ${s.unmatched.join(", ")}`] : []), ...s.problems];
      setMessage({ kind: details.length ? "info" : "success", text: `Numbers recorded ${s.generated}, refused ${s.failed}, already up to date ${s.unchanged}.`, details: details.length ? details : undefined });
      await reload();
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const columns: Column<EWayRow>[] = [
    { key: "pick", header: "", render: (r) => (r.status === "draft" ? <input type="checkbox" aria-label={`Choose ${r.documentNumber}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> : null) },
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
          </div>
        </>
      ),
    },
    {
      key: "route",
      header: "From → to",
      render: (r) => (
        <>
          {stateName(r.fromState)} → {stateName(r.toState)}
          {r.to ? <div className="muted">{r.to}</div> : null}
        </>
      ),
    },
    { key: "value", header: "Value", align: "right", render: (r) => rupees(r.value) },
    {
      key: "transport",
      header: "Transport",
      render: (r) => (
        <>
          {r.distanceKm !== null ? `${r.distanceKm} km · ${r.validityDays} day${r.validityDays === 1 ? "" : "s"}` : "—"}
          <div className="muted">{[r.vehicleNo, r.transporterName, r.transporterId].filter(Boolean).join(" · ") || "No vehicle or transporter yet"}</div>
        </>
      ),
    },
    {
      key: "status",
      header: "E-way bill",
      render: (r) => (
        <>
          <Badge kind={EWAY_STATUS[r.status].kind}>{EWAY_STATUS[r.status].label}</Badge>
          {r.expiring ? (
            <div>
              <Badge kind="off">Expiring</Badge>
            </div>
          ) : null}
          {r.number ? <div className="mono">{r.number}</div> : null}
          {r.validUntil ? <div className="muted">Valid until {formatDateTime(r.validUntil)}</div> : null}
          {r.error ? <div className="field-error">{r.error}</div> : null}
        </>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <span className="row-actions">
          {r.status === "draft" ? (
            <Button size="small" onClick={() => setNumbering(r)}>
              Enter number
            </Button>
          ) : null}
          {r.canCancel ? (
            <Button size="small" onClick={() => setCancelling(r)}>
              Cancel
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const neededColumns: Column<EWayNeeded>[] = [
    {
      key: "document",
      header: "Document",
      render: (d) => (
        <>
          <span className="mono">{d.number}</span>
          <div className="muted">
            {d.documentType === "stock_document" ? "Transfer" : "Bill"} of {formatDate(d.date)}
          </div>
        </>
      ),
    },
    { key: "route", header: "From → to", render: (d) => `${stateName(d.fromState)} → ${stateName(d.toState)}` },
    { key: "value", header: "Value", align: "right", render: (d) => rupees(d.value) },
    { key: "limit", header: "Limit", align: "right", render: (d) => rupees(d.limit) },
    {
      key: "make",
      header: "",
      render: (d) => (
        <Button size="small" variant="primary" onClick={() => setMaking(d)}>
          Make e-way bill
        </Button>
      ),
    },
  ];

  const counts = list.data?.counts ?? {};
  const filters: [Filter, string][] = [
    ["", "All"],
    ["draft", "Drafts"],
    ["generated", "Made"],
    ["expiring", "Expiring"],
    ["expired", "Expired"],
    ["cancelled", "Cancelled"],
  ];

  return (
    <>
      <h1>E-way bills</h1>
      <p className="muted">Goods moving to another state above ₹50,000 (or above a state’s own limit inside it) need an e-way bill. It is valid one day for every 200 km or part, ending at midnight.</p>

      <h2>Needing an e-way bill</h2>
      <Alert kind="error">{needed.error}</Alert>
      <DataTable columns={neededColumns} rows={needed.data ?? null} rowKey={(d) => d.documentId} loading={needed.loading} empty="Nothing above the limit is waiting for an e-way bill." />

      <h2>Register</h2>
      <div className="filter-row">
        <SelectInput id="ewb-status" label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {filters.map(([k, label]) => (
            <option key={k || "all"} value={k}>
              {label}
              {k ? ` (${counts[k] ?? 0})` : ""}
            </option>
          ))}
        </SelectInput>
        <TextInput id="ewb-search" label="Document or e-way bill number" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void exportFile()}>
          Export chosen drafts for the portal
        </Button>
        <Button busy={busy} onClick={() => fileRef.current?.click()}>
          Import numbers from a file
        </Button>
        <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" hidden aria-label="E-way bill file" onChange={(e) => void importFile(e.target.files?.[0])} />
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
      <DataTable columns={columns} rows={list.data?.rows ?? null} rowKey={(r) => r.id} loading={list.loading} empty="No e-way bills here." />

      <DraftDialog doc={making} onClose={() => setMaking(null)} onDone={() => void reload()} />
      <NumberDialog row={numbering} onClose={() => setNumbering(null)} onDone={() => void reload()} />
      <CancelDialog row={cancelling} onClose={() => setCancelling(null)} onDone={() => void reload()} />
    </>
  );
}

function DraftDialog({ doc, onClose, onDone }: { doc: EWayNeeded | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ distanceKm: "", vehicleNo: "", transporterId: "", transporterName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const km = Number(form.distanceKm);
  async function save() {
    if (!doc) return;
    if (!form.vehicleNo.trim() && !form.transporterId.trim()) return setError("Give the vehicle number or the transporter id.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/gst/e-way-bills", { documentType: doc.documentType, documentId: doc.documentId, distanceKm: form.distanceKm, vehicleNo: form.vehicleNo || null, transporterId: form.transporterId || null, transporterName: form.transporterName || null });
      setForm({ distanceKm: "", vehicleNo: "", transporterId: "", transporterName: "" });
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={doc !== null} title="Make an e-way bill" onClose={onClose}>
      <p>
        For <span className="mono">{doc?.number}</span>, value {doc ? rupees(doc.value) : ""}.
      </p>
      <Alert kind="error">{error}</Alert>
      <TextInput
        id="ewb-distance"
        label="Approximate distance (km)"
        type="number"
        min={0}
        max={4000}
        value={form.distanceKm}
        onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
        hint={form.distanceKm !== "" && km >= 0 && km <= 4000 ? `Valid for ${eWayValidityDays(km)} day${eWayValidityDays(km) === 1 ? "" : "s"} from when it is made` : "Up to 4,000 km"}
      />
      <TextInput id="ewb-vehicle" label="Vehicle number" value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} hint="For example TN01AB1234" />
      <TextInput id="ewb-transporter-id" label="Transporter id (GSTIN or TRANSIN)" value={form.transporterId} onChange={(e) => setForm({ ...form, transporterId: e.target.value })} />
      <TextInput id="ewb-transporter-name" label="Transporter name" value={form.transporterName} onChange={(e) => setForm({ ...form, transporterName: e.target.value })} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save draft
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function NumberDialog({ row, onClose, onDone }: { row: EWayRow | null; onClose: () => void; onDone: () => void }) {
  const [number, setNumber] = useState("");
  const [madeAt, setMadeAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gst/e-way-bills/${row.id}/generated`, { number: number.trim(), generatedAt: indianDateTime(madeAt) });
      setNumber("");
      setMadeAt("");
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={row !== null} title="Enter the e-way bill number" onClose={onClose}>
      <p>
        For <span className="mono">{row?.documentNumber}</span>
        {row?.validityDays ? `: valid ${row.validityDays} day${row.validityDays === 1 ? "" : "s"} for ${row.distanceKm} km` : ""}.
      </p>
      <Alert kind="error">{error}</Alert>
      <TextInput id="ewb-number" label="E-way bill number (12 digits)" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
      <TextInput id="ewb-made" label="Made on (leave empty for now)" type="datetime-local" value={madeAt} onChange={(e) => setMadeAt(e.target.value)} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function CancelDialog({ row, onClose, onDone }: { row: EWayRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gst/e-way-bills/${row.id}/cancel`, { reason });
      setReason("");
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={row !== null} title={row?.status === "draft" ? "Cancel the draft" : "Record the cancellation"} onClose={onClose}>
      <p>{row?.status === "generated" ? "Cancel it on the e-way bill portal first (within 24 hours of making it), then record it here." : `Draft for ${row?.documentNumber ?? ""}.`}</p>
      <Alert kind="error">{error}</Alert>
      <TextInput id="ewb-cancel-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Cancel it
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
