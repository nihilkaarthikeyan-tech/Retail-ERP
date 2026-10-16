// Copyright (c) 2026, Rademics. All rights reserved.
// A manager's PIN approval (decision 40): pick the manager, type the PIN,
// and the API gives a single-use approval token for one action at one till.
"use client";

import type { ApprovalAction } from "shared";
import { Alert, Button, Field, SelectInput } from "@/components/ui";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import type { TillPeople } from "./pos-shared";

export interface ManagerPinValue {
  managerId: string;
  pin: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

/** Manager picker and PIN pad; the parent asks for the approval with `requestApproval`. */
export function ManagerPinFields({ tillId, value, onChange, idPrefix = "mgr" }: { tillId: string; value: ManagerPinValue; onChange: (v: ManagerPinValue) => void; idPrefix?: string }) {
  const people = useLoad(() => api.get<TillPeople>(`/pos/tills/${tillId}/people`), [tillId]);
  const managers = people.data?.managers ?? [];

  function press(key: (typeof KEYS)[number]) {
    if (key === "clear") onChange({ ...value, pin: "" });
    else if (key === "back") onChange({ ...value, pin: value.pin.slice(0, -1) });
    else if (value.pin.length < 6) onChange({ ...value, pin: value.pin + key });
  }

  return (
    <>
      <Alert kind="error">{people.error}</Alert>
      <SelectInput id={`${idPrefix}-manager`} label="Manager" value={value.managerId} onChange={(e) => onChange({ ...value, managerId: e.target.value })} hint={people.data && managers.length === 0 ? "No manager of this store has set a PIN yet." : undefined}>
        <option value="">Choose the manager</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectInput>
      <Field id={`${idPrefix}-pin`} label="Manager’s PIN">
        <input
          id={`${idPrefix}-pin`}
          className="input mono"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={value.pin}
          onChange={(e) => onChange({ ...value, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 64px)", gap: 6, marginBottom: 12 }} aria-label="PIN pad">
        {KEYS.map((k) => (
          <Button key={k} onClick={() => press(k)} aria-label={k === "clear" ? "Clear PIN" : k === "back" ? "Delete last digit" : undefined}>
            {k === "clear" ? "C" : k === "back" ? "⌫" : k}
          </Button>
        ))}
      </div>
    </>
  );
}

/** Checks the PIN on the server; returns the single-use approval token. */
export async function requestApproval(tillId: string, action: ApprovalAction, value: ManagerPinValue, details?: string): Promise<{ token: string; manager: { id: string; name: string } }> {
  if (!value.managerId) throw new Error("Choose the manager who approves.");
  if (!/^\d{4,6}$/.test(value.pin)) throw new Error("The manager’s PIN is 4 to 6 digits.");
  return api.post<{ token: string; manager: { id: string; name: string } }>("/pos/approvals", { tillId, managerId: value.managerId, pin: value.pin, action, details: details ?? null });
}
