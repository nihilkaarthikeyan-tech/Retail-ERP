// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §2: a shop type is a starting set of modules and settings. Applying
// one saves the shop type, writes the module switches and creates the starting
// item groups, size and colour lists and common HSN codes, and (when the shop
// type changes) the starting values for new items. It never deletes or renames
// anything: a group, list or HSN code that already exists is left as it is.
import { type ModuleKey, MODULE_KEYS, modulesForShopType, SHOP_TYPES, type ShopTypeKey, withNeeds } from 'shared';
import type { Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { invalidateModuleCache, type ModuleOnOff, readModuleMap } from './module-map.js';

interface StartingAttribute {
  code: string;
  name: string;
  values: { value: string; shortCode: string }[];
}

const COLOURS: StartingAttribute = {
  code: 'COLOUR',
  name: 'Colour',
  values: [
    ['Black', 'BLK'],
    ['White', 'WHT'],
    ['Red', 'RED'],
    ['Blue', 'BLU'],
    ['Navy', 'NVY'],
    ['Green', 'GRN'],
    ['Yellow', 'YLW'],
    ['Pink', 'PNK'],
    ['Grey', 'GRY'],
    ['Brown', 'BRN'],
    ['Maroon', 'MRN'],
    ['Beige', 'BGE'],
  ].map(([value, shortCode]) => ({ value, shortCode })),
};

/** The starting size and colour lists of each shop type (suggestions the owner can edit at once). */
export const STARTING_ATTRIBUTES: Record<ShopTypeKey, StartingAttribute[]> = {
  fancy: [],
  // Decision L2 (owner, 28 October 2026): XS, and "Free size" for dupattas, sarees and some kurtis.
  clothing: [{ code: 'SIZE', name: 'Size', values: [...['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((v) => ({ value: v, shortCode: v })), { value: 'Free size', shortCode: 'FS' }] }, COLOURS],
  // A separate list from clothing sizes, so a shop selling both keeps them apart.
  footwear: [{ code: 'SHOE-SIZE', name: 'Shoe size', values: ['5', '6', '7', '8', '9', '10', '11'].map((v) => ({ value: `UK ${v}`, shortCode: v })) }, COLOURS],
  cosmetics: [],
  mobiles: [],
  general: [],
};

/** The full on/off map for a shop type, with the owner's own ticks (set-up step 5) and what they need. */
export function shopTypeModules(type: ShopTypeKey, choices?: Partial<Record<ModuleKey, boolean>>): ModuleOnOff {
  const map = { ...modulesForShopType(type), ...choices } as ModuleOnOff;
  for (const k of MODULE_KEYS) if (map[k]) for (const n of withNeeds(k)) map[n] = true;
  return map;
}

/** A group code from its name: "Men shirts" → "MEN-SHIRTS". */
function codeFor(name: string): string {
  const code = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return code || 'GROUP';
}

const key = (s: string) => s.trim().toLowerCase();

/** Which starting item groups, lists and HSN codes are still missing (groups and lists by name, ignoring case). */
export async function missingStartingSettings(db: Db, type: ShopTypeKey): Promise<{ itemGroups: string[]; attributes: StartingAttribute[]; hsnCodes: string[] }> {
  const groups = new Set((await db.itemGroup.findMany({ select: { name: true } })).map((g) => key(g.name)));
  const attrs = await db.variantAttribute.findMany({ select: { code: true, name: true } });
  const codes = new Set((await db.hsnCode.findMany({ select: { code: true } })).map((h) => h.code));
  return {
    itemGroups: (SHOP_TYPES[type].itemGroups as readonly string[]).filter((n) => !groups.has(key(n))),
    attributes: STARTING_ATTRIBUTES[type].filter((a) => !attrs.some((x) => x.code === a.code || key(x.name) === key(a.name))),
    hsnCodes: (SHOP_TYPES[type].hsnCodes as readonly string[]).filter((c) => !codes.has(c)),
  };
}

export interface ShopTypeApplied {
  modules: ModuleOnOff;
  switchedOn: ModuleKey[];
  switchedOff: ModuleKey[];
  /** Names of the item groups and lists, and the HSN codes, created now. */
  itemGroups: string[];
  attributes: string[];
  hsnCodes: string[];
}

async function record(db: Db, actor: Actor, action: 'create' | 'update', entityType: string, entityId: string, changes: Prisma.InputJsonValue) {
  await db.auditLog.create({ data: { userId: actor.userId, ipAddress: actor.ipAddress, action, entityType, entityId, changes } });
}

/**
 * Applies a shop type inside the caller's transaction: saves Company.shopType,
 * writes every module switch (the shop type's set, the owner's ticks, and what
 * they need), and creates the starting item groups and size and colour lists
 * that do not exist yet. Never deletes. Every change goes into the history.
 * Used by the guided setup (step 5) and by Settings → My modules → Shop type.
 */
export async function applyShopType(tx: Db, companyId: string, type: ShopTypeKey, actor: Actor, choices?: Partial<Record<ModuleKey, boolean>>): Promise<ShopTypeApplied> {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { shopType: true } });
  const before = await readModuleMap(tx, companyId);
  const after = shopTypeModules(type, choices);

  if (company.shopType !== type) {
    await tx.company.update({ where: { id: companyId }, data: { shopType: type, updatedById: actor.userId } });
    await record(tx, actor, 'update', 'company', companyId, { shopType: { old: company.shopType, new: type } });
    // Decisions L6 and L12: the starting values for new items (existing items keep theirs).
    const t = SHOP_TYPES[type];
    const settings = await tx.catalogueSettings.findUnique({ where: { companyId }, select: { newItemMaxDiscountPercent: true, newItemAutoNumberBatches: true } });
    if (settings && (!settings.newItemMaxDiscountPercent.eq(t.newItemMaxDiscountPercent) || settings.newItemAutoNumberBatches !== t.newItemAutoNumberBatches)) {
      await tx.catalogueSettings.update({ where: { companyId }, data: { newItemMaxDiscountPercent: t.newItemMaxDiscountPercent, newItemAutoNumberBatches: t.newItemAutoNumberBatches, updatedById: actor.userId } });
      await record(tx, actor, 'update', 'catalogue_settings', companyId, {
        newItemMaxDiscountPercent: { old: settings.newItemMaxDiscountPercent.toString(), new: t.newItemMaxDiscountPercent },
        newItemAutoNumberBatches: { old: settings.newItemAutoNumberBatches, new: t.newItemAutoNumberBatches },
        shopType: type,
      });
    }
  }

  const switchedOn: ModuleKey[] = [];
  const switchedOff: ModuleKey[] = [];
  for (const moduleKey of MODULE_KEYS) {
    const row = await tx.companyModule.upsert({
      where: { companyId_moduleKey: { companyId, moduleKey } },
      create: { companyId, moduleKey, enabled: after[moduleKey], createdById: actor.userId, updatedById: actor.userId },
      update: { enabled: after[moduleKey], updatedById: actor.userId },
    });
    if (before[moduleKey] === after[moduleKey]) continue;
    (after[moduleKey] ? switchedOn : switchedOff).push(moduleKey);
    await record(tx, actor, 'update', 'company_module', row.id, { module: moduleKey, enabled: { old: before[moduleKey], new: after[moduleKey] }, shopType: type });
  }

  const missing = await missingStartingSettings(tx, type);
  const usedCodes = new Set((await tx.itemGroup.findMany({ select: { code: true } })).map((g) => g.code));
  for (const name of missing.itemGroups) {
    const base = codeFor(name);
    let code = base;
    for (let n = 2; usedCodes.has(code); n++) code = `${base}-${n}`;
    usedCodes.add(code);
    const created = await tx.itemGroup.create({ data: { code, name, path: '', depth: 0, createdById: actor.userId, updatedById: actor.userId } });
    await tx.itemGroup.update({ where: { id: created.id }, data: { path: `/${created.id}/` } });
    await record(tx, actor, 'create', 'item_group', created.id, { code, name, parent: null, from: `shop type ${SHOP_TYPES[type].label}` });
  }
  for (const a of missing.attributes) {
    const created = await tx.variantAttribute.create({
      data: {
        code: a.code,
        name: a.name,
        kind: 'list',
        values: { create: a.values.map((v, i) => ({ value: v.value, valueKey: key(v.value), shortCode: v.shortCode, sortOrder: i })) },
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await record(tx, actor, 'create', 'variant_attribute', created.id, { code: a.code, kind: 'list', values: a.values.map((v) => v.value), from: `shop type ${SHOP_TYPES[type].label}` });
  }

  // Decision L1: the shop type's common HSN headings, with the official descriptions of the GST portal's list.
  const official = new Map((await tx.officialHsnCode.findMany({ where: { code: { in: missing.hsnCodes } }, select: { code: true, description: true, isService: true } })).map((o) => [o.code, o]));
  const hsnCodes: string[] = [];
  for (const code of missing.hsnCodes) {
    const o = official.get(code);
    if (!o) continue;
    const created = await tx.hsnCode.create({ data: { code, description: o.description, isService: o.isService, createdById: actor.userId, updatedById: actor.userId } });
    await record(tx, actor, 'create', 'hsn_code', created.id, { code, description: o.description, from: `shop type ${SHOP_TYPES[type].label}` });
    hsnCodes.push(code);
  }

  invalidateModuleCache();
  return { modules: after, switchedOn, switchedOff, itemGroups: missing.itemGroups, attributes: missing.attributes.map((a) => a.name), hsnCodes };
}
