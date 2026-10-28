// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui";
import { api, query } from "@/lib/api";
import { searchOfficialHsn, useOfficialHsn } from "@/lib/official-hsn";
import type { HsnCodeDto } from "@/lib/types";

interface HsnInputProps {
  id: string;
  value: string;
  onChange: (code: string) => void;
  error?: string | null;
  disabled?: boolean;
  hint?: string;
}

interface Match {
  key: string;
  code: string;
  description: string;
  isService: boolean;
  official: boolean;
  heading?: string | null;
}

/**
 * HSN/SAC code with search-as-you-type over the shop's own HSN list and, after it, the official
 * list of the GST portal (owner, 28 October 2026). A complete code shows its official description,
 * or a warning when the official list does not have it.
 */
export function HsnInput({ id, value, onChange, error, disabled, hint }: HsnInputProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const official = useOfficialHsn(value);

  useEffect(() => {
    const text = value.trim();
    if (!open || text.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const own = api
        .get<HsnCodeDto[]>(`/catalogue/hsn-codes${query({ search: text })}`)
        .then((rows) => rows.filter((r) => r.active).slice(0, 6))
        .catch(() => [] as HsnCodeDto[]);
      const listed = searchOfficialHsn(text).catch(() => []);
      void Promise.all([own, listed]).then(([mine, theirs]) => {
        if (cancelled) return;
        const ownCodes = new Set(mine.map((m) => m.code));
        setMatches([
          ...mine.map((m) => ({ key: `own-${m.id}`, code: m.code, description: m.description, isService: m.isService, official: false })),
          ...theirs.filter((o) => !ownCodes.has(o.code)).slice(0, 8).map((o) => ({ key: `gov-${o.code}`, code: o.code, description: o.description, isService: o.isService, official: true, heading: o.heading })),
        ]);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, open]);

  const showList = open && value.trim().length >= 2 && matches.length > 0;
  const firstOfficial = matches.findIndex((m) => m.official);

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
            {matches.map((m, i) => (
              <li key={m.key}>
                {i === firstOfficial ? <div className="picker-group">Official list (GST portal)</div> : null}
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
                  {m.heading ? <span className="picker-result-note">{m.heading}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {official?.official ? <p className="field-hint">Official: {official.description}</p> : null}
      {official && !official.official ? <p className="field-warning">{value.trim()} is not in the official HSN / SAC list of the GST portal. Check the code.</p> : null}
    </Field>
  );
}
