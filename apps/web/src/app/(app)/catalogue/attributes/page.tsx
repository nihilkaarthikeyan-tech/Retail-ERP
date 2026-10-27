// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createAttributeSchema, hasPermission, updateAttributeSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AttributeDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface ValueRow {
  value: string;
  shortCode: string;
}

interface AttributeForm {
  code: string;
  name: string;
  kind: "list" | "numeric";
  values: ValueRow[];
  rangeStart: string;
  rangeEnd: string;
  rangeStep: string;
  active: boolean;
}

const emptyAttribute: AttributeForm = { code: "", name: "", kind: "list", values: [{ value: "", shortCode: "" }], rangeStart: "", rangeEnd: "", rangeStep: "", active: true };

/** A number field for the numeric range: empty → null, otherwise the number (zod reports anything odd). */
function numberOrNull(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : Number(t);
}

/** The list with one entry moved from one place to another. */
function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AttributesPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const attributes = useLoad(() => api.get<AttributeDto[]>("/catalogue/attributes"));
  const [editing, setEditing] = useState<AttributeDto | "new" | null>(null);
  const [form, setForm] = useState<AttributeForm>(emptyAttribute);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(a: AttributeDto | "new") {
    setErrors({});
    setError(null);
    setForm(
      a === "new"
        ? emptyAttribute
        : {
            code: a.code,
            name: a.name,
            kind: a.kind,
            values: a.values.length > 0 ? a.values.map((v) => ({ value: v.value, shortCode: v.shortCode })) : [{ value: "", shortCode: "" }],
            rangeStart: a.rangeStart ?? "",
            rangeEnd: a.rangeEnd ?? "",
            rangeStep: a.rangeStep ?? "",
            active: a.active,
          },
    );
    setEditing(a);
  }

  function setValue(index: number, patch: Partial<ValueRow>) {
    setForm((f) => ({ ...f, values: f.values.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const values = form.values.filter((v) => v.value.trim() !== "" || v.shortCode.trim() !== "");
    const parsed =
      editing === "new"
        ? createAttributeSchema.safeParse({
            code: form.code,
            name: form.name,
            kind: form.kind,
            ...(form.kind === "list"
              ? { values }
              : { rangeStart: numberOrNull(form.rangeStart), rangeEnd: numberOrNull(form.rangeEnd), rangeStep: numberOrNull(form.rangeStep) }),
          })
        : updateAttributeSchema.safeParse({ name: form.name, active: form.active, ...(form.kind === "list" ? { values } : {}) });
    const issues = issuesToFieldErrors(parsed);
    if (issues[""]) issues.values = issues[""];
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/catalogue/attributes", parsed.data);
      else if (editing) await api.patch(`/catalogue/attributes/${editing.id}`, parsed.data);
      setEditing(null);
      await attributes.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AttributeDto>[] = [
    { key: "name", header: "Attribute", render: (a) => <strong>{a.name}</strong> },
    { key: "code", header: "Code", render: (a) => <span className="mono">{a.code}</span> },
    { key: "kind", header: "Kind", render: (a) => <Badge kind="neutral">{a.kind === "list" ? "List" : "Numeric"}</Badge> },
    {
      key: "values",
      header: "Values",
      render: (a) => (a.kind === "list" ? a.values.map((v) => `${v.value} (${v.shortCode})`).join(", ") || "—" : `${a.rangeStart ?? "?"} to ${a.rangeEnd ?? "?"} in steps of ${a.rangeStep ?? "?"}`),
    },
    { key: "active", header: "Status", render: (a) => <ActiveBadge active={a.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (a: AttributeDto) => (
              <Button size="small" onClick={() => open(a)}>
                Edit
              </Button>
            ),
          } satisfies Column<AttributeDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Variant attributes</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add attribute
          </Button>
        ) : null}
      </div>
      <p className="muted">What styles vary by: Size, Colour, and so on. Each value has a short code that becomes part of the variant code (SHIRT-RED-M).</p>
      <Alert kind="error">{attributes.error}</Alert>
      <DataTable columns={columns} rows={attributes.data} rowKey={(a) => a.id} loading={attributes.loading} empty="No attributes yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add attribute" : `Edit attribute: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <>
              <TextInput id="attr-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="Letters, digits, - . and /; cannot be changed later." autoComplete="off" />
              <SelectInput id="attr-kind" label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "list" | "numeric" })} error={errors.kind} required hint="A list has named values; a numeric one takes any number in a range (shoe sizes 36 to 46 in steps of 1).">
                <option value="list">List of values</option>
                <option value="numeric">Numeric range</option>
              </SelectInput>
            </>
          ) : null}
          <TextInput id="attr-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />

          {form.kind === "list" ? (
            <>
              <h3>Values</h3>
              {editing !== "new" ? <p className="muted">Values used by existing variants cannot be renamed or removed. The arrows set the order sizes and colours appear in.</p> : null}
              {errors.values ? <p className="field-error">{errors.values}</p> : null}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Value</th>
                      <th scope="col">Short code</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.values.map((v, i) => (
                      <tr key={i}>
                        <td>
                          <label htmlFor={`attr-value-${i}`} className="sr-only">
                            Value {i + 1}
                          </label>
                          <input id={`attr-value-${i}`} className="input" value={v.value} onChange={(e) => setValue(i, { value: e.target.value })} autoComplete="off" />
                          {errors[`values.${i}.value`] ? <p className="field-error">{errors[`values.${i}.value`]}</p> : null}
                        </td>
                        <td>
                          <label htmlFor={`attr-short-${i}`} className="sr-only">
                            Short code {i + 1}
                          </label>
                          <input id={`attr-short-${i}`} className="input mono" value={v.shortCode} onChange={(e) => setValue(i, { shortCode: e.target.value })} autoComplete="off" />
                          {errors[`values.${i}.shortCode`] ? <p className="field-error">{errors[`values.${i}.shortCode`]}</p> : null}
                        </td>
                        <td className="row-actions">
                          {/* The order here is the order of sizes in the grid, on the till and in reports. */}
                          <Button size="small" disabled={i === 0} onClick={() => setForm((f) => ({ ...f, values: move(f.values, i, i - 1) }))} aria-label={`Move value ${i + 1} up`}>
                            ↑
                          </Button>
                          <Button size="small" disabled={i === form.values.length - 1} onClick={() => setForm((f) => ({ ...f, values: move(f.values, i, i + 1) }))} aria-label={`Move value ${i + 1} down`}>
                            ↓
                          </Button>
                          <Button size="small" variant="danger" onClick={() => setForm((f) => ({ ...f, values: f.values.filter((_, j) => j !== i) }))} aria-label={`Remove value ${i + 1}`}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button size="small" onClick={() => setForm((f) => ({ ...f, values: [...f.values, { value: "", shortCode: "" }] }))}>
                Add value
              </Button>
            </>
          ) : editing === "new" ? (
            <div className="filter-row">
              <TextInput id="attr-rangeStart" label="From" value={form.rangeStart} onChange={(e) => setForm({ ...form, rangeStart: e.target.value })} error={errors.rangeStart ?? errors.values} required inputMode="decimal" className="mono" />
              <TextInput id="attr-rangeEnd" label="To" value={form.rangeEnd} onChange={(e) => setForm({ ...form, rangeEnd: e.target.value })} error={errors.rangeEnd} required inputMode="decimal" className="mono" />
              <TextInput id="attr-rangeStep" label="Step" value={form.rangeStep} onChange={(e) => setForm({ ...form, rangeStep: e.target.value })} error={errors.rangeStep} required inputMode="decimal" className="mono" />
            </div>
          ) : (
            <p>
              Numeric range {form.rangeStart} to {form.rangeEnd} in steps of {form.rangeStep} (cannot be changed).
            </p>
          )}

          {editing !== "new" ? (
            <div style={{ marginTop: 12 }}>
              <CheckInput id="attr-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            </div>
          ) : null}
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
