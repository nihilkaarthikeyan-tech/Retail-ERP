// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createUserSchema, updateUserSchema } from "shared";
import { Alert, Button, CheckInput, RadioInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import type { RoleDto, StoreDto, UserDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface UserFormValues {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  temporaryPassword: string;
  roleIds: string[];
  allStores: boolean;
  storeIds: string[];
  defaultStoreId: string;
  active: boolean;
}

function fromUser(user: UserDto | null): UserFormValues {
  if (!user) {
    return { firstName: "", lastName: "", email: "", mobile: "", temporaryPassword: "", roleIds: [], allStores: false, storeIds: [], defaultStoreId: "", active: true };
  }
  return {
    firstName: user.firstName,
    lastName: user.lastName ?? "",
    email: user.email,
    mobile: user.mobile ?? "",
    temporaryPassword: "",
    roleIds: user.roles.map((r) => r.id),
    allStores: user.allStores,
    storeIds: user.stores.map((s) => s.id),
    defaultStoreId: user.stores.find((s) => s.isDefault)?.id ?? "",
    active: user.active,
  };
}

interface UserFormProps {
  user: UserDto | null;
  roles: RoleDto[];
  stores: StoreDto[];
  /** The logged-in user's id: one cannot switch off one's own account. */
  selfId: string | undefined;
  onSaved: (user: UserDto) => void;
}

export function UserForm({ user, roles, stores, selfId, onSaved }: UserFormProps) {
  const [form, setForm] = useState<UserFormValues>(() => fromUser(user));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: "firstName" | "lastName" | "email" | "mobile" | "temporaryPassword") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function toggle(list: "roleIds" | "storeIds", id: string, on: boolean) {
    setForm((f) => {
      const next = on ? [...new Set([...f[list], id])] : f[list].filter((x) => x !== id);
      const defaultStoreId = list === "storeIds" && !next.includes(f.defaultStoreId) ? "" : f.defaultStoreId;
      return { ...f, [list]: next, defaultStoreId };
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const common = {
      firstName: form.firstName,
      lastName: blankToNull(form.lastName),
      email: form.email,
      mobile: blankToNull(form.mobile),
      roleIds: form.roleIds,
      allStores: form.allStores,
      storeIds: form.allStores ? [] : form.storeIds,
      defaultStoreId: form.allStores ? null : form.defaultStoreId || null,
    };
    const parsed = user
      ? updateUserSchema.safeParse({ ...common, active: form.active })
      : createUserSchema.safeParse({ ...common, temporaryPassword: form.temporaryPassword });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const saved = user ? await api.patch<UserDto>(`/users/${user.id}`, parsed.data) : await api.post<UserDto>("/users", parsed.data);
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const activeStores = stores.filter((s) => s.active || form.storeIds.includes(s.id));

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <fieldset>
        <legend>Person</legend>
        <div className="form-grid">
          <TextInput id="user-firstName" label="First name" value={form.firstName} onChange={set("firstName")} error={errors.firstName} required autoComplete="off" />
          <TextInput id="user-lastName" label="Last name" value={form.lastName} onChange={set("lastName")} error={errors.lastName} autoComplete="off" />
          <TextInput id="user-email" label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} required autoComplete="off" hint="Used to log in." />
          <TextInput id="user-mobile" label="Mobile" type="tel" inputMode="numeric" value={form.mobile} onChange={set("mobile")} error={errors.mobile} hint="10 digits, optional." autoComplete="off" />
          {!user ? (
            <TextInput id="user-temporaryPassword" label="Temporary password" type="password" value={form.temporaryPassword} onChange={set("temporaryPassword")} error={errors.temporaryPassword} required autoComplete="new-password" hint="Tell the person in private; they must change it at first login." />
          ) : null}
        </div>
      </fieldset>

      <fieldset>
        <legend>Roles</legend>
        {errors.roleIds ? <p className="field-error">{errors.roleIds}</p> : null}
        <div className="check-list">
          {roles
            .filter((r) => r.active || form.roleIds.includes(r.id))
            .map((r) => (
              <CheckInput
                key={r.id}
                id={`role-${r.id}`}
                label={r.name + (r.active ? "" : " (switched off)")}
                description={r.description}
                checked={form.roleIds.includes(r.id)}
                onChange={(e) => toggle("roleIds", r.id, e.target.checked)}
              />
            ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Stores</legend>
        <CheckInput id="user-allStores" label="All stores" description="May work in every store, including ones added later." checked={form.allStores} onChange={(e) => setForm((f) => ({ ...f, allStores: e.target.checked }))} />
        {!form.allStores ? (
          <>
            {errors.storeIds ? <p className="field-error">{errors.storeIds}</p> : null}
            {errors.defaultStoreId ? <p className="field-error">{errors.defaultStoreId}</p> : null}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Store</th>
                    <th scope="col">May work here</th>
                    <th scope="col">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStores.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No stores available.
                      </td>
                    </tr>
                  ) : (
                    activeStores.map((s) => {
                      const allowed = form.storeIds.includes(s.id);
                      return (
                        <tr key={s.id}>
                          <td>
                            {s.code} — {s.name}
                            {s.active ? "" : <span className="muted"> (switched off)</span>}
                          </td>
                          <td>
                            <CheckInput id={`store-allow-${s.id}`} label={<span className="sr-only">Allow {s.code}</span>} checked={allowed} onChange={(e) => toggle("storeIds", s.id, e.target.checked)} />
                          </td>
                          <td>
                            <RadioInput id={`store-default-${s.id}`} name="defaultStore" label={<span className="sr-only">Default {s.code}</span>} checked={form.defaultStoreId === s.id} disabled={!allowed} onChange={() => setForm((f) => ({ ...f, defaultStoreId: s.id }))} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </fieldset>

      {user ? (
        <fieldset>
          <legend>Account</legend>
          <CheckInput
            id="user-active"
            label="Active"
            description={user.id === selfId ? "You cannot switch off your own account." : "Switched-off users cannot log in; their history is kept."}
            checked={form.active}
            disabled={user.id === selfId}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
        </fieldset>
      ) : null}

      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          {user ? "Save user" : "Create user"}
        </Button>
      </div>
    </form>
  );
}
