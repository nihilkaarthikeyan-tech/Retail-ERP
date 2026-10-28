// Copyright (c) 2026, Rademics. All rights reserved.
// The official HSN / SAC list of the GST portal (owner, 28 October 2026), the same for every shop.
"use client";

import { useEffect, useState } from "react";
import { api, query } from "./api";

export interface OfficialHsnDto {
  code: string;
  description: string;
  isService: boolean;
  /** The 4-digit heading's description, for a longer code. */
  heading?: string | null;
}

export interface OfficialHsnLookup {
  code: string;
  description: string | null;
  isService: boolean | null;
  official: boolean;
}

/** A complete code: 4, 6 or 8 digits. */
export const isCompleteHsn = (code: string) => /^(\d{4}|\d{6}|\d{8})$/.test(code.trim());

export function searchOfficialHsn(text: string): Promise<OfficialHsnDto[]> {
  return api.get<OfficialHsnDto[]>(`/catalogue/official-hsn${query({ search: text.trim() })}`);
}

export function lookupOfficialHsn(code: string): Promise<OfficialHsnLookup> {
  return api.get<OfficialHsnLookup>(`/catalogue/official-hsn/${encodeURIComponent(code.trim())}`);
}

/**
 * What the official list says about a complete code, a moment after typing stops: the lookup,
 * or null while the code is incomplete or the list cannot be reached (then nothing is said).
 */
export function useOfficialHsn(code: string): OfficialHsnLookup | null {
  const [found, setFound] = useState<OfficialHsnLookup | null>(null);
  const c = code.trim();
  useEffect(() => {
    if (!isCompleteHsn(c)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupOfficialHsn(c)
        .then((r) => !cancelled && setFound(r))
        .catch(() => !cancelled && setFound(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [c]);
  return isCompleteHsn(c) && found?.code === c ? found : null;
}
