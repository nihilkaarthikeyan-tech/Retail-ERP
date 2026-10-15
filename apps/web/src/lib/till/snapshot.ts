// Copyright (c) 2026, Rademics. All rights reserved.
// The till's saved copy of its set-up, catalogue, prices, offers and
// customers (pos-offline plan §2). Refreshed every 15 minutes while online;
// only items and customers changed since the last refresh are fetched and
// merged, the rest (prices, rates, offers, coupons, stock, set-up) is small
// and comes whole each time.
import type { KeyValueStore } from "./storage";
import type { StoredSnapshot, TillSnapshot } from "./types";

export const SNAPSHOT_KEY = "snapshot";
export const REFRESH_MS = 15 * 60_000;
/** Older than this, the cashier is warned that prices may be out of date. */
export const STALE_MS = 24 * 3600_000;

function mergeById<T extends { id: string }>(old: T[], changed: T[]): T[] {
  const byId = new Map(old.map((x) => [x.id, x]));
  for (const c of changed) byId.set(c.id, c);
  return [...byId.values()];
}

/** Applies a delta (`full: false`) to the saved snapshot, or replaces it (`full: true`). */
export function mergeSnapshot(old: StoredSnapshot | null, next: TillSnapshot, now: Date = new Date()): StoredSnapshot {
  if (next.full || !old) return { ...next, fetchedAt: now.toISOString() };
  return {
    ...next,
    items: mergeById(old.items, next.items),
    customers: mergeById(old.customers, next.customers),
    fetchedAt: now.toISOString(),
  };
}

/** The `since` to ask for: the server time of the last refresh (deltas), unless the copy is too old. */
export function sinceFor(old: StoredSnapshot | null, now: Date = new Date()): string | undefined {
  if (!old) return undefined;
  if (now.getTime() - new Date(old.fetchedAt).getTime() > STALE_MS) return undefined;
  return typeof old.serverTime === "string" ? old.serverTime : new Date(old.serverTime).toISOString();
}

export function isStale(s: StoredSnapshot | null, now: Date = new Date()): boolean {
  return !!s && now.getTime() - new Date(s.fetchedAt).getTime() > STALE_MS;
}

export async function loadSnapshot(store: KeyValueStore): Promise<StoredSnapshot | null> {
  return (await store.get<StoredSnapshot>(SNAPSHOT_KEY)) ?? null;
}

/** Fetches (via the given loader) and saves the snapshot; returns the merged copy. */
export async function refreshSnapshot(store: KeyValueStore, fetcher: (since: string | undefined) => Promise<TillSnapshot>, now: () => Date = () => new Date()): Promise<StoredSnapshot> {
  const old = await loadSnapshot(store);
  const fresh = await fetcher(sinceFor(old, now()));
  const merged = mergeSnapshot(old, fresh, now());
  await store.set(SNAPSHOT_KEY, merged);
  return merged;
}
