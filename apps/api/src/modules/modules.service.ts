// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §1: optional modules switched on or off per company. Switching off
// only hides a module (menus, screens, till buttons, reports) and makes the API
// refuse its actions; it never deletes or changes data. Only the Owner switches
// modules; every change is in the history.
import { Injectable } from '@nestjs/common';
import {
  MODULE_KEYS,
  type ModuleKey,
  type ModulesState,
  type ModuleSwitchResult,
  neededBy,
  OPTIONAL_MODULES,
  SHOP_TYPE_KEYS,
  SHOP_TYPES,
  type ShopTypeKey,
  type ShopTypeResult,
  withNeeds,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentModuleMap, invalidateModuleCache, moduleOffError, type ModuleOnOff, readModuleMap } from './module-map.js';
import { applyShopType, missingStartingSettings, shopTypeModules } from './shop-type.js';
import { moduleWarnings } from './warnings.js';

const label = (k: ModuleKey) => OPTIONAL_MODULES[k].label;
const list = (keys: ModuleKey[]) => keys.map(label).join(', ');

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The current company's on/off map (cached briefly; no company yet = everything on). */
  async map(): Promise<ModuleOnOff> {
    return (await currentModuleMap(this.prisma)).map;
  }

  async isOn(key: ModuleKey): Promise<boolean> {
    return (await this.map())[key];
  }

  /** Refuses with the plain "switched off" message when the module is off. */
  async assertOn(...keys: ModuleKey[]): Promise<void> {
    const map = await this.map();
    for (const k of keys) if (!map[k]) throw moduleOffError(k);
  }

  invalidate(): void {
    invalidateModuleCache();
  }

  /** GET /modules: for every signed-in user (menus, screens and the till need it). */
  async state(): Promise<ModulesState> {
    const company = await this.prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, shopType: true } });
    if (!company) return { shopType: null, modules: await this.map() };
    return { shopType: isShopType(company.shopType) ? company.shopType : null, modules: await readModuleMap(this.prisma, company.id) };
  }

  /** What is still in use in each of these modules, labelled when more than one module goes off. */
  private async warningsFor(db: Db, companyId: string, keys: ModuleKey[]): Promise<string[]> {
    const out: string[] = [];
    for (const k of keys) {
      for (const w of await moduleWarnings(db, companyId, k)) out.push(keys.length > 1 ? `${label(k)}: ${w}` : w);
    }
    return out;
  }

  /**
   * PATCH /modules/:key (Owner only). Switching on also switches on what it needs,
   * and says so. Switching off first answers with the warnings (things still in
   * use, and the modules that need this one, which go off with it); with
   * confirm=true it goes ahead. Nothing is ever deleted.
   */
  async switch(key: ModuleKey, enabled: boolean, confirm: boolean, actor: Actor): Promise<ModuleSwitchResult> {
    const company = await this.prisma.company.findFirstOrThrow({ orderBy: { createdAt: 'asc' }, select: { id: true, shopType: true } });
    const before = await readModuleMap(this.prisma, company.id);
    const shopType = isShopType(company.shopType) ? company.shopType : null;

    if (enabled) {
      const switchedOn = withNeeds(key).filter((k) => !before[k]);
      if (switchedOn.length) await this.save(company.id, switchedOn, true, actor, key);
      const extra = switchedOn.filter((k) => k !== key);
      const message = !switchedOn.length
        ? `${label(key)} is already on.`
        : `${label(key)} is switched on.${extra.length ? ` ${list(extra)} ${extra.length === 1 ? 'is' : 'are'} switched on too, because ${label(key)} needs ${extra.length === 1 ? 'it' : 'them'}.` : ''}`;
      return { done: true, needsConfirm: false, warnings: [], switchedOn, switchedOff: [], message, shopType, modules: await readModuleMap(this.prisma, company.id) };
    }

    if (!before[key]) {
      return { done: true, needsConfirm: false, warnings: [], switchedOn: [], switchedOff: [], message: `${label(key)} is already off.`, shopType, modules: before };
    }
    // The modules still on that need this one go off with it.
    const dependents = neededBy(key).filter((k) => before[k]);
    const switchedOff = [key, ...dependents];
    const warnings = [
      ...dependents.map((d) => `${label(d)} needs ${label(key)}; it will be switched off too`),
      ...(await this.warningsFor(this.prisma, company.id, switchedOff)),
    ];
    if (warnings.length && !confirm) {
      return {
        done: false,
        needsConfirm: true,
        warnings,
        switchedOn: [],
        switchedOff,
        message: `Before switching off ${label(key)}: ${warnings.join('; ')}. Switching off only hides it; nothing is deleted.`,
        shopType,
        modules: before,
      };
    }
    await this.save(company.id, switchedOff, false, actor, key);
    return {
      done: true,
      needsConfirm: false,
      warnings,
      switchedOn: [],
      switchedOff,
      message: `${list(switchedOff)} ${switchedOff.length === 1 ? 'is' : 'are'} switched off. Nothing was deleted; switching on again shows everything as it was.`,
      shopType,
      modules: await readModuleMap(this.prisma, company.id),
    };
  }

  private async save(companyId: string, keys: ModuleKey[], enabled: boolean, actor: Actor, asked: ModuleKey) {
    await this.prisma.$transaction(async (tx) => {
      for (const moduleKey of keys) {
        const row = await tx.companyModule.upsert({
          where: { companyId_moduleKey: { companyId, moduleKey } },
          create: { companyId, moduleKey, enabled, createdById: actor.userId, updatedById: actor.userId },
          update: { enabled, updatedById: actor.userId },
        });
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'company_module',
          entityId: row.id,
          changes: { module: moduleKey, enabled: { old: !enabled, new: enabled } },
          reason: moduleKey === asked ? null : enabled ? `${label(asked)} needs it` : `It needs ${label(asked)}`,
        });
      }
    });
    invalidateModuleCache();
  }

  /**
   * POST /modules/shop-type (Owner only). Without confirm: what it would change
   * (modules on and off, warnings, starting groups and lists to create). With
   * confirm: applies it. Never deletes; existing groups and lists are kept.
   */
  async chooseShopType(type: ShopTypeKey, confirm: boolean, actor: Actor): Promise<ShopTypeResult> {
    const company = await this.prisma.company.findFirstOrThrow({ orderBy: { createdAt: 'asc' }, select: { id: true, shopType: true } });
    const before = await readModuleMap(this.prisma, company.id);
    const after = shopTypeModules(type);
    const switchOn = MODULE_KEYS.filter((k) => after[k] && !before[k]);
    const switchOff = MODULE_KEYS.filter((k) => !after[k] && before[k]);
    const base = { type, label: SHOP_TYPES[type].label, switchOn, switchOff };
    if (!confirm) {
      const missing = await missingStartingSettings(this.prisma, type);
      const warnings = await this.warningsFor(this.prisma, company.id, switchOff);
      return {
        ...base,
        done: false,
        needsConfirm: true,
        warnings,
        itemGroups: missing.itemGroups,
        attributes: missing.attributes.map((a) => a.name),
        message: `Apply the shop type “${SHOP_TYPES[type].label}”? Modules are switched to its set and missing starting lists are added. Nothing is deleted.`,
        shopType: isShopType(company.shopType) ? company.shopType : null,
        modules: before,
      };
    }
    const applied = await this.prisma.$transaction((tx) => applyShopType(tx, company.id, type, actor), { timeout: 30_000 });
    invalidateModuleCache();
    return {
      ...base,
      done: true,
      needsConfirm: false,
      warnings: [],
      itemGroups: applied.itemGroups,
      attributes: applied.attributes,
      message: `The shop type is now “${SHOP_TYPES[type].label}”. Nothing was deleted.`,
      shopType: type,
      modules: applied.modules,
    };
  }
}

function isShopType(value: string | null): value is ShopTypeKey {
  return !!value && (SHOP_TYPE_KEYS as string[]).includes(value);
}
