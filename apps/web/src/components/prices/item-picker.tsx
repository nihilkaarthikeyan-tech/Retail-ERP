// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useState } from "react";
import { Button, Field } from "@/components/ui";
import { api, query } from "@/lib/api";
import type { ItemDto, ItemPage } from "@/lib/types";

interface ItemPickerProps {
  id: string;
  label?: string;
  value: ItemDto | null;
  onChange: (item: ItemDto | null) => void;
  error?: string | null;
  /** Styles cannot take prices or barcodes; hide them when picking for those. */
  excludeStyles?: boolean;
}

/** Search-as-you-type over the items list (code, name or barcode) and pick one. */
export function ItemPicker({ id, label = "Item", value, onChange, error, excludeStyles = true }: ItemPickerProps) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<ItemDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const search = text.trim();
    if (search.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      api
        .get<ItemPage>(`/items${query({ search, active: "true", pageSize: 20 })}`)
        .then((page) => {
          if (cancelled) return;
          const rows = excludeStyles ? page.rows.filter((r) => !r.isParentStyle) : page.rows;
          setMatches(rows);
          setNote(rows.length === 0 ? `No items match "${search}".` : null);
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
  }, [text, excludeStyles]);

  if (value) {
    return (
      <Field id={id} label={label} error={error}>
        <div className="toolbar" style={{ margin: 0 }}>
          <span id={id}>
            <span className="mono">{value.code}</span> — {value.name}
          </span>
          <Button size="small" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field id={id} label={label} error={error} hint="Type part of the code, name or a barcode.">
      <div className="picker">
        <input id={id} className="input" value={text} autoComplete="off" onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : `${id}-hint`} />
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
                    onChange(m);
                    setMatches([]);
                    setText("");
                  }}
                >
                  <span className="mono">{m.code}</span> {m.name}
                  <span className="muted"> · {m.baseUnit.code}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}
