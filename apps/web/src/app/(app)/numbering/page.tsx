// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { changeCounterSchema, createNumberSeriesSchema, NUMBER_PATTERN_TOKENS, NUMBER_SERIES_KINDS, numberSeriesKindName, updateNumberSeriesSchema } from "shared";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, TextareaInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { NumberPreviewRow, NumberSeriesDto, StoreDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

const TOKEN_HELP = `Tokens: ${NUMBER_PATTERN_TOKENS.map((t) => `{${t}}`).join(" ")}. Example: INV-{STORE}-{FY}-`;

interface SeriesForm {
  documentKind: string;
  pattern: string;
  counterLength: string;
  storeId: string;
  active: boolean;
}

const emptySeries: SeriesForm = { documentKind: "", pattern: "", counterLength: "5", storeId: "", active: true };

function PreviewPanel({ series, isOwnerAdmin, onChanged }: { series: NumberSeriesDto; isOwnerAdmin: boolean; onChanged: () => void }) {
  const preview = useLoad(() => api.get<NumberPreviewRow[]>(`/number-series/${series.id}/preview`), [series.id]);
  const [target, setTarget] = useState<NumberPreviewRow | null>(null);
  const [nextNumber, setNextNumber] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The preview opens under a long list: bring it into view.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  function openChange(row: NumberPreviewRow) {
    setTarget(row);
    setNextNumber(String(row.nextNumber));
    setReason("");
    setErrors({});
    setError(null);
  }

  async function submitChange(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    const parsed = changeCounterSchema.safeParse({ filledPrefix: target.filledPrefix, nextNumber: Number(nextNumber), reason });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.patch(`/number-series/${series.id}/counter`, parsed.data);
      setTarget(null);
      await preview.reload();
      onChanged();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<NumberPreviewRow>[] = [
    { key: "store", header: "Store", render: (r) => r.store?.code ?? series.store?.code ?? "All stores" },
    { key: "prefix", header: "Start of the number", render: (r) => <span className="mono">{r.filledPrefix}</span> },
    { key: "nextNumber", header: "Next running number", align: "right", render: (r) => r.nextNumber },
    { key: "next", header: "Next number", render: (r) => <strong className="mono">{r.next}</strong> },
    ...(isOwnerAdmin
      ? [
          {
            key: "change",
            header: "",
            render: (r: NumberPreviewRow) => (
              <Button size="small" onClick={() => openChange(r)}>
                Change counter
              </Button>
            ),
          } satisfies Column<NumberPreviewRow>,
        ]
      : []),
  ];

  return (
    <div className="card" ref={panel}>
      <h3 style={{ marginTop: 0 }}>Next {numberSeriesKindName(series.documentKind).toLowerCase()} numbers, if made today</h3>
      <Alert kind="error">{preview.error}</Alert>
      <DataTable columns={columns} rows={preview.data} rowKey={(r) => r.filledPrefix} loading={preview.loading} empty="No active store applies to this series." />
      <Dialog open={target !== null} title="Change counter" onClose={() => setTarget(null)}>
        {target ? (
          <form onSubmit={submitChange} noValidate>
            <Alert kind="info">
              Changing a counter can create duplicate or skipped numbers. The change is written to the history with your reason.
            </Alert>
            <Alert kind="error">{error}</Alert>
            <p>
              Prefix <span className="mono">{target.filledPrefix}</span>, currently at {target.nextNumber}.
            </p>
            <TextInput id="counter-next" label="Next number" type="number" min={1} step={1} value={nextNumber} onChange={(e) => setNextNumber(e.target.value)} error={errors.nextNumber} required />
            <TextareaInput id="counter-reason" label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} required />
            <div className="actions">
              <Button type="submit" variant="danger" busy={busy}>
                Change counter
              </Button>
              <Button onClick={() => setTarget(null)}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

export default function NumberingPage() {
  const { user } = useAuth();
  const isOwnerAdmin = user?.isOwnerAdmin ?? false;
  const series = useLoad(() => api.get<NumberSeriesDto[]>("/number-series"));
  const stores = useLoad(() => api.get<StoreDto[]>("/stores"));
  const [editing, setEditing] = useState<NumberSeriesDto | "new" | null>(null);
  const [form, setForm] = useState<SeriesForm>(emptySeries);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  function open(s: NumberSeriesDto | "new") {
    setErrors({});
    setError(null);
    setForm(
      s === "new"
        ? emptySeries
        : { documentKind: s.documentKind, pattern: s.pattern, counterLength: String(s.counterLength), storeId: s.storeId ?? "", active: s.active },
    );
    setEditing(s);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const counterLength = Number(form.counterLength);
    const parsed =
      editing === "new"
        ? createNumberSeriesSchema.safeParse({ documentKind: form.documentKind, pattern: form.pattern, counterLength, storeId: form.storeId || null })
        : updateNumberSeriesSchema.safeParse({ pattern: form.pattern, counterLength, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/number-series", parsed.data);
      else if (editing) await api.patch(`/number-series/${editing.id}`, parsed.data);
      setEditing(null);
      await series.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<NumberSeriesDto>[] = [
    { key: "kind", header: "Document", render: (s) => numberSeriesKindName(s.documentKind) },
    { key: "pattern", header: "Pattern", render: (s) => <span className="mono">{s.pattern}</span> },
    { key: "store", header: "Store", render: (s) => (s.store ? `${s.store.code} — ${s.store.name}` : "All stores") },
    { key: "len", header: "Counter length", align: "right", render: (s) => s.counterLength },
    { key: "active", header: "Status", render: (s) => <ActiveBadge active={s.active} /> },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <span className="row-actions">
          <Button size="small" onClick={() => open(s)}>
            Edit
          </Button>
          <Button size="small" onClick={() => setPreviewId(previewId === s.id ? null : s.id)} aria-expanded={previewId === s.id}>
            {previewId === s.id ? "Hide preview" : "Preview"}
          </Button>
        </span>
      ),
    },
  ];

  const previewed = series.data?.find((s) => s.id === previewId) ?? null;

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Document numbering</h1>
        <span className="spacer" />
        <Button variant="primary" onClick={() => open("new")}>
          Add series
        </Button>
      </div>
      <p className="muted">How the number on each kind of document looks. A store can have its own numbering for a kind; it is then used instead of the all-stores one.</p>
      <Alert kind="error">{series.error}</Alert>
      <DataTable columns={columns} rows={series.data && [...series.data].sort((a, b) => numberSeriesKindName(a.documentKind).localeCompare(numberSeriesKindName(b.documentKind)))} rowKey={(s) => s.id} loading={series.loading} empty="No number series yet." />
      {previewed ? <PreviewPanel key={previewed.id} series={previewed} isOwnerAdmin={isOwnerAdmin} onChanged={() => void series.reload()} /> : null}

      <Dialog open={editing !== null} title={editing === "new" ? "Add number series" : "Edit number series"} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <>
              <SelectInput id="ns-kind" label="Document" value={form.documentKind} onChange={(e) => setForm({ ...form, documentKind: e.target.value })} error={errors.documentKind} required>
                <option value="">Choose…</option>
                {Object.entries(NUMBER_SERIES_KINDS)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([kind, name]) => (
                    <option key={kind} value={kind}>
                      {name}
                    </option>
                  ))}
              </SelectInput>
              <SelectInput id="ns-store" label="Store" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })} error={errors.storeId}>
                <option value="">All stores</option>
                {(stores.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </SelectInput>
            </>
          ) : (
            <p>
              {numberSeriesKindName(form.documentKind)}
              {editing && editing.store ? ` for store ${editing.store.code}` : " for all stores"}
            </p>
          )}
          <TextInput id="ns-pattern" label="Pattern" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} error={errors.pattern} required hint={TOKEN_HELP} className="mono" />
          <TextInput id="ns-length" label="Counter length" type="number" min={3} max={10} value={form.counterLength} onChange={(e) => setForm({ ...form, counterLength: e.target.value })} error={errors.counterLength} required hint="Digits in the running number, padded with zeros." />
          {editing !== "new" ? <CheckInput id="ns-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy}>
              Save
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
