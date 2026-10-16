// Copyright (c) 2026, Rademics. All rights reserved.
// Settings → Printing (plan 10 §5.2): the paper, the logo and letterhead, and
// standard terms (reusable footer text such as a return policy).
"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useId, useState } from "react";
import { hasPermission, PRINT_KINDS, type PrintKind } from "shared";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, RadioInput, TextareaInput, TextInput, type Column } from "@/components/ui";
import { api, API_URL, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logoProblem, PRINT_KIND_LABELS, type PrintSettingsDto, TERMS_USE_LABELS, type TermsDto, type TermsUse } from "@/lib/documents";
import { useLoad } from "@/lib/use-load";

export function PrintingSettings() {
  const { user, loading } = useAuth();
  const allowed = hasPermission(user, "print.settings");
  if (loading) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <>
        <h1>Printing settings</h1>
        <Alert kind="error">Only the Owner can change the letterhead and standard terms.</Alert>
      </>
    );
  }
  return (
    <>
      <h1>Printing settings</h1>
      <p className="muted">How purchase orders, goods receipts, transfer slips, count sheets, payment receipts, journals and statements look when printed or saved as PDF.</p>
      <PaperAndLetterhead />
      <StandardTerms />
    </>
  );
}

function PaperAndLetterhead() {
  const settings = useLoad(() => api.get<PrintSettingsDto>("/print/settings"));
  const [form, setForm] = useState<Omit<PrintSettingsDto, "hasLogo"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const s = settings.data;
  const values = form ?? (s ? { paperSize: s.paperSize, showLogo: s.showLogo, storeLetterhead: s.storeLetterhead } : null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setBusy(true);
    setMessage(null);
    try {
      settings.setData(await api.put<PrintSettingsDto>("/print/settings", values));
      setForm(null);
      setMessage({ kind: "success", text: "Saved. New prints use these settings." });
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (settings.error) return <Alert kind="error">{settings.error}</Alert>;
  if (!s || !values) return <p className="muted">Loading…</p>;
  const set = (patch: Partial<typeof values>) => setForm({ ...values, ...patch });

  return (
    <>
      <form className="card" onSubmit={save} noValidate>
        <h2 style={{ marginTop: 0 }}>Paper and letterhead</h2>
        <fieldset>
          <legend>Paper size</legend>
          <div className="check-row">
            <RadioInput id="paper-a4" name="paper" label="A4" description="A full sheet (210 × 297 mm)" checked={values.paperSize === "A4"} onChange={() => set({ paperSize: "A4" })} />
            <RadioInput id="paper-a5" name="paper" label="A5" description="Half a sheet (148 × 210 mm)" checked={values.paperSize === "A5"} onChange={() => set({ paperSize: "A5" })} />
          </div>
        </fieldset>
        <CheckInput
          id="print-logo"
          label="Print the logo at the top"
          description={s.hasLogo ? "The logo uploaded below." : "No logo has been uploaded yet; upload one below."}
          checked={values.showLogo}
          onChange={(e) => set({ showLogo: e.target.checked })}
        />
        <CheckInput
          id="print-store"
          label="Print each store’s own name, address and GSTIN"
          description="When this is off, the company’s address and GSTIN are printed on every store’s documents."
          checked={values.storeLetterhead}
          onChange={(e) => set({ storeLetterhead: e.target.checked })}
        />
        {message ? <Alert kind={message.kind}>{message.text}</Alert> : null}
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy} disabled={!form}>
            Save
          </Button>
        </div>
      </form>
      <LogoCard hasLogo={s.hasLogo} onSaved={settings.setData} />
    </>
  );
}

function LogoCard({ hasLogo, onSaved }: { hasLogo: boolean; onSaved: (s: PrintSettingsDto) => void }) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Changes after an upload so the browser asks for the new picture, not its cached copy.
  const [version, setVersion] = useState(0);

  // The chosen picture's preview address is released when it is replaced or the page closes.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | undefined) {
    setDone(false);
    const why = f ? logoProblem(f) : null;
    setProblem(why);
    setFile(f && !why ? f : null);
    setPreview(f && !why ? URL.createObjectURL(f) : null);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.append("file", file);
      onSaved(await api.upload<PrintSettingsDto>("/print/logo", form));
      setFile(null);
      setPreview(null);
      setVersion((v) => v + 1);
      setDone(true);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Logo</h2>
      <div className="doc-logo-row">
        <div>
          <div className="field-hint">Now</div>
          {hasLogo ? (
            <Image className="doc-logo-preview" src={`${API_URL}/print/logo?v=${version}`} alt="The logo now in use" width={200} height={80} unoptimized />
          ) : (
            <div className="doc-logo-preview image-empty">No logo</div>
          )}
        </div>
        {preview ? (
          <div>
            <div className="field-hint">New</div>
            <Image className="doc-logo-preview" src={preview} alt="The chosen logo" width={200} height={80} unoptimized />
          </div>
        ) : null}
      </div>
      <Alert kind="error">{problem}</Alert>
      {done ? <Alert kind="success">The new logo is saved.</Alert> : null}
      <div className="actions">
        <label htmlFor={inputId} className="btn">
          Choose a picture…
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {file ? (
          <Button variant="primary" busy={busy} onClick={() => void upload()}>
            Upload this logo
          </Button>
        ) : null}
      </div>
      <p className="field-hint">A PNG or JPEG picture smaller than 300 KB. A wide logo on a white background prints best.</p>
    </section>
  );
}

