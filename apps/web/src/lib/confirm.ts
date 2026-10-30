// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

/**
 * Audit 9: one question before a document is finalised or posted. Finalising changes stock and the
 * accounts at once, and undoing it needs a cancellation, so a stray click should not do it.
 */
export function confirmPosting(what: string, effect: string): boolean {
  return window.confirm(`${what}?\n\n${effect}\n\nTo undo it later it has to be cancelled, which puts everything back.`);
}
