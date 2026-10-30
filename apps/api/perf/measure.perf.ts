// Copyright (c) 2026, Rademics. All rights reserved.
// Speed test, step 2 (docs/performance-test.md): on the year of data made by
// seed.perf.ts, times what staff do every day — till look-ups and bills, stock
// and bill screens, every report and dashboard — and writes the results to
// perf/out/measure.json.
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, shortFinancialYear } from 'shared';
import { vi } from 'vitest';
import { SystemPrisma } from '../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER } from '../test/helpers.js';

const START = process.env.PERF_START ?? '2025-10-01';
const DAYS = Number(process.env.PERF_DAYS ?? 365);
const END = addDays(START, DAYS - 1);
const MONTH_FROM = `${END.slice(0, 7)}-01`;
const OUT = new URL('./out/', import.meta.url);
const RUNS = 3;

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
const results: { area: string; what: string; status: number; ms: number[]; kb: number; rows?: number }[] = [];

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

async function time(area: string, what: string, path: string, runs = RUNS, headers: Record<string, string> = {}) {
  // Audit 8: written before each request, so a crash shows which one it was.
  mkdirSync(OUT, { recursive: true });
  appendFileSync(new URL('progress.log', OUT), `${new Date().toISOString()} start ${what} ${path}
`);
  const ms: number[] = [];
  let status = 0;
  let kb = 0;
  let rows: number | undefined;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    // Audit 8: the all-data download of a large shop is over the test client's 200 MB default.
    const res = await owner.get(path).set(headers).maxResponseSize(4_000_000_000).buffer(true);
    ms.push(performance.now() - t0);
    status = res.status;
    kb = Math.round((Number(res.headers['content-length']) || JSON.stringify(res.body ?? '').length) / 1024);
    const b = res.body as unknown;
    rows = Array.isArray(b) ? b.length : Array.isArray((b as { rows?: unknown[] })?.rows) ? (b as { rows: unknown[] }).rows.length : Array.isArray((b as { items?: unknown[] })?.items) ? (b as { items: unknown[] }).items.length : undefined;
    if (status >= 300) break;
  }
  results.push({ area, what, status, ms: ms.map(Math.round), kb, rows });
  appendFileSync(new URL('progress.log', OUT), `${area} | ${what} | ${status} | ${ms.map(Math.round).join(' ')} ms
`);
  console.log(`${area} | ${what} | ${status} | median ${Math.round(median(ms))} ms | ${kb} KB${rows !== undefined ? ` | ${rows} rows` : ''}`);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${END}T21:30:00+05:30`));
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await login(app, OWNER.email, OWNER.password);
});

afterAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const db = await prisma.$queryRawUnsafe<{ size: string }[]>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);
  const counts = {
    items: await prisma.item.count(),
    bills: await prisma.posBill.count(),
    billLines: await prisma.posBillLine.count(),
    stockLedger: await prisma.stockLedgerEntry.count(),
    ledgerLines: await prisma.ledgerLine.count(),
    auditRows: await prisma.auditLog.count(),
    databaseSize: db[0].size,
  };
  writeFileSync(new URL('measure.json', OUT), JSON.stringify({ counts, results }, null, 2));
  await app?.close();
  vi.useRealTimers();
});

describe('speed on a year of data', () => {
  it('back office screens, reports and dashboards', async () => {
    const main = await prisma.store.findFirstOrThrow({ where: { code: 'MAIN' } });
    const item = (await prisma.posBillLine.groupBy({ by: ['itemId'], _count: true, orderBy: { _count: { itemId: 'desc' } }, take: 1 }))[0].itemId;
    const barcode = (await prisma.barcode.findFirstOrThrow({ where: { itemId: item } })).code;
    const salesAccount = (await prisma.account.findFirstOrThrow({ where: { systemKey: 'sales' } })).id;
    const supplier = (await prisma.supplier.findFirstOrThrow()).id;
    const someBill = (await prisma.posBill.findFirstOrThrow({ orderBy: { soldAt: 'desc' } })).number;
    const s = `storeId=${main.id}`;
    const day = `from=${END}&to=${END}`;
    const month = `from=${MONTH_FROM}&to=${END}`;
    const year = `from=${START}&to=${END}`;

    // Screens staff open many times a day.
    await time('screen', 'item list, first page', '/items?page=1&pageSize=50');
    await time('screen', 'item search "shirt"', '/items?search=shirt&pageSize=50');
    await time('screen', 'scan a barcode (back office)', `/catalogue/scan/${barcode}`);
    await time('screen', 'stock lookup of one item', `/stock/lookup/${barcode}`);
    await time('screen', 'stock balance of a shop', `/stock/balance?${s}`);
    await time('screen', 'stock history of a best seller', `/stock/ledger?itemId=${item}&limit=200`);
    await time('screen', "today's bills of a shop", `/pos/bills?${s}&${day}&pageSize=50`);
    await time('screen', 'find a bill by number', `/pos/bills?search=${encodeURIComponent(someBill)}`);
    await time('screen', 'customer search', '/customers?search=Customer%2012');
    await time('screen', 'supplier bills list', '/purchase/bills');
    await time('screen', 'negative stock list', '/stock/exceptions/negative');

    // Dashboards.
    await time('dashboard', 'store dashboard', `/dashboards/store?${s}`);
    await time('dashboard', 'owner dashboard', '/dashboards/owner');
    await time('dashboard', 'purchasing dashboard', '/dashboards/purchasing');
    await time('dashboard', 'accounts dashboard', '/dashboards/accounts');

    // Sales and stock reports, for a day, a month and the whole year.
    for (const [label, range] of [['day', day], ['month', month], ['year', year]] as const) {
      await time(`report (${label})`, 'daily sales', `/reports/daily-sales?${range}`);
      await time(`report (${label})`, 'item-wise sales', `/reports/item-sales?${range}&groupBy=item&limit=1000`);
      await time(`report (${label})`, 'sales by group', `/reports/sales-by-group?${range}`);
      await time(`report (${label})`, 'best sellers', `/reports/best-sellers?${range}&limit=100`);
      await time(`report (${label})`, 'gross profit', `/reports/gross-profit?${range}&groupBy=item&limit=1000`);
      await time(`report (${label})`, 'returns', `/reports/returns?${range}`);
      await time(`report (${label})`, 'discounts', `/reports/discounts?${range}`);
      await time(`report (${label})`, 'stock movement', `/reports/stock-movement?${range}`);
      await time(`report (${label})`, 'till register', `/pos/reports/register?${range}`);
      await time(`report (${label})`, 'payments by method', `/pos/reports/payments?${range}`);
      await time(`report (${label})`, 'hourly sales', `/pos/reports/hourly?${range}`);
      await time(`report (${label})`, 'sales by cashier', `/pos/reports/by-cashier?${range}`);
      await time(`report (${label})`, 'shifts', `/pos/reports/shifts?${range}`);
      await time(`report (${label})`, 'purchase register', `/purchase/reports/register?${range}`);
      await time(`report (${label})`, 'day book', `/reports/day-book?${range}`);
      await time(`report (${label})`, 'general ledger: sales account', `/reports/general-ledger?${range}&accountId=${salesAccount}`);
      await time(`report (${label})`, 'profit and loss', `/reports/profit-and-loss?${range}`);
      await time(`report (${label})`, 'cash flow', `/reports/cash-flow?${range}`);
      await time(`report (${label})`, 'shrinkage', `/reports/shrinkage?${range}`);
    }
    await time('report', 'stock cover (30 days)', '/reports/stock-cover?days=30');
    await time('report', 'stock age', `/reports/stock-age?asOf=${END}`);
    await time('report', 'cash position', '/reports/cash-position');
    await time('report', 'trial balance', `/reports/trial-balance?asOf=${END}`);
    await time('report', 'balance sheet', `/reports/balance-sheet?asOf=${END}`);
    await time('report', 'ageing (suppliers)', `/reports/ageing?asOf=${END}&partyType=supplier`);
    await time('report', 'supplier statement', `/reports/party-statement/supplier/${supplier}?${year}`);
    await time('report', 'stock against accounts', '/reports/stock-vs-accounts');
    await time('report', 'book health', '/reports/book-health');
    // Audit 8: the places the code review expected to be slowest at this size.
    const walkIn = (await prisma.customer.findFirst({ where: { isWalkIn: true } }))?.id;
    const someCustomer = await prisma.customer.findFirstOrThrow({ where: { isWalkIn: false, mobile: { not: null } } });
    await time('audit 8', 'stock balance as on a past date', `/stock/balance?${s}&asOf=${addDays(END, -60)}`);
    await time('audit 8', 'stock history of a shop (no item)', `/stock/ledger?${s}&limit=200`);
    await time('audit 8', 'ageing (customers)', `/reports/ageing?asOf=${END}&partyType=customer`);
    await time('audit 8', 'till: find a bill to return by part of its number', `/pos/bills?search=${encodeURIComponent(someBill.slice(-5))}&kind=sale`);
    await time('audit 8', 'GSTR-1 for the last month', `/reports/gst/gstr1?period=${END.slice(0, 7)}`);
    await time('audit 8', 'GSTR-3B for the last month', `/reports/gst/gstr3b?period=${END.slice(0, 7)}`);
    await time('audit 8', 'till payments report with no dates', '/pos/reports/payments');
    if (walkIn) await time('audit 8', 'purchase history of the walk-in customer', `/customers/${walkIn}/purchases`);
    await time('audit 8', 'customer search by part of a mobile number', `/customers?search=${someCustomer.mobile!.slice(-6)}`);
    await time('audit 8', 'item search by part of a name', '/items?search=ear&pageSize=50');
    await time('audit 8', 'change history, first page', '/audit?limit=50');
    await time('audit 8', 'reorder levels of a shop', `/stock/reorder-levels?${s}`);
    await time('check', 'stock consistency check (whole database)', '/stock/consistency', 1);
    await time('export', 'download all my data (zip)', '/data-export', 1);
    // The test runs the API in this process: its memory after the biggest jobs (MB, in the ms column).
    results.push({ area: 'memory', what: 'API memory after the reports and the download (MB)', status: 200, ms: [Math.round(process.memoryUsage().rss / 1048576)], kb: 0 });
    await time('export', 'export all items to Excel', '/exports/items', 1);
  });

  it('the till: download, scan and bills on a full database', async () => {
    const date = addDays(END, 1);
    vi.setSystemTime(new Date(`${date}T09:45:00+05:30`));
    owner = await login(app, OWNER.email, OWNER.password);
    const tills = await prisma.till.findMany({ orderBy: { code: 'asc' } });
    const cash = (await prisma.paymentMethod.findFirstOrThrow({ where: { code: 'CASH' } })).id;
    const fy = (await prisma.financialYear.findFirstOrThrow({ where: { startDate: { lte: new Date(`${date}T00:00:00Z`) }, endDate: { gte: new Date(`${date}T00:00:00Z`) } } })).name;
    // Audit 8: items made by the API (the copies made by amplify.perf.ts have ids the bill form does not accept).
    const popular = (await prisma.posBillLine.groupBy({ by: ['itemId'], _count: true, orderBy: { _count: { itemId: 'desc' } }, take: 3000 })).map((r) => r.itemId).filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)).slice(0, 300);
    const sellList = (await prisma.catalogueSettings.findFirstOrThrow()).defaultSellingPriceListId!;
    const prices = new Map((await prisma.price.findMany({ where: { priceListId: sellList, itemId: { in: popular } } })).map((p) => [p.itemId, Number(p.price)]));

    // Each till gets a fresh device token and an open shift.
    const open: { till: (typeof tills)[number]; token: string; shift: string; n: number }[] = [];
    for (const till of tills) {
      const token = (await owner.post(`/pos/tills/${till.id}/register`).send({ deviceName: `${till.code} speed test` })).body.token as string;
      // A shift left open by an earlier run is carried on (one open shift per till).
      const left = await prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
      const shift = left?.clientId ?? randomUUID();
      if (!left) {
        const opened = await owner.post('/pos/shifts').set('x-till-token', token).send({ clientId: shift, tillId: till.id, cash: [{ paymentMethodId: cash, amount: '2000' }] });
        if (opened.status !== 201) throw new Error(`shift refused: ${JSON.stringify(opened.body).slice(0, 300)}`);
      }
      // The till's own series only (copies made by amplify.perf.ts carry an extra /n).
      const last = (await prisma.$queryRaw<{ n: string | null }[]>`SELECT max(number) AS n FROM "PosBill" WHERE "tillId" = ${till.id}::uuid AND number ~ ${`^${till.seriesKind}/${shortFinancialYear(fy)}/[0-9]{6}$`}`)[0].n;
      open.push({ till, token, shift, n: last ? Number(last.slice(-6)) : 0 });
    }
    const t = open[0];
    await time('till', 'download item list for offline use (start of day)', `/pos/till/${t.till.id}/snapshot`, 2, { 'x-till-token': t.token });
    const codes = (await prisma.barcode.findMany({ where: { itemId: { in: popular.slice(0, 20) } }, select: { code: true } })).map((b) => b.code);
    const scan: number[] = [];
    for (const c of codes) {
      const t0 = performance.now();
      await owner.get(`/catalogue/scan/${c}`);
      scan.push(performance.now() - t0);
    }
    results.push({ area: 'till', what: 'scan a barcode (20 scans)', status: 200, ms: scan.map(Math.round), kb: 0 });

    const bill = (o: (typeof open)[number], k: number) => {
      const lines = Array.from({ length: 3 }, (_, i) => popular[(k * 7 + i * 13) % popular.length]).filter((id, i, a) => a.indexOf(id) === i && prices.has(id));
      const total = lines.reduce((sum, id) => sum + prices.get(id)!, 0);
      o.n++;
      return {
        clientId: randomUUID(),
        tillId: o.till.id,
        shiftClientId: o.shift,
        soldAt: new Date().toISOString(),
        sale: { number: `${o.till.seriesKind}/${shortFinancialYear(fy)}/${String(o.n).padStart(6, '0')}`, lines: lines.map((itemId, i) => ({ lineNo: i + 1, itemId, quantity: '1' })) },
        payments: [{ paymentMethodId: cash, amount: String(total) }],
      };
    };
    const post = async (o: (typeof open)[number], k: number) => {
      const t0 = performance.now();
      const res = await owner.post('/pos/bills').set('x-till-token', o.token).send(bill(o, k));
      if (res.status !== 201) throw new Error(`bill refused: ${JSON.stringify(res.body).slice(0, 300)}`);
      return performance.now() - t0;
    };
    vi.setSystemTime(new Date(`${date}T11:00:00+05:30`));
    // Sign-ins end after 30 idle minutes (audit 1): the clock jumped, so sign in again as staff would.
    owner = await login(app, OWNER.email, OWNER.password);
    const alone: number[] = [];
    for (let k = 0; k < 40; k++) alone.push(await post(t, k));
    results.push({ area: 'till', what: 'save a 3-item bill, one till busy', status: 201, ms: alone.map(Math.round), kb: 0 });
    const together: number[] = [];
    for (let round = 0; round < 15; round++) together.push(...(await Promise.all(open.map((o, i) => post(o, 100 + round * 10 + i)))));
    results.push({ area: 'till', what: `save a 3-item bill, all ${open.length} tills at the same moment`, status: 201, ms: together.map(Math.round), kb: 0 });

    vi.setSystemTime(new Date(`${date}T21:15:00+05:30`));
    owner = await login(app, OWNER.email, OWNER.password);
    const close: number[] = [];
    for (const o of open) {
      const shift = await prisma.shift.findUniqueOrThrow({ where: { tillId_clientId: { tillId: o.till.id, clientId: o.shift } } });
      const bills = await prisma.posBill.findMany({ where: { shiftId: shift.id }, select: { total: true } });
      let left = 2000 + Math.round(bills.reduce((sum, b) => sum + Number(b.total), 0));
      const denominations: Record<string, number> = {};
      for (const d of [500, 200, 100, 50, 20, 10, 5, 2, 1]) {
        if (left >= d) denominations[String(d)] = Math.floor(left / d);
        left %= d;
      }
      const t0 = performance.now();
      const res = await owner.post(`/pos/shifts/${shift.id}/close`).set('x-till-token', o.token).send({ denominations });
      if (res.status !== 200) throw new Error(`close refused: ${JSON.stringify(res.body).slice(0, 300)}`);
      close.push(performance.now() - t0);
    }
    results.push({ area: 'till', what: 'close a shift (posts it to the accounts)', status: 200, ms: close.map(Math.round), kb: 0 });
    for (const r of results.slice(-4)) console.log(`${r.area} | ${r.what} | median ${median(r.ms)} ms | max ${Math.max(...r.ms)} ms`);
  });
});
