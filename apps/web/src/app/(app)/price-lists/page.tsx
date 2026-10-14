// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createPriceListSchema, hasPermission, updatePriceListSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface ListForm {
  code: string;
  name: string;
  forSelling: boolean;
  forBuying: boolean;
  pricesPerUnit: boolean;
  active: boolean;
}

const emptyList: ListForm = { code: "", name: "", forSelling: true, forBuying: false, pricesPerUnit: false, active: true };

export default function PriceListsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "prices.manage");
  const canSeeBuying = hasPermission(user, "buying_prices.view");
  const lists = useLoad(() => api.get<PriceListDto[]>("/price-lists"));
  const [editing, setEditing] = useState<PriceListDto | "new" | null>(null);
  const [form, setForm] = useState<ListForm>(emptyList);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(l: PriceListDto | "new") {
    setErrors({});
    setError(null);
    setForm(l === "new" ? emptyList : { code: l.code, name: l.name, forSelling: l.forSelling, forBuying: l.forBuying, pricesPerUnit: l.pricesPerUnit, active: l.active });
    setEditing(l);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed =
      editing === "new"
        ? createPriceListSchema.safeParse({ code: form.code, name: form.name, forSelling: form.forSelling, forBuying: form.forBuying, pricesPerUnit: form.pricesPerUnit })
        : updatePriceListSchema.safeParse({ name: form.name, pricesPerUnit: form.pricesPerUnit, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    if (issues[""]) issues.forSelling = issues[""];
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/price-lists", parsed.data);
      else if (editing) await api.patch(`/price-lists/${editing.id}`, parsed.data);
      setEditing(null);
      await lists.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PriceListDto>[] = [
    { key: "name", header: "Price list", render: (l) => <Link href={`/prices?list=${l.id}`}>{l.name}</Link> },
    { key: "code", header: "Code", render: (l) => <span className="mono">{l.code}</span> },
    {
      key: "use",
      header: "Used for",
      render: (l) => (
        <span className="row-actions">
          {l.forSelling ? <Badge kind="neutral">Selling</Badge> : null}
          {l.forBuying ? <Badge kind="neutral">Buying</Badge> : null}
        </span>
      ),
    },
    { key: "unit", header: "Prices are", render: (l) => (l.pricesPerUnit ? "per each unit" : "per basic unit (packs worked out)") },
    { key: "currency", header: "Currency", render: (l) => l.currency },
    { key: "active", header: "Status", render: (l) => <ActiveBadge active={l.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (l: PriceListDto) => (
              <Button size="small" onClick={() => open(l)}>
                Edit
              </Button>
            ),
          } satisfies Column<PriceListDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Price lists</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add price list
          </Button>
        ) : null}
      </div>
      <p className="muted">
        Named sets of prices in rupees. {canSeeBuying ? "" : "Buying lists are not shown to you."}
      </p>
      <Alert kind="error">{lists.error}</Alert>
      <DataTable columns={columns} rows={lists.data} rowKey={(l) => l.id} loading={lists.loading} empty="No price lists." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add price list" : `Edit price list: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <TextInput id="pl-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="Letters, digits, - . and /; cannot be changed later." autoComplete="off" />
          ) : null}
          <TextInput id="pl-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          {editing === "new" ? (
            <>
              {errors.forSelling ? <p className="field-error">{errors.forSelling}</p> : null}
              <CheckInput id="pl-forSelling" label="For selling" checked={form.forSelling} onChange={(e) => setForm({ ...form, forSelling: e.target.checked })} />
              <CheckInput id="pl-forBuying" label="For buying" description="Hidden from users without the buying prices right." checked={form.forBuying} onChange={(e) => setForm({ ...form, forBuying: e.target.checked })} disabled={!canSeeBuying} />
            </>
          ) : null}
          <CheckInput id="pl-pricesPerUnit" label="Prices are per each unit" description="Off = a price is per basic unit and the price of a box is worked out from its factor. On = every unit has its own price as stored." checked={form.pricesPerUnit} onChange={(e) => setForm({ ...form, pricesPerUnit: e.target.checked })} />
          {editing !== "new" ? <CheckInput id="pl-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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
