// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { posSettingsSchema } from "shared";
import { AlterationChargeSettings, DeliverySettings } from "@/components/pos/delivery-settings";
import { posRights, type PosSettingsDto } from "@/components/pos/pos-shared";
import { Alert, Badge, Button, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useModules } from "@/lib/modules";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

function SettingsForm({ settings, canEdit, onSaved }: { settings: PosSettingsDto; canEdit: boolean; onSaved: (s: PosSettingsDto) => void }) {
  const [amount, setAmount] = useState(settings.cashDifferenceApprovalAmount);
  const [copies, setCopies] = useState(settings.printReceiptCopies);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = posSettingsSchema.safeParse({ cashDifferenceApprovalAmount: amount.trim(), printReceiptCopies: copies });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      onSaved(await api.patch<PosSettingsDto>("/pos/settings", parsed.data));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card">
      <h2 style={{ marginTop: 0 }}>Closing and receipts</h2>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Settings saved.</Alert> : null}
      <div className="form-grid">
        <TextInput
          id="pos-cash-diff"
          label="Cash difference needing a manager (₹)"
          inputMode="decimal"
          value={amount}
          disabled={!canEdit}
          error={errors.cashDifferenceApprovalAmount}
          hint="When the counted cash differs from the expected cash by more than this at closing, a manager types their PIN and a remark is needed."
          onChange={(e) => {
            setAmount(e.target.value);
            setSaved(false);
          }}
        />
        <SelectInput
          id="pos-copies"
          label="Receipt copies"
          value={String(copies)}
          disabled={!canEdit}
          error={errors.printReceiptCopies}
          hint="How many receipts print for each bill."
          onChange={(e) => {
            setCopies(Number(e.target.value));
            setSaved(false);
          }}
        >
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "None (print on request)" : n}
            </option>
          ))}
        </SelectInput>
      </div>
      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function GoLive({ settings, isOwner, onSaved }: { settings: PosSettingsDto; isOwner: boolean; onSaved: (s: PosSettingsDto) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setError(null);
    setBusy(true);
    try {
      onSaved(await api.patch<PosSettingsDto>("/pos/settings", { liveAllowed: next }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="toolbar" style={{ marginTop: 0 }}>
        <h2 style={{ margin: 0 }}>Go live</h2>
        {settings.liveAllowed ? <Badge kind="ok">Tills are live</Badge> : <Badge kind="warn">Not live yet</Badge>}
      </div>
      <p>
        GST rates and settings apply to bills as soon as they are saved, so check them and make a test bill first. Only the Owner can switch the tills live.
      </p>
      <Alert kind="error">{error}</Alert>
      {isOwner ? (
        <div className="actions">
          {settings.liveAllowed ? (
            <Button variant="danger" busy={busy} onClick={() => void toggle(false)}>
              Switch the tills back to not live
            </Button>
          ) : (
            <Button variant="primary" busy={busy} onClick={() => void toggle(true)}>
              Switch the tills live
            </Button>
          )}
        </div>
      ) : (
        <p className="muted">Only the Owner can change this.</p>
      )}
    </div>
  );
}

export default function PosSettingsPage() {
  const { user } = useAuth();
  const rights = posRights(user);
  // Plan 12: delivery and alteration charges only while their modules are on.
  const { isOn } = useModules();
  const settings = useLoad(() => api.get<PosSettingsDto>("/pos/settings"));
  return (
    <>
      <h1>Till settings</h1>
      <Alert kind="error">{settings.error}</Alert>
      {settings.data ? (
        <>
          <p className="muted">A cash difference above {rupees(settings.data.cashDifferenceApprovalAmount)} at closing needs a manager.</p>
          <SettingsForm settings={settings.data} canEdit={rights.setup} onSaved={settings.setData} />
          <GoLive settings={settings.data} isOwner={rights.owner} onSaved={settings.setData} />
          {isOn("delivery") ? <DeliverySettings settings={settings.data} canEdit={rights.setup} onSaved={settings.setData} /> : null}
          {isOn("alterations") ? <AlterationChargeSettings settings={settings.data} canEdit={rights.setup} onSaved={settings.setData} /> : null}
        </>
      ) : settings.loading ? (
        <p className="muted">Loading…</p>
      ) : null}
    </>
  );
}
