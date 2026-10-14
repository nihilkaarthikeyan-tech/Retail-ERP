// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { looksLikeCode } from "@/lib/catalogue";
import type { ScanResult } from "@/lib/types";

interface ItemSearchBoxProps {
  /** Text to start with (for example from the page's query string). */
  initial?: string;
  /** Called with the typed text when it is not an exact barcode or item code. */
  onSearch?: (text: string) => void;
  /** Called when a scan matched; by default the box jumps to the item's page. */
  onScanned?: (result: ScanResult) => void;
  label?: string;
  placeholder?: string;
}

/**
 * Scan box: Enter on an exact barcode or item code opens that item; anything
 * else is passed on as a search. A hand scanner "types" the code and presses Enter.
 */
export function ItemSearchBox({ initial = "", onSearch, onScanned, label = "Scan or search", placeholder = "Barcode, code or name" }: ItemSearchBoxProps) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const typed = text.trim();
    setNote(null);
    if (typed && looksLikeCode(typed)) {
      setBusy(true);
      try {
        const result = await api.get<ScanResult>(`/catalogue/scan/${encodeURIComponent(typed)}`);
        if (onScanned) onScanned(result);
        else router.push(`/items/${result.item.id}`);
        return;
      } catch (err) {
        if (!(err instanceof ApiError && err.statusCode === 404)) {
          setNote(errorMessage(err));
          return;
        }
        // Not a known code: fall through to a plain search.
      } finally {
        setBusy(false);
      }
    }
    onSearch?.(typed);
  }

  return (
    <form onSubmit={submit} className="scan-box" role="search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="search"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        aria-describedby={note ? `${id}-note` : undefined}
      />
      <Button type="submit" busy={busy}>
        Go
      </Button>
      {note ? (
        <p id={`${id}-note`} className="field-error" role="alert">
          {note}
        </p>
      ) : null}
    </form>
  );
}
