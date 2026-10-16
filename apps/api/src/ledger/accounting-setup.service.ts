// Copyright (c) 2026, Rademics. All rights reserved.
// Creates the standard chart of accounts, the default account for every role
// and each store's cash accounts (plan 07 §1). Idempotent and safe when two
// requests ask at the same moment: existing rows are skipped, never an error.
import { Injectable } from '@nestjs/common';
import { ACCOUNT_ROLES, STORE_ACCOUNT_ROLES, type StoreAccountRole } from 'shared';
import type { Db } from '../audit/audit.service.js';
import type { Account } from '../generated/prisma/client.js';
import { CHART_TEMPLATE, STORE_ACCOUNTS, type TemplateAccount } from './chart-template.js';

@Injectable()
export class AccountingSetup {
  async ensure(db: Db, companyId: string): Promise<void> {
    const done = await db.accountDefault.count({ where: { companyId } });
    if (done < Object.keys(ACCOUNT_ROLES).length) await this.createChart(db, companyId);
  }

  private async createChart(db: Db, companyId: string) {
    // Level by level, so each folder exists before its children.
    let level: { node: TemplateAccount; family: (typeof CHART_TEMPLATE)[number]['family']; parentKey: string | null }[] = CHART_TEMPLATE.map((f) => ({ node: f.root, family: f.family, parentKey: null }));
    while (level.length) {
      const parentKeys = [...new Set(level.map((l) => l.parentKey).filter((k): k is string => !!k))];
      const parents = new Map((await db.account.findMany({ where: { companyId, systemKey: { in: parentKeys } } })).map((a) => [a.systemKey!, a.id]));
      await db.account.createMany({
        data: level.map((l) => ({
          companyId,
          parentId: l.parentKey ? parents.get(l.parentKey)! : null,
          number: l.node.number,
          name: l.node.name,
          isGroup: !!l.node.children,
          family: l.family,
          kind: l.node.children ? null : (l.node.kind ?? null),
          balanceMustBe: l.node.balanceMustBe ?? null,
          // Top-level folders cannot be changed (blueprint 11 business rules).
          locked: false,
          systemKey: l.node.key,
        })),
        skipDuplicates: true,
      });
      level = level.flatMap((l) => (l.node.children ?? []).map((c) => ({ node: c, family: l.family, parentKey: l.node.key })));
    }
    const byKey = new Map((await db.account.findMany({ where: { companyId, systemKey: { in: Object.keys(ACCOUNT_ROLES) } } })).map((a) => [a.systemKey!, a.id]));
    await db.accountDefault.createMany({
      data: Object.keys(ACCOUNT_ROLES)
        .filter((role) => byKey.has(role))
        .map((role) => ({ companyId, role, accountId: byKey.get(role)! })),
      skipDuplicates: true,
    });
    await db.accountingSettings.createMany({ data: [{ companyId }], skipDuplicates: true });
    const stores = await db.store.findMany({ where: { companyId }, select: { id: true } });
    for (const s of stores) await this.ensureStore(db, companyId, s.id);
  }

  /** Cash in till and cash in hand for a store, under "Cash in hand". */
  async ensureStore(db: Db, companyId: string, storeId: string): Promise<void> {
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { code: true, name: true } });
    const folder = await db.account.findUnique({ where: { companyId_systemKey: { companyId, systemKey: 'cash_group' } } });
    if (!folder) return;
    await db.account.createMany({
      data: STORE_ACCOUNTS.map((s) => ({
        companyId,
        parentId: folder.id,
        name: `${s.name} — ${store.code}`,
        isGroup: false,
        family: 'asset' as const,
        kind: 'cash',
        storeId,
        systemKey: `${s.role}:${storeId}`,
      })),
      skipDuplicates: true,
    });
  }

  async storeAccount(db: Db, companyId: string, storeId: string, role: StoreAccountRole): Promise<Account> {
    const key = `${role}:${storeId}`;
    let a = await db.account.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } } });
    if (!a) {
      await this.ensureStore(db, companyId, storeId);
      a = await db.account.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } } });
    }
    if (!a) throw new Error(`${STORE_ACCOUNT_ROLES[role]} account missing for store ${storeId}`);
    return a;
  }
}