// ---- Standard terms ----

interface TermsDraft {
  title: string;
  text: string;
  usedFor: TermsUse;
  defaultFor: PrintKind[];
  active: boolean;
}

const EMPTY_TERMS: TermsDraft = { title: "", text: "", usedFor: "both", defaultFor: [], active: true };

function StandardTerms() {
  const terms = useLoad(() => api.get<TermsDto[]>("/print/terms"));
  const [editing, setEditing] = useState<TermsDto | "new" | null>(null);

  const columns: Column<TermsDto>[] = [
    {
      key: "title",
      header: "Title",
      render: (t) => (
        <>
          <strong>{t.title}</strong>
          <div className="muted doc-terms-text">{t.text}</div>
        </>
      ),
    },
    { key: "used", header: "Used for", render: (t) => TERMS_USE_LABELS[t.usedFor] },
    { key: "on", header: "Printed on", render: (t) => (t.defaultFor.length ? t.defaultFor.map((k) => PRINT_KIND_LABELS[k]).join(", ") : <span className="muted">Not printed by itself</span>) },
    { key: "active", header: "Status", render: (t) => <ActiveBadge active={t.active} /> },
    {
      key: "edit",
      header: "",
      render: (t) => (
        <Button size="small" onClick={() => setEditing(t)}>
          Change
        </Button>
      ),
    },
  ];

  return (
    <section className="card">
      <div className="toolbar" style={{ marginTop: 0 }}>
        <h2 style={{ margin: 0 }}>Standard terms</h2>
        <span className="spacer" />
        <Button variant="primary" size="small" onClick={() => setEditing("new")}>
          Add terms
        </Button>
      </div>
      <p className="muted">Text printed at the bottom of documents, such as payment terms or a return policy. Terms for buying print on purchase orders and goods receipts; terms for selling print on statements.</p>
      <Alert kind="error">{terms.error}</Alert>
      <DataTable columns={columns} rows={terms.data} rowKey={(t) => t.id} loading={terms.loading} empty="No standard terms yet." />
      {editing ? (
        <TermsDialog
          terms={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(rows) => {
            terms.setData(rows);
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function TermsDialog({ terms, onClose, onSaved }: { terms: TermsDto | null; onClose: () => void; onSaved: (rows: TermsDto[]) => void }) {
  const [draft, setDraft] = useState<TermsDraft>(terms ? { title: terms.title, text: terms.text, usedFor: terms.usedFor, defaultFor: terms.defaultFor, active: terms.active } : EMPTY_TERMS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TermsDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const problems: Record<string, string> = {};
    if (!draft.title.trim()) problems.title = "Give the terms a title";
    if (!draft.text.trim()) problems.text = "Write the text to print";
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    setError(null);
    try {
      const body = { ...draft, title: draft.title.trim(), text: draft.text.trim() };
      onSaved(terms ? await api.patch<TermsDto[]>(`/print/terms/${terms.id}`, body) : await api.post<TermsDto[]>("/print/terms", body));
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={terms ? `Change “${terms.title}”` : "Add standard terms"} onClose={onClose}>
      <form onSubmit={save} noValidate className="doc-form">
        <TextInput id="terms-title" label="Title" value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} error={errors.title} required hint="For you to recognise it, for example “Return policy”." />
        <TextareaInput id="terms-text" label="Text to print" rows={5} maxLength={2000} value={draft.text} onChange={(e) => set({ text: e.target.value })} error={errors.text} required />
        <fieldset>
          <legend>Used for</legend>
          <div className="check-row">
            {(Object.keys(TERMS_USE_LABELS) as TermsUse[]).map((u) => (
              <RadioInput key={u} id={`terms-use-${u}`} name="terms-use" label={TERMS_USE_LABELS[u]} checked={draft.usedFor === u} onChange={() => set({ usedFor: u })} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Print on these documents</legend>
          <div className="check-row">
            {PRINT_KINDS.map((k) => (
              <CheckInput
                key={k}
                id={`terms-on-${k}`}
                label={PRINT_KIND_LABELS[k]}
                checked={draft.defaultFor.includes(k)}
                onChange={(e) => set({ defaultFor: e.target.checked ? [...draft.defaultFor, k] : draft.defaultFor.filter((x) => x !== k) })}
              />
            ))}
          </div>
        </fieldset>
        <CheckInput id="terms-active" label="In use" description="Terms not in use are never printed." checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
