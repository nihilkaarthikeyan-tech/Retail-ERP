// Copyright (c) 2026, Rademics. All rights reserved.
// Label templates (decision 73: standard templates with basic editing): the
// name, the size (a standard sheet or roll, or a custom size), what shows on
// the label, the text size and which template is used first.
"use client";

import { type FormEvent, useState } from "react";
import { barcodeModules, hasPermission, LABEL_FIELDS, type LabelField, type LabelSize } from "shared";
import { Alert, Badge, Button, CheckInput, DataTable, Dialog, RadioInput, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { LABEL_FIELD_LABELS, type LabelDto, type LabelTemplateDto, type LabelTemplatesDto, sheetLayout } from "@/lib/documents";
import { useLoad } from "@/lib/use-load";
import { LabelView } from "./label-view";

/** A made-up item for the preview while editing a template. */
export const SAMPLE_LABEL: LabelDto = {
  itemId: "sample",
  code: "ITM-000001",
  name: "Basmati Rice 1 kg",
  unit: "PCS",
  price: "110.00",
  mrp: "120.00",
  barcode: barcodeModules("8901234567890", "EAN13"),
  batch: "B2610",
  expiry: "2027-04-30",
  packed: "2026-10-01",
  store: "Main Store",
};

/** "A4 sheet, 65 labels (38 × 21 mm)", or the custom size in words. */
export function sizeText(t: Pick<LabelTemplateDto, "sizeKey" | "width" | "height" | "media">, sizes: LabelSize[]): string {
  const preset = sizes.find((s) => s.key === t.sizeKey);
  if (preset) return preset.name;
  return `Custom ${t.width} × ${t.height} mm, ${t.media === "roll" ? "label roll" : "A4 sheet"}`;
}

export function LabelTemplates() {
  const { user, loading } = useAuth();
  const allowed = hasPermission(user, "print.settings");
  const data = useLoad<LabelTemplatesDto | null>(() => (allowed ? api.get<LabelTemplatesDto>("/labels/templates") : Promise.resolve(null)), [allowed]);
  const [editing, setEditing] = useState<LabelTemplateDto | "new" | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <>
        <h1>Label templates</h1>
        <Alert kind="error">Only the Owner can change label templates.</Alert>
      </>
    );
  }
  const sizes = data.data?.sizes ?? [];

  const columns: Column<LabelTemplateDto>[] = [
    {
      key: "name",
      header: "Name",
      render: (t) => (
        <>
          {t.name} {t.isDefault ? <Badge kind="ok">Used first</Badge> : null}
        </>
      ),
    },
    { key: "size", header: "Size", render: (t) => sizeText(t, sizes) },
    { key: "fields", header: "Shows", render: (t) => t.fields.map((f) => LABEL_FIELD_LABELS[f]).join(", ") },
    { key: "font", header: "Text size", align: "right", render: (t) => `${t.fontSize} pt` },
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
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Label templates</h1>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setEditing("new")} disabled={!data.data}>
          Add template
        </Button>
      </div>
      <p className="muted">Standard sizes for A4 sticker sheets and label-printer rolls. Choose what each label shows and how big the text is.</p>
      <Alert kind="error">{data.error}</Alert>
      <DataTable columns={columns} rows={data.data?.templates} rowKey={(t) => t.id} loading={data.loading} empty="No templates yet." />
      {editing && data.data ? (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          sizes={sizes}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            data.setData(next);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

interface Draft {
  name: string;
  sizeKey: string;
  width: string;
  height: string;
  media: "sheet" | "roll";
  fields: LabelField[];
  fontSize: string;
  isDefault: boolean;
}

function TemplateDialog({ template, sizes, onClose, onSaved }: { template: LabelTemplateDto | null; sizes: LabelSize[]; onClose: () => void; onSaved: (d: LabelTemplatesDto) => void }) {
  const [draft, setDraft] = useState<Draft>(() =>
    template
      ? { name: template.name, sizeKey: template.sizeKey, width: String(template.width), height: String(template.height), media: template.media, fields: template.fields, fontSize: String(template.fontSize), isDefault: template.isDefault }
      : { name: "", sizeKey: sizes[0]?.key ?? "custom", width: "50", height: "25", media: "roll", fields: ["name", "price", "mrp", "barcode"], fontSize: "8", isDefault: false },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const preset = sizes.find((s) => s.key === draft.sizeKey);
  const custom = !preset;
  const width = preset ? preset.width : Number(draft.width);
  const height = preset ? preset.height : Number(draft.height);
  const media = preset ? preset.media : draft.media;
  const fontSize = Number(draft.fontSize);
  const sizeOk = width >= 15 && width <= 120 && height >= 10 && height <= 120;
  const layout = sizeOk && media === "sheet" ? sheetLayout({ width, height, across: preset?.across ?? null, down: preset?.down ?? null, marginTop: preset?.marginTop ?? null, marginLeft: preset?.marginLeft ?? null, gapX: preset?.gapX ?? null, gapY: preset?.gapY ?? null }) : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const problems: Record<string, string> = {};
    if (!draft.name.trim()) problems.name = "Give the template a name";
    if (custom && !(width >= 15 && width <= 120)) problems.width = "Between 15 and 120 mm";
    if (custom && !(height >= 10 && height <= 120)) problems.height = "Between 10 and 120 mm";
    if (!draft.fields.length) problems.fields = "Choose at least one thing to print";
    if (!(fontSize >= 5 && fontSize <= 16)) problems.fontSize = "Between 5 and 16 points";
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      sizeKey: custom ? "custom" : draft.sizeKey,
      ...(custom ? { width, height, media: draft.media } : {}),
      // Kept in the standard order so every label reads the same way.
      fields: LABEL_FIELDS.filter((f) => draft.fields.includes(f)),
      fontSize,
      isDefault: draft.isDefault,
    };
    try {
      onSaved(template ? await api.patch<LabelTemplatesDto>(`/labels/templates/${template.id}`, body) : await api.post<LabelTemplatesDto>("/labels/templates", body));
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={template ? `Change “${template.name}”` : "Add a label template"} onClose={onClose}>
      <form onSubmit={save} noValidate className="doc-form">
        <TextInput id="tpl-name" label="Name" value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} error={errors.name} required />
        <SelectInput id="tpl-size" label="Size" value={custom ? "custom" : draft.sizeKey} onChange={(e) => set({ sizeKey: e.target.value })}>
          {sizes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
          <option value="custom">A custom size…</option>
        </SelectInput>
        {custom ? (
          <>
            <div className="form-grid">
              <TextInput id="tpl-width" label="Width (mm)" type="number" min={15} max={120} step="0.1" value={draft.width} onChange={(e) => set({ width: e.target.value })} error={errors.width} />
              <TextInput id="tpl-height" label="Height (mm)" type="number" min={10} max={120} step="0.1" value={draft.height} onChange={(e) => set({ height: e.target.value })} error={errors.height} />
            </div>
            <fieldset>
              <legend>Printed on</legend>
              <div className="check-row">
                <RadioInput id="tpl-sheet" name="tpl-media" label="A4 sticker sheets" checked={draft.media === "sheet"} onChange={() => set({ media: "sheet" })} />
                <RadioInput id="tpl-roll" name="tpl-media" label="A label printer roll" description="One label per page" checked={draft.media === "roll"} onChange={() => set({ media: "roll" })} />
              </div>
            </fieldset>
          </>
        ) : null}
        {layout ? (
          <p className="field-hint">
            {layout.perSheet} labels on each A4 sheet ({layout.across} across, {layout.down} down).
          </p>
        ) : null}
        <fieldset>
          <legend>What the label shows</legend>
          <div className="check-row">
            {LABEL_FIELDS.map((f) => (
              <CheckInput
                key={f}
                id={`tpl-field-${f}`}
                label={LABEL_FIELD_LABELS[f]}
                checked={draft.fields.includes(f)}
                onChange={(e) => set({ fields: e.target.checked ? [...draft.fields, f] : draft.fields.filter((x) => x !== f) })}
              />
            ))}
          </div>
          {errors.fields ? (
            <p className="field-error" role="alert">
              {errors.fields}
            </p>
          ) : null}
        </fieldset>
        <TextInput id="tpl-font" label="Text size (points)" type="number" min={5} max={16} step={1} value={draft.fontSize} onChange={(e) => set({ fontSize: e.target.value })} error={errors.fontSize} hint="The item name prints at this size; the price a little bigger, the rest a little smaller." />
        <CheckInput id="tpl-default" label="Use this template first" checked={draft.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
        {sizeOk && fontSize >= 5 && fontSize <= 16 && draft.fields.length ? (
          <div className="label-sample">
            <div className="field-hint">How a label looks (actual size)</div>
            <LabelView label={SAMPLE_LABEL} template={{ width, height, fields: LABEL_FIELDS.filter((f) => draft.fields.includes(f)), fontSize }} />
          </div>
        ) : null}
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
