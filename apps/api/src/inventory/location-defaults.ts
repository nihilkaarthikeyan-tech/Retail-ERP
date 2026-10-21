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
  // Plan 08 (CGST rule 46(b), rule 55): a send between GSTINs is a tax invoice, and every send a challan; their numbers stay within 16 characters.
  transfer_send: 'TRS/{FYS}/',
  transfer_receive: 'TRR-{STORE}-{FY}-',
  count: 'CNT-{STORE}-{FY}-',
};

export function seriesKind(kind: string): string {
  return `stock_${kind}`;
}

/**
 * Idempotent: transit location, inventory settings and number series for a company.
 * Safe when several requests ask at the same moment: rows that already exist are skipped, never an error.
 */
export async function ensureCompanyInventory(db: Db, companyId: string): Promise<StockLocation> {
  await db.stockLocation.createMany({ data: [{ companyId, code: TRANSIT_CODE, name: 'Goods in transit', kind: 'transit' }], skipDuplicates: true });
  const transit = await db.stockLocation.findUniqueOrThrow({ where: { companyId_code: { companyId, code: TRANSIT_CODE } } });
  await db.inventorySettings.createMany({ data: [{ companyId, transitLocationId: transit.id }], skipDuplicates: true });
  await db.numberSeries.createMany({
    data: Object.entries(STOCK_NUMBER_SERIES).map(([kind, pattern]) => ({ companyId, documentKind: seriesKind(kind), pattern, counterLength: 5 })),
    skipDuplicates: true,
  });
  return transit;
}

/** Idempotent, and safe at the same moment as above: folder + Shop floor + Back room + Rejected for a store. */
export async function ensureStoreLocations(db: Db, store: { id: string; companyId: string; code: string; name: string }): Promise<void> {
  await ensureCompanyInventory(db, store.companyId);
  const { companyId } = store;
  await db.stockLocation.createMany({ data: [{ companyId, storeId: store.id, code: store.code, name: store.name, kind: 'folder' }], skipDuplicates: true });
  const folder = await db.stockLocation.findUniqueOrThrow({ where: { companyId_code: { companyId, code: store.code } } });
  const children: [string, string, 'shelf' | 'rejected'][] = [
    ['FLOOR', 'Shop floor', 'shelf'],
    ['BACK', 'Back room', 'shelf'],
    ['REJECT', 'Rejected goods', 'rejected'],
  ];
  await db.stockLocation.createMany({
    data: children.map(([suffix, name, kind]) => ({ companyId, storeId: store.id, parentId: folder.id, code: `${store.code}-${suffix}`, name, kind })),
    skipDuplicates: true,
  });
}
