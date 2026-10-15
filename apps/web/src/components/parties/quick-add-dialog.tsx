// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { quickAddCustomerSchema } from "shared";
import { DuplicateMatches } from "@/components/parties/duplicate-matches";
import { Alert, Button, Dialog, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import { duplicateMobile } from "@/lib/parties";
import type { CustomerDto, DuplicateMobileBody } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface QuickAddDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (customer: CustomerDto) => void;
}

/** Name + mobile (+ email) at the till; a known mobile shows the matches and asks before adding (decision 20). */
export function QuickAddDialog({ open, onClose, onSaved }: QuickAddDialogProps) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMobileBody | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setName("");
    setMobile("");
    setEmail("");
    setErrors({});
    setError(null);
    setDuplicate(null);
    onClose();
  }

  async function send(confirmDuplicate: boolean) {
    setError(null);
    const parsed = quickAddCustomerSchema.safeParse({ name, mobile, email: blankToNull(email), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const saved = await api.post<CustomerDto>("/customers/quick-add", parsed.data);
      onSaved(saved);
      close();
    } catch (err) {
      const dup = duplicateMobile(err);
      if (dup) {
        setDuplicate(dup);
      } else {
        setErrors(apiFieldErrors(err));
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDuplicate(null);
    void send(false);
  }

  return (
    <Dialog open={open} title="Quick add customer" onClose={close}>
      <form onSubmit={onSubmit} noValidate>
        <Alert kind="error">{error}</Alert>
        <TextInput id="qa-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} required autoComplete="off" autoFocus />
        <TextInput id="qa-mobile" label="Mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} error={errors.mobile} required inputMode="numeric" className="mono" autoComplete="off" hint="10 digits." />
        <TextInput id="qa-email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="off" />
        {duplicate ? <DuplicateMatches duplicate={duplicate} busy={busy} onAddAnyway={() => void send(true)} onCancel={() => setDuplicate(null)} /> : null}
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy} disabled={duplicate !== null}>
            Add customer
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
