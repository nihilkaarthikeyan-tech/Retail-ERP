// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createItemGroupSchema, hasPermission, suggestCode, updateItemGroupSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, Dialog, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import type { ItemGroupNode } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface GroupForm {
  code: string;
  name: string;
  hsnCode: string;
  active: boolean;
}

const emptyGroup: GroupForm = { code: "", name: "", hsnCode: "", active: true };

type Editing = { kind: "new"; parent: ItemGroupNode | null } | { kind: "edit"; node: ItemGroupNode } | null;

function GroupTree({ nodes, canManage, onEdit, onAddChild }: { nodes: ItemGroupNode[]; canManage: boolean; onEdit: (n: ItemGroupNode) => void; onAddChild: (n: ItemGroupNode) => void }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.id}>
          <div className="tree-row">
            <span>
              <strong>{n.name}</strong> <span className="mono muted">{n.code}</span>
              {n.hsnCode ? (
                <span className="muted">
                  {" "}
                  · HSN <span className="mono">{n.hsnCode}</span>
                </span>
              ) : null}
            </span>
            {n.isLeaf ? <Badge kind="neutral">holds items</Badge> : null}
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
          <GroupTree nodes={n.children} canManage={canManage} onEdit={onEdit} onAddChild={onAddChild} />
        </li>
      ))}
    </ul>
  );
}

export default function ItemGroupsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const tree = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups"));
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<GroupForm>(emptyGroup);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(e: Editing) {
    setErrors({});
    setError(null);
    setForm(e?.kind === "edit" ? { code: e.node.code, name: e.node.name, hsnCode: e.node.hsnCode ?? "", active: e.node.active } : emptyGroup);
    setEditing(e);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const parsed =
      editing.kind === "new"
        ? createItemGroupSchema.safeParse({ code: form.code, name: form.name, parentId: editing.parent?.id ?? null, hsnCode: blankToNull(form.hsnCode) })
        : updateItemGroupSchema.safeParse({ name: form.name, hsnCode: blankToNull(form.hsnCode), active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing.kind === "new") await api.post("/catalogue/item-groups", parsed.data);
      else await api.patch(`/catalogue/item-groups/${editing.node.id}`, parsed.data);
      setEditing(null);
      await tree.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = editing?.kind === "edit" ? `Edit group: ${editing.node.name}` : editing?.parent ? `Add group under ${editing.parent.name}` : "Add top-level group";

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Item groups</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open({ kind: "new", parent: null })}>
            Add top-level group
          </Button>
        ) : null}
      </div>
      <p className="muted">Items can only be placed in the last level of the tree (Grocery → Staples → Rice). An HSN code on a group is the default for new items in it.</p>
      <Alert kind="error">{tree.error}</Alert>
      {tree.loading && !tree.data ? <p className="muted">Loading…</p> : null}
      {tree.data && tree.data.length === 0 ? <p className="muted">No groups yet.</p> : null}
      {tree.data ? <GroupTree nodes={tree.data} canManage={canManage} onEdit={(n) => open({ kind: "edit", node: n })} onAddChild={(n) => open({ kind: "new", parent: n })} /> : null}

      <Dialog open={editing !== null} title={title} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          <TextInput
            id="group-name"
            label="Name"
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              // The code follows the name until the person types their own.
              const follows = editing?.kind === "new" && form.code === suggestCode(form.name, 20, "-");
              setForm({ ...form, name, ...(follows ? { code: suggestCode(name, 20, "-") } : {}) });
            }}
            error={errors.name}
            required
            autoComplete="off"
          />
          {editing?.kind === "new" ? (
            <TextInput id="group-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="Filled in from the name; change it if you like. Letters, digits, - . and /; cannot be changed later." autoComplete="off" />
          ) : (
            <p>
              Code <span className="mono">{form.code}</span>
            </p>
          )}
          <TextInput id="group-hsn" label="Default HSN / SAC code" value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} error={errors.hsnCode} inputMode="numeric" className="mono" hint="4, 6 or 8 digits. Optional." />
          {editing?.kind === "edit" ? (
            <CheckInput id="group-active" label="Active" description="Switched-off groups cannot take new items." checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
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
