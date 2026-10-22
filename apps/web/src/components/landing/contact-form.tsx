// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { leadSchema, SHOP_TYPE_KEYS, SHOP_TYPES } from "shared";
import { Alert, Button, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

const EMPTY = { name: "", phone: "", email: "", shopName: "", shopType: "", message: "", website: "" };

/** Plan 14: "Contact us / book a demo" on the landing page. */
export function ContactForm() {
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = leadSchema.safeParse({
      name: form.name,
      phone: form.phone,
      email: blankToNull(form.email),
      shopName: blankToNull(form.shopName),
      shopType: form.shopType || null,
      message: blankToNull(form.message),
      website: form.website || undefined,
    });
    setFieldErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/leads", parsed.data, { redirectOnUnauthorized: false });
      setSent(true);
      setForm(EMPTY);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Alert kind="success">
        Thank you. We will call you within one working day.{" "}
        <Button variant="link" onClick={() => setSent(false)}>
          Send another message
        </Button>
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="landing-form">
      <Alert kind="error">{error}</Alert>
      <div className="form-grid">
        <TextInput id="lead-name" label="Your name" autoComplete="name" value={form.name} onChange={set("name")} error={fieldErrors.name} required />
        <TextInput id="lead-phone" label="Phone" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} error={fieldErrors.phone} required />
        <TextInput id="lead-shop" label="Shop name" autoComplete="organization" value={form.shopName} onChange={set("shopName")} error={fieldErrors.shopName} />
        <SelectInput id="lead-type" label="Kind of shop" value={form.shopType} onChange={set("shopType")} error={fieldErrors.shopType}>
          <option value="">Choose…</option>
          {SHOP_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>
              {SHOP_TYPES[k].label}
            </option>
          ))}
        </SelectInput>
      </div>
      <TextInput id="lead-email" label="Email" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={fieldErrors.email} hint="Optional." />
      <TextareaInput id="lead-message" label="Anything you would like us to know" value={form.message} onChange={set("message")} error={fieldErrors.message} hint="For example how many counters and shops you have." />
      {/* Hidden from people; robots that fill in every field give themselves away here. */}
      <div className="landing-trap" aria-hidden="true">
        <label htmlFor="lead-website">Website</label>
        <input id="lead-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Call me back
        </Button>
      </div>
    </form>
  );
}
