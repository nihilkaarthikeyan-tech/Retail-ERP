// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { createStockDocumentSchema, STOCK_IN_REASONS, STOCK_OUT_REASONS, updateStockDocumentSchema } from "shared";
import { Alert, Button, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import { canDraftKind, canFinaliseKind, defaultStoreId, indianTime, KIND_LABELS, REASON_LABELS, stockLocationsOf, storesFromLocations, useBusinessToday } from "@/lib/stock";
import type { ItemDto, StockDocumentDto, StockLocationDto, StoreRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { CancelDocumentDialog, StockStatusBadge } from "./stock-doc-parts";
import { StockItemAdder } from "./stock-item-adder";
import { type EditableKind, emptyLine, type LineDraft, lineFromDto, lineProblem, lineToInput, StockLineGrid } from "./stock-line-grid";

interface StockDocumentEditorProps {
  kind: EditableKind;
  /** The saved draft, or null for a new document. */
  doc: StockDocumentDto | null;
  locations: StockLocationDto[];
  /** Stores a transfer can go to (all active stores of the company when known). */
  receivingStores: StoreRef[];
  /** After every successful save, finalise or cancel. */
  onSaved: (doc: StockDocumentDto) => void;
}

/** Editor for a stock in, write-off, move inside a store, or transfer to another store. */
export function StockDocumentEditor(props: StockDocumentEditorProps) {
  const { doc } = props;
  const itemIds = doc ? [...new Set(doc.lines.map((l) => l.item.id))] : [];
  const items = useLoad<ItemDto[]>(() => Promise.all(itemIds.map((id) => api.get<ItemDto>(`/items/${id}`))), [doc?.id, itemIds.join(",")]);
  if (items.error) return <Alert kind="error">{`Could not load the items of this document: ${items.error}`}</Alert>;
  if (!items.data) return <p className="muted">Loading…</p>;
  const byId = new Map(items.data.map((i) => [i.id, i]));
  const lines = doc ? doc.lines.flatMap((l) => (byId.has(l.item.id) ? [lineFromDto(l, byId.get(l.item.id)!)] : [])) : [];
  return <EditorForm key={doc ? `${doc.id}-${doc.status}` : "new"} {...props} initialLines={lines} />;
}

interface HeaderState {
  storeId: string;
  reason: string;
  fromLocationId: string;
  toLocationId: string;
  toStoreId: string;
  postingDate: string;
  postingTime: string;
  remarks: string;
}

function EditorForm({ kind, doc, locations, receivingStores, onSaved, initialLines }: StockDocumentEditorProps & { initialLines: LineDraft[] }) {
  const { user } = useAuth();
  const today = useBusinessToday();
  const stores = storesFromLocations(locations);
  const canDraft = canDraftKind(user, kind);
  const canFinalise = canFinaliseKind(user, kind);
  const editable = canDraft && (!doc || doc.status === "draft");

  const [header, setHeader] = useState<HeaderState>(() => ({
    storeId: doc?.storeId ?? defaultStoreId(user, stores),
    reason: doc?.reason ?? (kind === "stock_in" ? "found" : kind === "stock_out" ? "damage" : ""),
    fromLocationId: doc?.fromLocationId ?? "",
    toLocationId: doc && kind !== "transfer_send" ? (doc.toLocationId ?? "") : "",
    toStoreId: doc?.toStoreId ?? "",
    postingDate: doc?.postingDate ?? "",
    postingTime: doc ? indianTime(doc.postingAt) : "",
    remarks: doc?.remarks ?? "",
  }));
  const [dateTouched, setDateTouched] = useState(false);
  const [lines, setLinesState] = useState<LineDraft[]>(initialLines);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "finalise" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const shelves = header.storeId ? stockLocationsOf(locations, header.storeId) : [];
  const needsFrom = kind === "stock_out" || kind === "move" || kind === "transfer_send";
  const needsTo = kind === "stock_in" || kind === "move";
  const reasons: readonly string[] = kind === "stock_in" ? STOCK_IN_REASONS : kind === "stock_out" ? STOCK_OUT_REASONS : [];

  function set<K extends keyof HeaderState>(key: K, value: HeaderState[K]) {
    setHeader((h) => ({ ...h, [key]: value }));
    setDirty(true);
    setSaved(null);
    if (key === "postingDate" || key === "postingTime") setDateTouched(true);
  }

  function setLines(next: LineDraft[]) {
    setLinesState(next);
    setDirty(true);
    setSaved(null);
  }

  /** Checks everything locally; returns the body to send, or null (and shows why). */
  function prepare(): Record<string, unknown> | null {
    setError(null);
    const headerErrors: FieldErrors = {};
    if (!header.storeId) headerErrors.storeId = "Choose the store";
    if (reasons.length && !header.reason) headerErrors.reason = "Choose a reason";
    if (needsFrom && !header.fromLocationId) headerErrors.fromLocationId = "Choose where the stock leaves from";
    if (needsTo && !header.toLocationId) headerErrors.toLocationId = "Choose where the stock goes";
    if (kind === "move" && header.fromLocationId && header.fromLocationId === header.toLocationId) headerErrors.toLocationId = "The two locations must differ";
    if (kind === "transfer_send" && !header.toStoreId) headerErrors.toStoreId = "Choose the receiving store";
    if (header.postingDate && today && header.postingDate > today) headerErrors.postingDate = "Stock movements cannot be dated in the future";

    const lineIssues: Record<string, string> = {};
    for (const l of lines) {
      const p = lineProblem(l, kind);
      if (p) lineIssues[l.key] = p;
    }
    setProblems(lineIssues);

    const sendDate = !doc || dateTouched;
    const body = {
      reason: reasons.length ? header.reason : undefined,
      fromLocationId: needsFrom ? header.fromLocationId : undefined,
      toLocationId: needsTo ? header.toLocationId : undefined,
      toStoreId: kind === "transfer_send" ? header.toStoreId : undefined,
      postingDate: sendDate && header.postingDate ? header.postingDate : undefined,
      postingTime: sendDate && header.postingTime ? header.postingTime : undefined,
      remarks: blankToNull(header.remarks),
      lines: lines.map((l) => lineToInput(l, kind)),
    };
    const parsed = doc ? updateStockDocumentSchema.safeParse(body) : createStockDocumentSchema.safeParse({ ...body, kind, storeId: header.storeId });
    const schemaErrors = issuesToFieldErrors(parsed);
    const allErrors = { ...schemaErrors, ...headerErrors };
    setErrors(allErrors);

    if (lines.length === 0) {
      setError("Add at least one item.");
      return null;
    }
    if (Object.keys(lineIssues).length > 0) {
      setError(`Please fix the ${Object.keys(lineIssues).length === 1 ? "line" : "lines"} marked below: ${Object.values(lineIssues).join("; ")}`);
      return null;
    }
    if (Object.keys(allErrors).length > 0 || !parsed.success) {
      setError("Please fix the fields marked below.");
      return null;
    }
    return parsed.data as Record<string, unknown>;
  }

  async function save() {
    const body = prepare();
    if (!body) return;
    setBusy("save");
    try {
      const after = doc ? await api.patch<StockDocumentDto>(`/stock/documents/${doc.id}`, body) : await api.post<StockDocumentDto>("/stock/documents", body);
      setDirty(false);
      setSaved("Draft saved.");
      onSaved(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function finalise() {
    if (!doc) return;
    setBusy("finalise");
    try {
      if (dirty && editable) {
        const body = prepare();
        if (!body) return;
        await api.patch<StockDocumentDto>(`/stock/documents/${doc.id}`, body);
        setDirty(false);
      } else {
        setError(null);
      }
      const after = await api.post<StockDocumentDto>(`/stock/documents/${doc.id}/finalise`);
      onSaved(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const otherStores = receivingStores.filter((s) => s.id !== header.storeId);

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{doc ? `${KIND_LABELS[kind]} ${doc.number}` : `New ${KIND_LABELS[kind].toLowerCase()}`}</h1>
        {doc ? <StockStatusBadge status={doc.status} /> : null}
      </div>
      {!canDraft ? <Alert kind="info">You can look at this draft but not change it.</Alert> : null}
      {kind === "transfer_send" ? (
        <p className="muted">The goods leave this store now and wait in transit until the receiving store receives them (in one go or in parts).</p>
      ) : null}

      <div className="card">
        <div className="form-grid">
          <SelectInput id="doc-store" label="Store" value={header.storeId} onChange={(e) => set("storeId", e.target.value)} disabled={!!doc || !editable} error={errors.storeId} required>
            <option value="">Choose…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </SelectInput>
          {reasons.length ? (
            <SelectInput id="doc-reason" label="Reason" value={header.reason} onChange={(e) => set("reason", e.target.value)} disabled={!editable} error={errors.reason} required>
              <option value="">Choose…</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABELS[r] ?? r}
                </option>
              ))}
            </SelectInput>
          ) : null}
          {needsFrom ? (
            <SelectInput id="doc-from" label="From location" value={header.fromLocationId} onChange={(e) => set("fromLocationId", e.target.value)} disabled={!editable} error={errors.fromLocationId} required>
              <option value="">Choose…</option>
              {shelves.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
          {needsTo ? (
            <SelectInput id="doc-to" label="To location" value={header.toLocationId} onChange={(e) => set("toLocationId", e.target.value)} disabled={!editable} error={errors.toLocationId} required>
              <option value="">Choose…</option>
              {shelves.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
          {kind === "transfer_send" ? (
            <SelectInput id="doc-to-store" label="Receiving store" value={header.toStoreId} onChange={(e) => set("toStoreId", e.target.value)} disabled={!editable} error={errors.toStoreId} required>
              <option value="">Choose…</option>
              {otherStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
          <TextInput
            id="doc-date"
            label="Posting date"
            type="date"
            value={header.postingDate || today}
            max={today || undefined}
            onChange={(e) => set("postingDate", e.target.value)}
            disabled={!editable}
            error={errors.postingDate}
            hint="Indian date. An earlier date than other movements of these items needs the Accountant."
          />
          <TextInput id="doc-time" label="Time (optional)" type="time" value={header.postingTime} onChange={(e) => set("postingTime", e.target.value)} disabled={!editable} error={errors.postingTime} hint="Blank: now for today, end of day for a past date." />
        </div>
        <TextareaInput id="doc-remarks" label="Remarks" value={header.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={!editable} error={errors.remarks} maxLength={300} />
      </div>

      <h2>Lines</h2>
      {editable ? <StockItemAdder onAdd={(item, unitId) => setLines([...lines, emptyLine(item, unitId)])} /> : null}
      <StockLineGrid kind={kind} lines={lines} onChange={setLines} fromLocationId={header.fromLocationId} problems={problems} readOnly={!editable} />
      {kind === "stock_in" ? <p className="muted">Cost per unit is per the unit chosen on the line (for example per box).</p> : null}

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{saved}</Alert>
      <div className="actions">
        {editable ? (
          <Button variant={doc ? "secondary" : "primary"} busy={busy === "save"} disabled={busy !== null} onClick={() => save()}>
            Save draft
          </Button>
        ) : null}
        {doc && doc.status === "draft" && canFinalise ? (
          <Button variant="primary" busy={busy === "finalise"} disabled={busy !== null} onClick={finalise}>
            Finalise
          </Button>
        ) : null}
        {doc && doc.status === "draft" && canDraft ? (
          <Button variant="danger" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
            Cancel draft
          </Button>
        ) : null}
      </div>
      {!doc ? <p className="muted">Save the draft first; it can then be finalised{canFinalise ? "" : " by someone with the right to finalise"}.</p> : null}
      {doc && doc.status === "draft" && !canFinalise ? <p className="muted">Someone with the right to finalise (for example the Store Manager) will finalise this draft.</p> : null}
      {doc ? <CancelDocumentDialog doc={doc} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onSaved} /> : null}
    </div>
  );
}
