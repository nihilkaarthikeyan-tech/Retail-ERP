// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12: the company's on/off map of optional modules, kept in memory for a
// short while so the module guard does not read the database on every request.
// Every change through this API clears it at once; the short life covers a
// second API process changing it.
import { ForbiddenException } from '@nestjs/common';
import { MODULE_KEYS, type ModuleKey, moduleMap, moduleOffMessage } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { tenantStore } from '../prisma/tenancy.js';

export type ModuleOnOff = Record<ModuleKey, boolean>;

const LIFE_MS = 15_000;

/** Audit 8: one entry per shop (it was one for the whole server, so one shop's map was used for another). */
const cached = new Map<string, { map: ModuleOnOff; until: number }>();

/** Forget the cached maps (call after switching modules or applying a shop type). */
export function invalidateModuleCache(): void {
  cached.clear();
}

/** Every optional module on: before setup, and for companies that never chose. */
export function allModulesOn(): ModuleOnOff {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as ModuleOnOff;
}

/** The saved on/off map of one company, read now (no cache); no row = on. */
export async function readModuleMap(db: Db, companyId: string): Promise<ModuleOnOff> {
  return moduleMap(await db.companyModule.findMany({ where: { companyId }, select: { moduleKey: true, enabled: true } }));
}

/** The current company's map, from the cache when it is fresh. No company yet: everything on (not cached). */
export async function currentModuleMap(db: Db): Promise<{ companyId: string | null; map: ModuleOnOff }> {
  const shop = tenantStore()?.companyId ?? null;
  const hit = shop ? cached.get(shop) : undefined;
  if (shop && hit && hit.until > Date.now()) return { companyId: shop, map: hit.map };
  // The request's shop; without one (a system job), the database's only shop as before.
  const company = shop ? { id: shop } : await db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!company) return { companyId: null, map: allModulesOn() };
  const map = await readModuleMap(db, company.id);
  if (shop) {
    if (cached.size > 2000) for (const [k, v] of cached) if (v.until <= Date.now()) cached.delete(k);
    cached.set(shop, { map, until: Date.now() + LIFE_MS });
  }
  return { companyId: company.id, map };
}

/** The 403 a switched-off module's action gets: a plain message the screens show as it is. */
export function moduleOffError(key: ModuleKey): ForbiddenException {
  return new ForbiddenException({ message: moduleOffMessage(key), code: 'MODULE_OFF', module: key });
}

/** Whether an optional module is on for the current company (for services with mixed requests). */
export async function moduleOn(db: Db, key: ModuleKey): Promise<boolean> {
  return (await currentModuleMap(db)).map[key];
}

/** Refuses the switched-off part of a request (e.g. a salesperson on a bill while Salesperson is off). */
export async function assertModuleOn(db: Db, key: ModuleKey): Promise<void> {
  if (!(await moduleOn(db, key))) throw moduleOffError(key);
}
