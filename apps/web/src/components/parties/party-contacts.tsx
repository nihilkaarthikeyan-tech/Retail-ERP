// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { contactSchema, updateContactSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import type { ContactDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface ContactForm {
  name: string;
  jobTitle: string;
  email: string;
  mobile: string;
  isMain: boolean;
  noPromotions: boolean;
  active: boolean;
}

const emptyForm: ContactForm = { name: "", jobTitle: "", email: "", mobile: "", isMain: false, noPromotions: false, active: true };

interface PartyContactsProps {
  /** "/customers/<id>" or "/suppliers/<id>". */
  basePath: string;
  contacts: ContactDto[];
  readOnly: boolean;
  onChanged: () => Promise<void> | void;
}

/** Contact people tab: a table and an add/edit dialog. */
export function PartyContacts({ basePath, contacts, readOnly, onChanged }: PartyContactsProps) {
  const [editing, setEditing] = useState<ContactDto | "new" | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(c: ContactDto | "new") {
    setErrors({});
    setError(null);
    setForm(
      c === "new"
        ? { ...emptyForm, isMain: contacts.filter((x) => x.active).length === 0 }
        : { name: c.name, jobTitle: c.jobTitle ?? "", email: c.email ?? "", mobile: c.mobile ?? "", isMain: c.isMain, noPromotions: c.noPromotions, active: c.active },
    );
    setEditing(c);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = { name: form.name, jobTitle: blankToNull(form.jobTitle), email: blankToNull(form.email), mobile: blankToNull(form.mobile), isMain: form.isMain, noPromotions: form.noPromotions };
    const parsed = editing === "new" ? contactSchema.safeParse(body) : updateContactSchema.safeParse({ ...body, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post(`${basePath}/contacts`, parsed.data);
      else if (editing) await api.patch(`${basePath}/contacts/${editing.id}`, parsed.data);
      setEditing(null);
      await onChanged();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ContactDto>[] = [
    { key: "name", header: "Name", render: (c) => c.name },
    { key: "jobTitle", header: "Role", render: (c) => c.jobTitle ?? "—" },
    { key: "mobile", header: "Mobile", render: (c) => (c.mobile ? <span className="mono">{c.mobile}</span> : "—") },
    { key: "email", header: "Email", render: (c) => c.email ?? "—" },
    {
      key: "flags",
      header: "",
      render: (c) => (
        <span className="row-actions">
          {c.isMain ? <Badge kind="ok">Main</Badge> : null}
          {c.noPromotions ? <Badge kind="neutral">No promotions</Badge> : null}
        </span>
      ),
    },
    { key: "active", header: "Status", render: (c) => <ActiveBadge active={c.active} /> },
    ...(!readOnly
      ? [
          {
            key: "actions",
            header: "",
            render: (c: ContactDto) => (
              <Button size="small" onClick={() => open(c)}>
                Edit
              </Button>
            ),
          } satisfies Column<ContactDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Contact people</h2>
        <span className="spacer" />
        {!readOnly ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add contact
          </Button>
        ) : null}
      </div>
      <DataTable columns={columns} rows={contacts} rowKey={(c) => c.id} empty="No contact people yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add contact" : "Edit contact"} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          <TextInput id="con-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          <TextInput id="con-jobTitle" label="Role / job title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} error={errors.jobTitle} autoComplete="off" />
          <TextInput id="con-mobile" label="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} error={errors.mobile} inputMode="numeric" className="mono" autoComplete="off" hint="10 digits." />
          <TextInput id="con-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} autoComplete="off" />
          <div className="check-row">
            <CheckInput id="con-isMain" label="Main contact" checked={form.isMain} onChange={(e) => setForm({ ...form, isMain: e.target.checked })} />
            <CheckInput id="con-noPromotions" label="No promotional messages" description="The person has not agreed to offers by SMS or email (decision 74)." checked={form.noPromotions} onChange={(e) => setForm({ ...form, noPromotions: e.target.checked })} />
            {editing !== "new" ? <CheckInput id="con-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
          </div>
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
