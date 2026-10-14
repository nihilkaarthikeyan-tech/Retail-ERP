// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui";
import { api, query } from "@/lib/api";
import type { HsnCodeDto } from "@/lib/types";

interface HsnInputProps {
  id: string;
  value: string;
  onChange: (code: string) => void;
  error?: string | null;
  disabled?: boolean;
  hint?: string;
}

/** HSN/SAC code with search-as-you-type over the company's HSN list. */
export function HsnInput({ id, value, onChange, error, disabled, hint }: HsnInputProps) {
  const [matches, setMatches] = useState<HsnCodeDto[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const text = value.trim();
    if (!open || text.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<HsnCodeDto[]>(`/catalogue/hsn-codes${query({ search: text })}`)
        .then((rows) => {
          if (!cancelled) setMatches(rows.filter((r) => r.active).slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, open]);

  const showList = open && value.trim().length >= 2 && matches.length > 0;

  return (
    <Field id={id} label="HSN / SAC code" error={error} hint={hint}>
      <div className="picker">
        <input
          id={id}
          className="input mono"
          value={value}
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on a result land before the list closes.
            setTimeout(() => setOpen(false), 150);
          }}
        />
        {showList ? (
          <ul className="picker-results" id={`${id}-list`}>
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="picker-result"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(m.code);
                    setOpen(false);
                  }}
                >
                  <span className="mono">{m.code}</span> {m.description}
                  {m.isService ? <span className="muted"> (service)</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}
