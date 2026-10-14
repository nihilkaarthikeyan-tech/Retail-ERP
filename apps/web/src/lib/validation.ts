// Copyright (c) 2026, Rademics. All rights reserved.
// Turns zod results and API errors into a flat { "field.path": message } map.
import { ApiError } from "./api";

export type FieldErrors = Record<string, string>;

interface SafeParseLike {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}

/** Field messages from a `schema.safeParse(...)` result; empty when it passed. */
export function issuesToFieldErrors(result: SafeParseLike): FieldErrors {
  const out: FieldErrors = {};
  if (result.success || !result.error) return out;
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join(".");
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}

/** Field messages from a thrown API validation error; empty for other errors. */
export function apiFieldErrors(err: unknown): FieldErrors {
  return err instanceof ApiError ? err.fieldErrors : {};
}
