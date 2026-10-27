// Copyright (c) 2026, Rademics. All rights reserved.
// Turns zod results and API errors into a flat { "field.path": message } map.
import { ApiError } from "./api";

export type FieldErrors = Record<string, string>;

interface SafeParseLike {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}

/** The event a form problem not tied to one field is announced with (shown as a red note). */
export const FORM_PROBLEM_EVENT = "retail-erp:form-problem";

/**
 * Field messages from a `schema.safeParse(...)` result; empty when it passed. A rule about two
 * fields together ("End date cannot be before start date") has no field of its own: it is
 * announced so the person sees it. Found in the launch check of 27 October 2026: no form showed
 * such messages, so Save seemed to do nothing.
 */
export function issuesToFieldErrors(result: SafeParseLike): FieldErrors {
  const out: FieldErrors = {};
  if (result.success || !result.error) return out;
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join(".");
    if (!(path in out)) out[path] = issue.message;
  }
  if ("" in out && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FORM_PROBLEM_EVENT, { detail: out[""] }));
  return out;
}

/** Field messages from a thrown API validation error; empty for other errors. */
export function apiFieldErrors(err: unknown): FieldErrors {
  return err instanceof ApiError ? err.fieldErrors : {};
}
