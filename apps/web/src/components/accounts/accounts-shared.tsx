// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useState } from "react";
import { Badge, SelectInput } from "@/components/ui";
import { api } from "@/lib/api";
import { type AccountDto, type AccountFamily, accountName, type ChartDto, DOC_STATUS_LABELS, type DocStatus, FAMILY_LABELS, type OpenItemDto, type PartyKind, statusTone } from "@/lib/accounts";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

/** The chart of accounts with balances (GET /accounts). */
export function useChart() {
  return useLoad(() => api.get<ChartDto>("/accounts"));
}

const FAMILY_ORDER: AccountFamily[] = ["asset", "liability", "equity", "income", "expense"];

interface AccountSelectProps {
  id: string;
  label: string;
  accounts: AccountDto[];
  value: string;
  onChange: (accountId: string) => void;
  /** Text of the empty choice. */
  placeholder?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}

/** The <option>s of an account drop-down, grouped by family, with an empty first choice. */
export function AccountOptions({ accounts, placeholder = "Choose an account" }: { accounts: AccountDto[]; placeholder?: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {FAMILY_ORDER.map((f) => {
        const list = accounts.filter((a) => a.family === f);
        if (list.length === 0) return null;
        return (
          <optgroup key={f} label={FAMILY_LABELS[f]}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {accountName(a)}
                {a.locked ? " (locked)" : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/** A drop-down of accounts, grouped by family (assets, liabilities…), in account-number order. */
export function AccountSelect({ id, label, accounts, value, onChange, placeholder, error, hint, required, disabled }: AccountSelectProps) {
  return (
    <SelectInput id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={hint} required={required} disabled={disabled}>
      <AccountOptions accounts={accounts} placeholder={placeholder} />
    </SelectInput>
  );
}

export function DocStatusBadge({ status }: { status: DocStatus }) {
  return <Badge kind={statusTone(status)}>{DOC_STATUS_LABELS[status]}</Badge>;
}

/**
 * Code and name of customers and suppliers known only by id (journal lines,
 * payments, opening bills). Looked up once each; unknown ones stay as "—".
 */
export function usePartyNames(refs: { type: PartyKind | null; id: string | null }[]): Record<string, PartyRef> {
  const [names, setNames] = useState<Record<string, PartyRef>>({});
  const wanted = refs.filter((r): r is { type: PartyKind; id: string } => !!r.type && !!r.id);
  const key = [...new Set(wanted.map((r) => `${r.type}|${r.id}`))].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const missing = key ? key.split(",").filter((k) => !(k.split("|")[1] in names)) : [];
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (k) => {
        const [type, id] = k.split("|");
        try {
          const p = await api.get<PartyRef>(`/${type === "customer" ? "customers" : "suppliers"}/${id}`);
          return { id, ref: { id, code: p.code, name: p.name } };
        } catch {
          return null;
        }
      }),
    ).then((found) => {
      if (cancelled) return;
      setNames((n) => {
        const next = { ...n };
        for (const f of found) if (f) next[f.id] = f.ref;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // `names` is read only to skip known ones; `key` says when the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return names;
}

/** A customer's or supplier's unpaid bills and unused payments; nothing until a party is chosen. */
export function useOpenItems(partyType: PartyKind | null, partyId: string | null) {
  return useLoad<OpenItemDto[] | null>(() => (partyType && partyId ? api.get<OpenItemDto[]>(`/parties/${partyType}/${partyId}/open-items`) : Promise.resolve(null)), [partyType, partyId]);
}

export function partyText(ref: PartyRef | undefined | null): string {
  return ref ? `${ref.code} — ${ref.name}` : "—";
}

/** Class that highlights a negative amount. */
export function signedClass(value: string | null | undefined): string | undefined {
  return value?.startsWith("-") ? "num-negative" : undefined;
}
