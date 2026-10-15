// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useState } from "react";
import { Button, Field } from "@/components/ui";
import { api, query } from "@/lib/api";
import type { PartyRef, PartyType } from "@/lib/types";

interface PartyPickerProps {
  id: string;
  label: string;
  /** Which list to search: GET /customers or GET /suppliers. */
  kind: PartyType;
  value: PartyRef | null;
  onChange: (party: PartyRef | null) => void;
  error?: string | null;
  disabled?: boolean;
  hint?: string;
}

interface PartyPage {
  rows: (PartyRef & { mobile: string | null })[];
}

/** Search-as-you-type over customers or suppliers (code, name, mobile or GSTIN) and pick one. */
export function PartyPicker({ id, label, kind, value, onChange, error, disabled, hint }: PartyPickerProps) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<PartyPage["rows"]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const path = kind === "customer" ? "/customers" : "/suppliers";

  useEffect(() => {
    const search = text.trim();
    if (search.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      api
        .get<PartyPage>(`${path}${query({ search, pageSize: 20 })}`)
        .then((page) => {
          if (cancelled) return;
          setMatches(page.rows);
          setNote(page.rows.length === 0 ? `Nothing matches "${search}".` : null);
        })
        .catch(() => {
          if (!cancelled) setNote("Search failed. Try again.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, path]);

  if (value) {
    return (
      <Field id={id} label={label} error={error} hint={hint}>
        <div className="toolbar" style={{ margin: 0 }}>
          <span id={id}>
            <span className="mono">{value.code}</span> — {value.name}
          </span>
          {!disabled ? (
            <Button size="small" onClick={() => onChange(null)}>
              Remove
            </Button>
          ) : null}
        </div>
      </Field>
    );
  }

  return (
    <Field id={id} label={label} error={error} hint={hint ?? "Type part of the code, name or mobile. Leave empty for none."}>
      <div className="picker">
        <input id={id} className="input" value={text} autoComplete="off" disabled={disabled} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : `${id}-hint`} />
        {searching ? <p className="muted">Searching…</p> : null}
        {note ? <p className="muted">{note}</p> : null}
        {matches.length > 0 ? (
          <ul className="picker-results picker-results-static">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="picker-result"
                  onClick={() => {
                    onChange({ id: m.id, code: m.code, name: m.name });
                    setMatches([]);
                    setText("");
                  }}
                >
                  <span className="mono">{m.code}</span> {m.name}
                  {m.mobile ? <span className="muted"> · {m.mobile}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}
