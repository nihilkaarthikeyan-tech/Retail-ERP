// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createRoleSchema, PERMISSION_AREAS, permissionArea, PERMISSIONS, SYSTEM_ROLE_DESCRIPTIONS, SYSTEM_ROLES, type SystemRoleCode, updateRoleSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, TextInput, TextareaInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import type { PermissionDto, RoleDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface RoleForm {
  code: string;
  name: string;
  description: string;
  permissions: string[];
  active: boolean;
}

const emptyRole: RoleForm = { code: "", name: "", description: "", permissions: [], active: true };

/** A role's code made from its name ("Floor supervisor" → floor_supervisor); the owner never types it. */
function roleCodeFrom(name: string): string {
  const code = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40);
  return code.length >= 3 ? code : `role_${code}`.slice(0, 40);
}

const roleDescription = (r: RoleDto) => r.description ?? (r.isSystem ? (SYSTEM_ROLE_DESCRIPTIONS[r.code as SystemRoleCode] ?? null) : null);

export default function RolesPage() {
  const roles = useLoad(() => api.get<RoleDto[]>("/roles"));
  const permissions = useLoad(() => api.get<PermissionDto[]>("/permissions"));
  const [editing, setEditing] = useState<RoleDto | "new" | null>(null);
  const [form, setForm] = useState<RoleForm>(emptyRole);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const permissionList: PermissionDto[] =
    permissions.data ?? Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description }));

  const isSystem = editing !== null && editing !== "new" && editing.isSystem;
  const isOwnerAdmin = editing !== null && editing !== "new" && editing.code === SYSTEM_ROLES.OWNER_ADMIN;

  function open(r: RoleDto | "new") {
    setErrors({});
    setError(null);
    setForm(r === "new" ? emptyRole : { code: r.code, name: r.name, description: r.description ?? "", permissions: r.permissions, active: r.active });
    setEditing(r);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed =
      editing === "new"
        ? createRoleSchema.safeParse({ code: roleCodeFrom(form.name), name: form.name, description: blankToNull(form.description), permissions: form.permissions })
        : updateRoleSchema.safeParse({
            name: form.name,
            description: blankToNull(form.description),
            // The API refuses permission changes on Owner/Admin and switching off system roles.
            ...(isOwnerAdmin ? {} : { permissions: form.permissions }),
            ...(isSystem ? {} : { active: form.active }),
          });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/roles", parsed.data);
      else if (editing) await api.patch(`/roles/${editing.id}`, parsed.data);
      setEditing(null);
      await roles.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<RoleDto>[] = [
    { key: "name", header: "Role", render: (r) => <strong>{r.name}</strong> },
    { key: "desc", header: "What it is for", render: (r) => roleDescription(r) ?? "—" },
    {
      key: "perms",
      header: "Rights",
      render: (r) => (r.code === SYSTEM_ROLES.OWNER_ADMIN ? "Everything" : `${r.permissions.length} of ${permissionList.length}`),
    },
    {
      key: "kind",
      header: "Kind",
      render: (r) => (r.isSystem ? <Badge kind="neutral">System</Badge> : <Badge kind="neutral">Custom</Badge>),
    },
    { key: "active", header: "Status", render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button size="small" onClick={() => open(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Roles</h1>
        <span className="spacer" />
        <Button variant="primary" onClick={() => open("new")}>
          Add custom role
        </Button>
      </div>
      <p className="muted">System roles come with the product and cannot be switched off. Owner / Admin always has every right.</p>
      <Alert kind="error">{roles.error ?? permissions.error}</Alert>
      <DataTable columns={columns} rows={roles.data} rowKey={(r) => r.id} loading={roles.loading} />

      <Dialog open={editing !== null} title={editing === "new" ? "Add custom role" : `Edit role: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          <TextInput id="role-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required />
          <TextareaInput id="role-description" label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} />

          <h3>Rights</h3>
          {isOwnerAdmin ? <p className="muted">Owner / Admin always has every right; the list cannot be changed.</p> : null}
          {errors.permissions ? <p className="field-error">{errors.permissions}</p> : null}
          {errors.code ? <p className="field-error">{errors.code}</p> : null}
          {[...PERMISSION_AREAS.map((a) => a.name), "Other"].map((area) => {
            const inArea = permissionList.filter((p) => permissionArea(p.key) === area);
            if (!inArea.length) return null;
            return (
              <fieldset key={area} className="check-list">
                <legend>{area}</legend>
                {inArea.map((p) => (
                  <CheckInput
                    key={p.key}
                    id={`perm-${p.key}`}
                    label={p.description}
                    checked={isOwnerAdmin || form.permissions.includes(p.key)}
                    disabled={isOwnerAdmin}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        permissions: e.target.checked ? [...new Set([...f.permissions, p.key])] : f.permissions.filter((k) => k !== p.key),
                      }))
                    }
                  />
                ))}
              </fieldset>
            );
          })}

          {editing !== "new" ? (
            <div style={{ marginTop: 12 }}>
              <CheckInput
                id="role-active"
                label="Active"
                description={isSystem ? "System roles cannot be switched off." : "Switched-off roles give no rights."}
                checked={form.active}
                disabled={isSystem}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
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
