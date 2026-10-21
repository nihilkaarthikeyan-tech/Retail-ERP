// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, moduleMap, modulesForShopType, neededBy, OPTIONAL_MODULES, SHOP_TYPES, withNeeds } from './modules.js';

describe('optional modules (plan 12)', () => {
  it('a module with no saved choice is on, so existing companies keep everything', () => {
    const map = moduleMap([{ moduleKey: 'variants', enabled: false }, { moduleKey: 'unknown', enabled: false }]);
    expect(map.variants).toBe(false);
    expect(MODULE_KEYS.filter((k) => k !== 'variants').every((k) => map[k])).toBe(true);
  });

  it('switching on alterations brings salesperson with it, and salesperson is needed by alterations', () => {
    expect(withNeeds('alterations').sort()).toEqual(['alterations', 'salesperson']);
    expect(neededBy('salesperson')).toEqual(['alterations']);
    expect(neededBy('offers')).toEqual([]);
  });

  it('every need names a real module', () => {
    for (const m of Object.values(OPTIONAL_MODULES)) for (const n of m.needs) expect(MODULE_KEYS).toContain(n);
  });

  it('shop types switch on their modules and their needs only', () => {
    const fancy = modulesForShopType('fancy');
    expect(fancy.offers).toBe(true);
    expect([fancy.variants, fancy.batches, fancy.serials, fancy.alterations, fancy.consignment, fancy.seasons]).toEqual([false, false, false, false, false, false]);
    const clothing = modulesForShopType('clothing');
    expect([clothing.variants, clothing.alterations, clothing.salesperson, clothing.batches]).toEqual([true, true, true, false]);
    expect(modulesForShopType('cosmetics').batches).toBe(true);
    expect(modulesForShopType('mobiles').serials).toBe(true);
    for (const t of Object.values(SHOP_TYPES)) expect(t.itemGroups.length).toBeGreaterThan(0);
  });
});
