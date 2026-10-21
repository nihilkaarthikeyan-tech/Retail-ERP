// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createCustomerGroupSchema, createSupplierGroupSchema, hasPermission, updateCustomerGroupSchema, updateSupplierGroupSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, Dialog, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { showMoney } from "@/lib/catalogue";
import { useModules } from "@/lib/modules";
import type { PartyGroupNode, PartyType, PaymentTermsDto, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface GroupForm {
  code: string;
  name: string;
  priceListId: string;
  paymentTermsId: string;
  creditLimit: string;
  overdueLimit: string;
  skipCreditCheck: boolean;
  active: boolean;
}

const emptyGroup: GroupForm = { code: "", name: "", priceListId: "", paymentTermsId: "", creditLimit: "0", overdueLimit: "0", skipCreditCheck: false, active: true };

type Editing = { kind: "new"; parent: PartyGroupNode | null } | { kind: "edit"; node: PartyGroupNode } | null;

interface TreeProps {
  nodes: PartyGroupNode[];
  canManage: boolean;
  holds: string;
  lookup: (n: PartyGroupNode) => string[];
  onEdit: (n: PartyGroupNode) => void;
  onAddChild: (n: PartyGroupNode) => void;
}

function GroupTree({ nodes, canManage, holds, lookup, onEdit, onAddChild }: TreeProps) {
  if (nodes.length === 0) return null;
  return (
    <ul className="tree">
      {nodes.map((n) => {
        const defaults = lookup(n);
        return (
          <li key={n.id}>
            <div className="tree-row">
              <span>
                <strong>{n.name}</strong> <span className="mono muted">{n.code}</span>
                {defaults.length > 0 ? <span className="muted"> · {defaults.join(" · ")}</span> : null}
              </span>
              {n.isLeaf ? <Badge kind="neutral">{holds}</Badge> : null}
              {!n.active ? <ActiveBadge active={false} /> : null}
              {canManage ? (
                <span className="row-actions">
                  <Button size="small" onClick={() => onEdit(n)}>
                    Edit
                  </Button>
                  <Button size="small" onClick={() => onAddChild(n)}>
                    Add child
                  </Button>
                </span>
              ) : null}
            </div>
            <GroupTree nodes={n.children} canManage={canManage} holds={holds} lookup={lookup} onEdit={onEdit} onAddChild={onAddChild} />
          </li>
        );
      })}
    </ul>
  );
}

/** Customer or supplier group tree with the defaults new parties copy. */
export function PartyGroupsPage({ kind }: { kind: PartyType }) {
  const { user } = useAuth();
  // Plan 12: credit limits only while "Credit sales" is on (saved values are kept).
  const creditOn = useModules().isOn("credit_sales");
  const isCustomer = kind === "customer";
  const path = isCustomer ? "/customer-groups" : "/supplier-groups";
  const canManage = hasPermission(user, isCustomer ? "customers.manage" : "suppliers.manage");
  const canSeePrices = hasPermission(user, "prices.view");
  // GET /payment-terms needs customers.view.
  const canSeeTerms = hasPermission(user, "customers.view");

  const tree = useLoad(() => api.get<PartyGroupNode[]>(path), [path]);
  const lists = useLoad<PriceListDto[]>(() => (canSeePrices ? api.get<PriceListDto[]>("/price-lists") : Promise.resolve([])), [canSeePrices]);
  const terms = useLoad<PaymentTermsDto[]>(() => (canSeeTerms ? api.get<PaymentTermsDto[]>("/payment-terms") : Promise.resolve([])), [canSeeTerms]);
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<GroupForm>(emptyGroup);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(e: Editing) {
    setErrors({});
    setError(null);
    setForm(
      e?.kind === "edit"
        ? {
            code: e.node.code,
            name: e.node.name,
            priceListId: e.node.priceListId ?? "",
            paymentTermsId: e.node.paymentTermsId ?? "",
            creditLimit: e.node.creditLimit ?? "0",
            overdueLimit: e.node.overdueLimit ?? "0",
            skipCreditCheck: e.node.skipCreditCheck ?? false,
            active: e.node.active,
          }
        : emptyGroup,
    );
    setEditing(e);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const defaults = {
      priceListId: form.priceListId || null,
      paymentTermsId: form.paymentTermsId || null,
      ...(isCustomer ? { creditLimit: form.creditLimit.trim() || "0", overdueLimit: form.overdueLimit.trim() || "0", skipCreditCheck: form.skipCreditCheck } : {}),
    };
    let parsed;
    if (editing.kind === "new") {
      const body = { code: form.code, name: form.name, parentId: editing.parent?.id ?? null, ...defaults };
      parsed = isCustomer ? createCustomerGroupSchema.safeParse(body) : createSupplierGroupSchema.safeParse(body);
    } else {
      const body = { name: form.name, active: form.active, ...defaults };
      parsed = isCustomer ? updateCustomerGroupSchema.safeParse(body) : updateSupplierGroupSchema.safeParse(body);
    }
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing.kind === "new") await api.post(path, parsed.data);
      else await api.patch(`${path}/${editing.node.id}`, parsed.data);
      setEditing(null);
      await tree.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const listName = (id: string | null) => (id ? (lists.data?.find((l) => l.id === id)?.name ?? "price list set") : null);
  const termsName = (id: string | null) => (id ? (terms.data?.find((t) => t.id === id)?.name ?? "terms set") : null);
  const lookup = (n: PartyGroupNode): string[] => {
    const out: string[] = [];
    const l = listName(n.priceListId);
    if (l) out.push(l);
    const t = termsName(n.paymentTermsId);
    if (t) out.push(t);
    if (isCustomer && creditOn && n.creditLimit && Number(n.creditLimit) > 0) out.push(`credit ${showMoney(n.creditLimit)}`);
    if (isCustomer && creditOn && n.skipCreditCheck) out.push("no credit check");
    return out;
  };

  const selectableLists = (lists.data ?? []).filter((l) => (isCustomer ? l.forSelling : l.forBuying) && (l.active || l.id === form.priceListId));
  const selectableTerms = (terms.data ?? []).filter((t) => t.active || t.id === form.paymentTermsId);
  const noun = isCustomer ? "customers" : "suppliers";
  const title = editing?.kind === "edit" ? `Edit group: ${editing.node.name}` : editing?.parent ? `Add group under ${editing.parent.name}` : "Add top-level group";

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{isCustomer ? "Customer groups" : "Supplier groups"}</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open({ kind: "new", parent: null })}>
            Add top-level group
          </Button>
        ) : null}
      </div>
      <p className="muted">
        Only the last level of the tree can hold {noun}. A new {isCustomer ? "customer" : "supplier"} copies its group&apos;s defaults once, when it is created; changing a group later does not change existing {noun}.
      </p>
      <Alert kind="error">{tree.error ?? lists.error ?? terms.error}</Alert>
      {tree.loading && !tree.data ? <p className="muted">Loading…</p> : null}
      {tree.data && tree.data.length === 0 ? <p className="muted">No groups yet.</p> : null}
      {tree.data ? <GroupTree nodes={tree.data} canManage={canManage} holds={`holds ${noun}`} lookup={lookup} onEdit={(n) => open({ kind: "edit", node: n })} onAddChild={(n) => open({ kind: "new", parent: n })} /> : null}

      <Dialog open={editing !== null} title={title} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing?.kind === "new" ? (
            <TextInput id="pg-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="Letters, digits, - . and /; cannot be changed later." autoComplete="off" />
          ) : (
            <p>
              Code <span className="mono">{form.code}</span>
            </p>
          )}
          <TextInput id="pg-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          <SelectInput id="pg-priceList" label={isCustomer ? "Default price list" : "Default buying price list"} value={form.priceListId} onChange={(e) => setForm({ ...form, priceListId: e.target.value })} error={errors.priceListId} disabled={!canSeePrices} hint={canSeePrices ? undefined : "You cannot see price lists."}>
            <option value="">None</option>
            {selectableLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="pg-terms" label="Default payment terms" value={form.paymentTermsId} onChange={(e) => setForm({ ...form, paymentTermsId: e.target.value })} error={errors.paymentTermsId} disabled={!canSeeTerms}>
            <option value="">None</option>
            {selectableTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectInput>
          {isCustomer && creditOn ? (
            <>
              <TextInput id="pg-creditLimit" label="Default credit limit" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} error={errors.creditLimit} inputMode="decimal" className="mono" hint="0 = the company default applies." />
              <TextInput id="pg-overdueLimit" label="Default overdue limit" value={form.overdueLimit} onChange={(e) => setForm({ ...form, overdueLimit: e.target.value })} error={errors.overdueLimit} inputMode="decimal" className="mono" />
              <CheckInput id="pg-skipCredit" label="Skip the credit check" description="Customers in this group are never stopped by a credit limit." checked={form.skipCreditCheck} onChange={(e) => setForm({ ...form, skipCreditCheck: e.target.checked })} />
            </>
          ) : null}
          {editing?.kind === "edit" ? <CheckInput id="pg-active" label="Active" description={`Switched-off groups cannot take new ${noun}.`} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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
