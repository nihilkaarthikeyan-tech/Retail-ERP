// Copyright (c) 2026, Rademics. All rights reserved.
// Speed test, step 1b (audit 8, 29 October 2026): seed.perf.ts trades through the real API, which
// takes hours per month of data. This step multiplies what it made, inside the database, to the
// audit's target size: about 50,000 items, 20,000 customers and 500,000 till bills over two years.
// Each copy of the seeded fortnight is moved back one more fortnight in time, with new ids
// and numbers, and its bill lines and stock movements spread over the copied items. Every bill
// keeps its own lines, payments, stock movements, shift and the shift's ledger entry, so lists,
// searches and reports touch the same number of rows as real use would. Stock running balances in
// the copies are not recomputed (speed only, not correctness). Run once, after seed.perf.ts:
//   pnpm perf:amplify
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { SystemPrisma } from '../src/prisma/prisma.service.js';
import { createTestApp } from '../test/helpers.js';

const TARGET_ITEMS = Number(process.env.PERF_TARGET_ITEMS ?? 50_000);
const TARGET_CUSTOMERS = Number(process.env.PERF_TARGET_CUSTOMERS ?? 20_000);
const TARGET_BILLS = Number(process.env.PERF_TARGET_BILLS ?? 500_000);
/** Days of the seeded period: each copy is moved back by this much more. */
const SPAN = Number(process.env.PERF_DAYS ?? 14);

let app: INestApplication<App>;
let prisma: SystemPrisma;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app?.close();
});

type Column = { name: string; type: string };
const columns = new Map<string, Column[]>();
async function cols(table: string): Promise<Column[]> {
  if (!columns.has(table)) {
    const rows = await prisma.$queryRaw<{ column_name: string; data_type: string; column_default: string | null }[]>`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`;
    // Serial ids (bigint with a sequence) are left to the database.
    columns.set(
      table,
      rows.filter((r) => !(r.column_name === 'id' && r.column_default?.startsWith('nextval'))).map((r) => ({ name: r.column_name, type: r.data_type })),
    );
  }
  return columns.get(table)!;
}

const q = (c: string) => `"${c}"`;
/** A new id for copy g of an id, the same wherever that id appears. */
const mapped = (expr: string, ns: string) => `CASE WHEN ${expr} IS NULL THEN NULL ELSE md5(${expr}::text || ':${ns}' || g)::uuid END`;
/** Copy g is moved back by g times the seeded period: one copy per fortnight. */
const back = `(${SPAN} * g)`;

/**
 * Inserts n copies of the rows of `table` matching `where` (only rows that existed before this
 * statement are read). `map` columns get the copy's id; with `shift`, every date and time column
 * is moved back; `set` overrides single columns (an SQL expression over s and g).
 */
async function clone(table: string, opts: { n: number; ns: string; where?: string; map?: string[]; shift?: boolean; set?: Record<string, string> }) {
  const list = await cols(table);
  const exprs = list.map(({ name, type }) => {
    if (opts.set?.[name] !== undefined) return opts.set[name];
    if (opts.map?.includes(name)) return mapped(`s.${q(name)}`, opts.ns);
    if (opts.shift && type === 'date') return `(s.${q(name)} - ${back})`;
    if (opts.shift && type.startsWith('timestamp')) return `(s.${q(name)} - ${back} * interval '1 day')`;
    return `s.${q(name)}`;
  });
  const sql = `INSERT INTO ${q(table)} (${list.map((c) => q(c.name)).join(', ')}) SELECT ${exprs.join(', ')} FROM ${q(table)} s CROSS JOIN generate_series(1, ${opts.n}) g${opts.where ? ` WHERE ${opts.where}` : ''}`;
  const t0 = performance.now();
  const rows = await prisma.$executeRawUnsafe(sql);
  console.log(`${table}: +${rows} rows in ${Math.round((performance.now() - t0) / 1000)} s`);
}

