// Copyright (c) 2026, Rademics. All rights reserved.
// What this browser remembers about the menu: which groups are opened, and
// which screens this person opens most (so the five most-used sit at the
// top). Kept in this browser only, per person (a shop computer is shared; found
// in the launch check of 27 October 2026), read through useSyncExternalStore so
// the first paint matches the server and updates arrive as events.

const USAGE_KEY = "retail-erp.menu-usage";
// Owner, 27 October 2026 (decision L11): groups start folded and the ones a person opens are
// remembered. A new key, so the old "folded" lists of the earlier menu are simply left behind.
const OPENED_KEY = "retail-erp.menu-opened";
const MOST_USED = 5;

export type Counts = Readonly<Record<string, number>>;

const EMPTY_COUNTS: Counts = Object.freeze({});
const EMPTY_LIST: readonly string[] = Object.freeze([]);

let user = "";
let counts: Counts | null = null;
let opened: readonly string[] | null = null;
const listeners = new Set<() => void>();

/** Whose menu this is; called when the signed-in user is known or changes. */
export function setMenuUser(userId: string | null): void {
  const next = userId ?? "";
  if (next === user) return;
  user = next;
  counts = null;
  opened = null;
  emit();
}

const keyFor = (key: string) => (user ? `${key}:${user}` : key);

function readJson(key: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(keyFor(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(keyFor(key), JSON.stringify(value));
  } catch {
    // Private windows may refuse storage; the change then lasts for this visit only.
  }
}

function emit() {
  for (const l of listeners) l();
}

export function subscribeMenuStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Visit counts by screen; the same object until a visit is recorded. */
export function getCounts(): Counts {
  if (counts === null) {
    const parsed = readJson(USAGE_KEY);
    counts = parsed && typeof parsed === "object" ? Object.freeze({ ...(parsed as Record<string, number>) }) : EMPTY_COUNTS;
  }
  return counts;
}

export const getServerCounts = (): Counts => EMPTY_COUNTS;

/** Menu groups the person opened; the same array until one is toggled. */
export function getOpened(): readonly string[] {
  if (opened === null) {
    const parsed = readJson(OPENED_KEY);
    opened = Array.isArray(parsed) ? Object.freeze(parsed.filter((x): x is string => typeof x === "string")) : EMPTY_LIST;
  }
  return opened;
}

export const getServerOpened = (): readonly string[] => EMPTY_LIST;

/** Counts one visit to a menu screen (the dashboard is always one click away, so it is not counted). */
export function recordVisit(href: string): void {
  if (href === "/dashboard") return;
  const next = { ...getCounts(), [href]: (getCounts()[href] ?? 0) + 1 };
  counts = Object.freeze(next);
  writeJson(USAGE_KEY, next);
  emit();
}

export function toggleOpened(section: string): void {
  const now = getOpened();
  const next = now.includes(section) ? now.filter((s) => s !== section) : [...now, section];
  opened = Object.freeze(next);
  writeJson(OPENED_KEY, next);
  emit();
}

/** The screens opened at least twice, most used first, at most five. */
export function mostUsed(c: Counts, hrefs: string[]): string[] {
  return hrefs
    .filter((h) => (c[h] ?? 0) >= 2)
    .sort((a, b) => c[b] - c[a])
    .slice(0, MOST_USED);
}
