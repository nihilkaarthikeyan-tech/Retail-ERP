// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createUnitConversionSchema, createUnitSchema, fractionsAllowedForKind, hasPermission, UNIT_KINDS, type UnitKind, updateUnitSchema } from "shared";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { UnitConversionDto, UnitDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

const FRACTIONS_HINT = "Fractions (0.5 kg) are allowed only for weight, length and volume units; pieces and boxes are counted in whole numbers.";

const KIND_LABELS: Record<UnitKind, string> = { count: "Count", weight: "Weight", length: "Length", volume: "Volume", other: "Other" };

interface UnitForm {
  code: string;
  name: string;
  kind: UnitKind;
  allowsFractions: boolean;
  active: boolean;
}

const emptyUnit: UnitForm = { code: "", name: "", kind: "count", allowsFractions: false, active: true };

function UnitsSection({ units, canManage, onChanged }: { units: UnitDto[] | null; canManage: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<UnitDto | "new" | null>(null);
  const [form, setForm] = useState<UnitForm>(emptyUnit);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(u: UnitDto | "new") {
    setErrors({});
    setError(null);
    setForm(u === "new" ? emptyUnit : { code: u.code, name: u.name, kind: u.kind, allowsFractions: u.allowsFractions, active: u.active });
    setEditing(u);
  }

  const fractionsPossible = fractionsAllowedForKind(form.kind);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const allowsFractions = fractionsPossible && form.allowsFractions;
    const parsed =
      editing === "new"
        ? createUnitSchema.safeParse({ code: form.code, name: form.name, kind: form.kind, allowsFractions })
        : updateUnitSchema.safeParse({ name: form.name, allowsFractions, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/catalogue/units", parsed.data);
      else if (editing) await api.patch(`/catalogue/units/${editing.id}`, parsed.data);
      setEditing(null);
      await onChanged();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<UnitDto>[] = [
    { key: "code", header: "Code", render: (u) => <span className="mono">{u.code}</span> },
    { key: "name", header: "Name", render: (u) => u.name },
    { key: "kind", header: "Kind", render: (u) => KIND_LABELS[u.kind] },
    { key: "fractions", header: "Fractions", render: (u) => (u.allowsFractions ? "Allowed" : "Whole numbers") },
    { key: "active", header: "Status", render: (u) => <ActiveBadge active={u.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (u: UnitDto) => (
              <Button size="small" onClick={() => open(u)}>
                Edit
              </Button>
            ),
          } satisfies Column<UnitDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Units</h2>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add unit
          </Button>
        ) : null}
      </div>
      <DataTable columns={columns} rows={units} rowKey={(u) => u.id} loading={units === null} empty="No units yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add unit" : `Edit unit: ${form.code}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <>
              <TextInput id="unit-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="1–10 letters or digits, e.g. PCS, KG, BOX." autoComplete="off" />
              <SelectInput
                id="unit-kind"
                label="Kind"
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as UnitKind;
                  setForm({ ...form, kind, allowsFractions: fractionsAllowedForKind(kind) && form.allowsFractions });
                }}
                error={errors.kind}
                required
              >
                {UNIT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </SelectInput>
            </>
          ) : (
            <p>
              Code <span className="mono">{form.code}</span>, kind {KIND_LABELS[form.kind]}.
            </p>
          )}
          <TextInput id="unit-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          <CheckInput id="unit-fractions" label="Allows fractions" description={FRACTIONS_HINT} checked={fractionsPossible && form.allowsFractions} disabled={!fractionsPossible} onChange={(e) => setForm({ ...form, allowsFractions: e.target.checked })} />
          {editing !== "new" ? <CheckInput id="unit-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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

function ConversionsSection({ units, canManage }: { units: UnitDto[]; canManage: boolean }) {
  const conversions = useLoad(() => api.get<UnitConversionDto[]>("/catalogue/unit-conversions"));
  const [form, setForm] = useState({ fromUnitId: "", toUnitId: "", factor: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createUnitConversionSchema.safeParse({ fromUnitId: form.fromUnitId, toUnitId: form.toUnitId, factor: form.factor.trim() });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/catalogue/unit-conversions", parsed.data);
      setForm({ fromUnitId: "", toUnitId: "", factor: "" });
      await conversions.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<UnitConversionDto>[] = [
    { key: "rule", header: "Conversion", render: (c) => `1 ${c.fromUnit.code} = ${c.factor} ${c.toUnit.code}` },
    { key: "from", header: "From", render: (c) => c.fromUnit.name },
    { key: "to", header: "To", render: (c) => c.toUnit.name },
  ];

  const active = units.filter((u) => u.active);

  return (
    <>
      <h2>Standard conversions</h2>
      <p className="muted">Stored once (1 KG = 1000 G) and used both ways. The reverse is worked out automatically, and one step through a common unit too.</p>
      <Alert kind="error">{conversions.error}</Alert>
      <DataTable columns={columns} rows={conversions.data} rowKey={(c) => c.id} loading={conversions.loading} empty="No conversions yet." />
      {canManage ? (
        <form onSubmit={onSubmit} noValidate className="card">
          <h3 style={{ marginTop: 0 }}>Add conversion</h3>
          <Alert kind="error">{error}</Alert>
          <div className="filter-row">
            <SelectInput id="conv-from" label="1 of" value={form.fromUnitId} onChange={(e) => setForm({ ...form, fromUnitId: e.target.value })} error={errors.fromUnitId} required>
              <option value="">Choose a unit</option>
              {active.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </SelectInput>
            <TextInput id="conv-factor" label="equals" value={form.factor} onChange={(e) => setForm({ ...form, factor: e.target.value })} error={errors.factor} required inputMode="decimal" className="mono" placeholder="1000" />
            <SelectInput id="conv-to" label="of" value={form.toUnitId} onChange={(e) => setForm({ ...form, toUnitId: e.target.value })} error={errors.toUnitId} required>
              <option value="">Choose a unit</option>
              {active.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <Button type="submit" variant="primary" busy={busy}>
              Add conversion
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export default function UnitsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const units = useLoad(() => api.get<UnitDto[]>("/catalogue/units"));

  return (
    <>
      <h1>Units</h1>
      <p className="muted">How items are counted: pieces, boxes, kilograms, litres, metres. Every item has one basic unit and may add pack units with a factor.</p>
      <Alert kind="error">{units.error}</Alert>
      <UnitsSection units={units.data} canManage={canManage} onChanged={() => units.reload()} />
      {units.data ? <ConversionsSection units={units.data} canManage={canManage} /> : null}
    </>
  );
}
