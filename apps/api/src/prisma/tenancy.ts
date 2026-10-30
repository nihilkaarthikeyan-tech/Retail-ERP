// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 14: one system for many shops. Every request knows which shop (company)
// it works for; the database sees only that shop's rows (row-level security).
import { AsyncLocalStorage } from 'node:async_hooks';

/** The shop the current request or job works for; null before it is known. */
export interface TenantStore {
  companyId: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Runs `fn` for one shop: every database call inside sees only its rows. The
 * result is awaited inside, because a database query only starts when it is
 * awaited: a query handed back un-awaited would otherwise run outside the shop.
 */
export function runForCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ companyId }, async () => await fn());
}

/** Starts a request whose shop is not known yet (the session guard fills it in). */
export function runRequest<T>(fn: () => T): T {
  return storage.run({ companyId: null }, fn);
}

/** The current store (read by the database pool on every connection it hands out). */
export function tenantStore(): TenantStore | undefined {
  return storage.getStore();
}

/**
 * Login and the session check: once the person is known (from the database,
 * never from the browser), the rest of the request works for their shop.
 */
export function enterCompany(companyId: string): void {
  const store = storage.getStore();
  if (!store) throw new Error('enterCompany outside a request');
  if (store.companyId && store.companyId !== companyId) throw new Error('A request cannot change its shop');
  store.companyId = companyId;
}

/** The database role every shop's requests run as (row-level security applies to it). */
export const TENANT_DB_ROLE = 'retail_erp_app';
