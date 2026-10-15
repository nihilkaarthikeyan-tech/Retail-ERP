// Copyright (c) 2026, Rademics. All rights reserved.
// Default stock locations and number series (approved plan, question 2).
// Plain functions (no Nest wiring) so store creation and setup can call them
// inside their own transactions without a module cycle.
import type { Db } from '../audit/audit.service.js';
import type { StockLocation } from '../generated/prisma/client.js';

export const TRANSIT_CODE = 'TRANSIT';

/** Number series for every kind of stock document (company-wide pattern with the store code). */
export const STOCK_NUMBER_SERIES: Record<string, string> = {
  stock_in: 'SIN-{STORE}-{FY}-',
  stock_out: 'SOT-{STORE}-{FY}-',
  move: 'MOV-{STORE}-{FY}-',
  transfer_send: 'TRS-{STORE}-{FY}-',
  transfer_receive: 'TRR-{STORE}-{FY}-',
  count: 'CNT-{STORE}-{FY}-',
};

export function seriesKind(kind: string): string {
  return `stock_${kind}`;
}

/** Idempotent: transit location, inventory settings and number series for a company. */
export async function ensureCompanyInventory(db: Db, companyId: string): Promise<StockLocation> {
  const transit = await db.stockLocation.upsert({
    where: { companyId_code: { companyId, code: TRANSIT_CODE } },
    create: { companyId, code: TRANSIT_CODE, name: 'Goods in transit', kind: 'transit' },
    update: {},
  });
  await db.inventorySettings.upsert({
    where: { companyId },
    create: { companyId, transitLocationId: transit.id },
    update: {},
  });
  for (const [kind, pattern] of Object.entries(STOCK_NUMBER_SERIES)) {
    const documentKind = seriesKind(kind);
    const exists = await db.numberSeries.findFirst({ where: { companyId, documentKind, storeId: null } });
    if (!exists) await db.numberSeries.create({ data: { companyId, documentKind, pattern, counterLength: 5 } });
  }
  return transit;
}

/** Idempotent: folder + Shop floor + Back room + Rejected for a store. */
export async function ensureStoreLocations(db: Db, store: { id: string; companyId: string; code: string; name: string }): Promise<void> {
  await ensureCompanyInventory(db, store.companyId);
  const folder = await db.stockLocation.upsert({
    where: { companyId_code: { companyId: store.companyId, code: store.code } },
    create: { companyId: store.companyId, storeId: store.id, code: store.code, name: store.name, kind: 'folder' },
    update: {},
  });
  const children: [string, string, 'shelf' | 'rejected'][] = [
    ['FLOOR', 'Shop floor', 'shelf'],
    ['BACK', 'Back room', 'shelf'],
    ['REJECT', 'Rejected goods', 'rejected'],
  ];
  for (const [suffix, name, kind] of children) {
    const code = `${store.code}-${suffix}`;
    await db.stockLocation.upsert({
      where: { companyId_code: { companyId: store.companyId, code } },
      create: { companyId: store.companyId, storeId: store.id, parentId: folder.id, code, name, kind },
      update: {},
    });
  }
}