describe('multiply the seeded data to the audit size', () => {
  it('copies items, customers and two years of bills', async () => {
    const items = await prisma.item.count();
    const customers = await prisma.customer.count();
    const bills = await prisma.posBill.count();
    if (bills > TARGET_BILLS / 2) throw new Error(`Already ${bills} bills: this step runs once, on freshly seeded data`);
    const M = Math.max(0, Math.ceil(TARGET_ITEMS / items) - 1);
    const C = Math.max(0, Math.ceil(TARGET_CUSTOMERS / customers) - 1);
    const K = Math.max(0, Math.ceil(TARGET_BILLS / bills) - 1);
    console.log({ items, customers, bills, itemCopies: M, customerCopies: C, billCopies: K });
    // A copied bill line sells copy m of its item (m = 0: the item itself).
    const item = (itemExpr: string, keyExpr: string) => `CASE WHEN ${itemExpr} IS NULL THEN NULL WHEN (g + abs(hashtext(${keyExpr}::text))) % ${M + 1} = 0 THEN ${itemExpr} ELSE md5(${itemExpr}::text || ':i' || ((g + abs(hashtext(${keyExpr}::text))) % ${M + 1}))::uuid END`;

    // ---- Items (no dates moved) ----
    const ig = 'i';
    await clone('Item', { n: M, ns: ig, map: ['id', 'parentItemId'], set: { code: `s."code" || '-' || g`, name: `s."name" || ' ' || g`, image: 'NULL' } });
    await clone('Barcode', { n: M, ns: ig, map: ['id', 'itemId'], set: { code: `s."code" || lpad(g::text, 2, '0')` } });
    await clone('Price', { n: M, ns: ig, map: ['id', 'itemId'], where: 's."customerId" IS NULL AND s."supplierId" IS NULL AND s."batchId" IS NULL' });
    await clone('ItemUnit', { n: M, ns: ig, map: ['id', 'itemId'] });
    await clone('ItemVariantAttribute', { n: M, ns: ig, map: ['itemId'] });
    await clone('ItemVariantValue', { n: M, ns: ig, map: ['itemId'] });
    await clone('StockPosition', { n: M, ns: ig, map: ['itemId'] });

    // ---- Customers ----
    await clone('Customer', {
      n: C,
      ns: 'u',
      map: ['id'],
      where: 'NOT s."isWalkIn"',
      set: { code: `s."code" || '-' || g`, name: `s."name" || ' ' || g`, mobile: `'9' || lpad((abs(hashtext(s."id"::text || g)) % 1000000000)::text, 9, '0')`, gstin: 'NULL', offlineTillRef: 'NULL', linkedSupplierId: 'NULL' },
    });

    // ---- Financial years back to the oldest copied day ----
    const oldest = (await prisma.$queryRawUnsafe<{ d: Date }[]>(`SELECT (min("businessDate") - ${SPAN} * ${K})::date AS d FROM "PosBill"`))[0].d;
    for (let y = oldest.getUTCFullYear() - (oldest.getUTCMonth() < 3 ? 1 : 0); ; y++) {
      const start = new Date(Date.UTC(y, 3, 1));
      if (await prisma.financialYear.findFirst({ where: { startDate: start } })) break;
      const name = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "FinancialYear" ("id","companyId","name","startDate","endDate","isIrregular","status","createdAutomatically","createdAt","updatedAt") SELECT gen_random_uuid(), "companyId", '${name}', '${y}-04-01', '${y + 1}-03-31', false, 'open', false, now(), now() FROM "FinancialYear" LIMIT 1`,
      );
    }

    // ---- Two years of shifts and bills ----
    const ns = 'c';
    const closedShift = `s."shiftId" IN (SELECT id FROM "Shift" WHERE status <> 'open')`;
    await clone('Shift', { n: K, ns, map: ['id', 'clientId', 'ledgerEntryId'], shift: true, where: `s.status <> 'open'` });
    await clone('ShiftCash', { n: K, ns, map: ['shiftId'], where: closedShift });
    await clone('ShiftClosing', { n: K, ns, map: ['id', 'shiftId'], shift: true, where: closedShift });
    await clone('ShiftClosingLine', { n: K, ns, map: ['id', 'closingId'] });
    await clone('CashMovement', { n: K, ns, map: ['id', 'shiftId', 'clientId'], shift: true, where: closedShift });
    await clone('PosBill', {
      n: K,
      ns,
      map: ['id', 'shiftId', 'clientId', 'returnOfId', 'exchangeId'],
      shift: true,
      where: closedShift,
      set: { number: `s."number" || '/' || g`, gstPeriod: `to_char(s."businessDate" - ${back}, 'YYYY-MM')` },
    });
    const ofClosedBill = `s."billId" IN (SELECT b.id FROM "PosBill" b JOIN "Shift" sh ON sh.id = b."shiftId" WHERE sh.status <> 'open')`;
    await clone('PosBillLine', { n: K, ns, map: ['id', 'billId', 'returnOfLineId'], where: ofClosedBill, set: { itemId: item('s."itemId"', 's."id"') } });
    await clone('PosPayment', { n: K, ns, map: ['id', 'billId'], where: ofClosedBill });
    await clone('StockLedgerEntry', {
      n: K,
      ns,
      map: ['documentId', 'documentLineId'],
      shift: true,
      where: `s."documentType" = 'pos_bill' AND s."documentId" IN (SELECT b.id FROM "PosBill" b JOIN "Shift" sh ON sh.id = b."shiftId" WHERE sh.status <> 'open')`,
      set: { itemId: item('s."itemId"', 's."documentLineId"'), costSourceId: 'NULL', reversesId: 'NULL' },
    });
    const shiftEntries = `SELECT "ledgerEntryId" FROM "Shift" WHERE status <> 'open' AND "ledgerEntryId" IS NOT NULL`;
    await clone('LedgerEntry', {
      n: K,
      ns,
      map: ['id', 'documentId', 'cancelsId'],
      shift: true,
      where: `s.id IN (${shiftEntries})`,
      set: { financialYearId: `(SELECT fy.id FROM "FinancialYear" fy WHERE fy."companyId" = s."companyId" AND s."entryDate" - ${back} BETWEEN fy."startDate" AND fy."endDate" LIMIT 1)` },
    });
    await clone('LedgerLine', { n: K, ns, map: ['entryId'], shift: true, where: `s."entryId" IN (${shiftEntries})` });
    await clone('LoyaltyEntry', { n: K, ns, map: ['id', 'billId', 'sourceEntryId'], shift: true, where: ofClosedBill });
    // The change history grows with the bills.
    await clone('AuditLog', { n: K, ns, shift: true, where: `s."entityType" IN ('pos_bill', 'shift', 'till_cashier', 'pos_approval')` });

    const t0 = performance.now();
    await prisma.$executeRawUnsafe('ANALYZE');
    console.log(`ANALYZE in ${Math.round((performance.now() - t0) / 1000)} s`);
    const size = await prisma.$queryRawUnsafe<{ size: string }[]>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);
    console.log({ items: await prisma.item.count(), customers: await prisma.customer.count(), bills: await prisma.posBill.count(), billLines: await prisma.posBillLine.count(), stockLedger: await prisma.stockLedgerEntry.count(), ledgerLines: await prisma.ledgerLine.count(), auditRows: await prisma.auditLog.count(), size: size[0].size });
  });
});
