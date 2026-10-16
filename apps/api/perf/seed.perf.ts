// Copyright (c) 2026, Rademics. All rights reserved.
// Speed test, step 1 (docs/performance-test.md): fills retail_erp_perf with a
// year of trading for three shops — about 20,000 items, daily till shifts and
// bills with returns and exchanges, weekly restocking from suppliers, weekly
// transfers, quarterly counts, monthly supplier payments and expenses.
// Everything goes through the real API, with a simulated clock, so the data
// has exactly the shape real use would give it. Never point it at real data.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, DENOMINATIONS } from 'shared';
import { vi } from 'vitest';
import { writeXlsx, type Sheet } from '../src/imports/spreadsheet.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER, resetDatabase, SETUP_INPUT } from '../test/helpers.js';

const START = process.env.PERF_START ?? '2025-10-01';
const DAYS = Number(process.env.PERF_DAYS ?? 365);
/** Bills per shop on an ordinary weekday, before seasons and weekends. */
const BASE_BILLS = Number(process.env.PERF_BILLS ?? 110);
const STYLES = Number(process.env.PERF_STYLES ?? 1500);
const FANCY_ITEMS = Number(process.env.PERF_FANCY ?? 8000);
const CUSTOMERS = Number(process.env.PERF_CUSTOMERS ?? 3000);
const OUT = new URL('./out/', import.meta.url);

// ---- Simulated clock, random numbers, timings ----

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const setClock = (date: string, hhmm: string) => vi.setSystemTime(at(date, hhmm));
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;

let seed = 20261016;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

const timings: Record<string, number[]> = {};
const notes: Record<string, string | number> = {};
const failures: Record<string, { count: number; samples: string[] }> = {};
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    (timings[name] ??= []).push(performance.now() - t0);
  }
}
function fail(name: string, err: unknown) {
  const f = (failures[name] ??= { count: 0, samples: [] });
  f.count++;
  if (f.samples.length < 8) f.samples.push(String(err instanceof Error ? err.message : err).slice(0, 400));
}
function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : 0);
  return { count: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1] ?? 0) };
}
function save() {
  mkdirSync(OUT, { recursive: true });
  const summary = Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, stats(v)]));
  writeFileSync(new URL('seed-stats.json', OUT), JSON.stringify({ notes, timings: summary, failures }, null, 2));
}

// ---- API calls ----

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;

let relogin: Promise<Agent> | null = null;

/** The simulated clock jumps hours at a time, so an idle session ends; log in again, as staff would. */
async function api(method: 'get' | 'post', path: string, body?: unknown, headers: Record<string, string> = {}, retry = true): Promise<any> {
  let r = owner[method](path);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  const res = await (body === undefined ? r : r.send(body as object));
  if (res.status === 401 && retry) {
    relogin ??= login(app, OWNER.email, OWNER.password).finally(() => setTimeout(() => (relogin = null), 0));
    owner = await relogin;
    return api(method, path, body, headers, false);
  }
  if (res.status >= 300) throw new Error(`${method.toUpperCase()} ${path} → ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body;
}

/** Runs `fn` over `list`, `width` at a time. */
async function inParallel<T>(list: T[], width: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < list.length) {
        const i = next++;
        await fn(list[i], i);
      }
    }),
  );
}

async function importSheet(kind: string, rows: Sheet, textColumns: number[]) {
  const file = writeXlsx('Import', rows, { textColumns });
  const t0 = performance.now();
  const preview = (await owner.post('/imports/preview').attach('file', file, `${kind}.xlsx`).field('options', JSON.stringify({ kind, mode: 'add' }))).body;
  if (!preview.jobId) throw new Error(`Import preview failed: ${JSON.stringify(preview).slice(0, 400)}`);
  const previewMs = performance.now() - t0;
  await api('post', `/imports/${preview.jobId}/run`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await api('get', `/imports/${preview.jobId}`);
    if (s.status !== 'running') {
      const totalMs = performance.now() - t0;
      notes[`import ${kind} (${rows.length - 1} rows)`] = `preview ${(previewMs / 1000).toFixed(1)} s, total ${(totalMs / 1000).toFixed(1)} s, status ${s.status}, ${JSON.stringify(s.counts ?? s.summary ?? {})}`;
      return s;
    }
  }
}

function ean13(n12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(n12[i]) * (i % 2 ? 3 : 1);
  return n12 + ((10 - (sum % 10)) % 10);
}
let barcodeSeq = 100000000;
const nextBarcode = () => ean13(`890${barcodeSeq++}`);

// ---- The shops ----

interface Sellable {
  id: string;
  code: string;
  price: number;
  cost: number;
  supplier: number;
}
interface Till {
  id: string;
  code: string;
  store: number;
  token: string;
  prefix: string;
  counters: Record<string, number>;
  shiftId: string;
  shiftClientId: string;
  recent: { billId: string; lines: { id: string; itemId: string; price: number }[] }[];
}

const STORES = [
  { code: 'MAIN', name: 'Main Store', weight: 1.2 },
  { code: 'TNAGAR', name: 'T. Nagar', weight: 0.9 },
  { code: 'ANNA', name: 'Anna Nagar', weight: 0.9 },
];
const CLOTHING = [
  ['MSHIRT', 'Men shirts', '6205', 'Shirt', 899],
  ['MTROUSER', 'Men trousers', '6203', 'Trousers', 1299],
  ['MTSHIRT', 'Men T-shirts', '6109', 'T-shirt', 499],
  ['WKURTI', 'Women kurtis', '6204', 'Kurti', 799],
  ['WTOP', 'Women tops', '6206', 'Top', 599],
  ['KIDS', 'Kids wear', '6111', 'Kids set', 449],
  ['FOOT', 'Footwear', '6404', 'Sandal', 699],
] as const;
const FANCY = [
  ['JEWEL', 'Fashion jewellery', '7117', 'Earrings', 149],
  ['COSM', 'Cosmetics', '3304', 'Lipstick', 199],
  ['TOYS', 'Toys', '9503', 'Toy car', 299],
  ['BAGS', 'Bags and wallets', '4202', 'Handbag', 549],
  ['GIFT', 'Gift articles', '9505', 'Gift box', 249],
  ['STAT', 'Stationery', '4820', 'Notebook', 59],
  ['DECOR', 'Home decor', '6913', 'Showpiece', 349],
  ['HAIR', 'Hair accessories', '9615', 'Hair clip', 39],
] as const;
const SIZES = ['S', 'M', 'L', 'XL'];
const COLOURS = ['Red', 'Blue', 'Black', 'White', 'Green', 'Yellow', 'Pink', 'Grey'];
const COLOUR_CODES = ['RED', 'BLU', 'BLK', 'WHT', 'GRN', 'YLW', 'PNK', 'GRY'];
const BRANDS = Array.from({ length: 30 }, (_, i) => `BR${String(i + 1).padStart(2, '0')}`);

const stores: { id: string; code: string; floor: string; weight: number }[] = [];
const tills: Till[] = [];
const sellables: Sellable[] = [];
let popularity: number[] = [];
const customerIds: string[] = [];
const supplierIds: string[] = [];
const pm: Record<string, string> = {};
let bankAccountId = '';
const expenseAccounts: Record<string, string> = {};
const supplierBills: { supplierId: string; total: number; date: string; paid: boolean }[] = [];
let supplierBillNo = 0;
let setUpDone = false;
/** PERF_RESUME=1: carry on after the last day already in the database (the run was stopped). */
let firstDay = 0;

const fyName = (date: string) => (date >= '2026-04-01' ? '2026-27' : '2025-26');

/** Popular items sell far more often than the rest, like a real shop. */
function popularItem(): Sellable {
  return sellables[popularity[Math.floor(popularity.length * rnd() ** 2.6)]];
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock(addDays(START, -12), '10:00');
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  save();
  await app?.close();
  vi.useRealTimers();
});

describe('a year of trading for three shops', () => {
  it('sets up the company, shops, tills, items, customers and opening stock', async () => {
    if (process.env.PERF_RESUME && (await prisma.posBill.count()) > 0) {
      await resume();
      setUpDone = true;
      return;
    }
    await resetDatabase(prisma);
    await request(app.getHttpServer())
      .post('/setup')
      .send({ ...SETUP_INPUT, financialYear: { startDate: '2025-04-01', endDate: '2026-03-31' } })
      .expect(201);
    owner = await login(app, OWNER.email, OWNER.password);
    await api('post', '/financial-years', { startDate: '2026-04-01', endDate: '2027-03-31' });
    for (const s of STORES.slice(1)) await api('post', '/stores', { code: s.code, name: s.name, stateCode: '33', city: 'Chennai' });
    const locations = (await api('get', '/stock/locations')) as { code: string; id: string }[];
    for (const s of STORES) {
      const row = await prisma.store.findFirstOrThrow({ where: { code: s.code } });
      stores.push({ id: row.id, code: s.code, floor: locations.find((l) => l.code === `${s.code}-FLOOR`)!.id, weight: s.weight });
    }

    // Groups, brands, test GST rates (module 8 replaces these with approved ones).
    const groupIds: Record<string, string> = {};
    for (const [code, name, hsn] of [...CLOTHING, ...FANCY]) {
      groupIds[code] = (await api('post', '/catalogue/item-groups', { code, name })).id;
      await api('post', '/pos/gst-rates', { hsnCode: hsn, rate: code === 'STAT' ? '12' : CLOTHING.some((c) => c[0] === code) ? '5' : '18', effectiveFrom: '2025-04-01' });
    }
    const brandIds: string[] = [];
    for (const b of BRANDS) brandIds.push((await api('post', '/catalogue/brands', { code: b, name: `Brand ${b}` })).id);
    const size = await api('post', '/catalogue/attributes', { code: 'SIZE', name: 'Size', kind: 'list', values: SIZES.map((v) => ({ value: v, shortCode: v })) });
    const colour = await api('post', '/catalogue/attributes', { code: 'COLOUR', name: 'Colour', kind: 'list', values: COLOURS.map((v, i) => ({ value: v, shortCode: COLOUR_CODES[i] })) });
    const pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
    const sellList = (await prisma.catalogueSettings.findFirstOrThrow()).defaultSellingPriceListId!;
    const groups = await prisma.supplierGroup.findMany();
    const terms = await prisma.paymentTerms.findMany();
    for (let i = 0; i < 15; i++) {
      supplierIds.push((await api('post', '/suppliers', { name: `Supplier ${i + 1} Traders`, supplierGroupId: groups[0].id, paymentTermsId: terms.find((t) => t.code === 'NET30')!.id })).id);
    }

    // Clothing: styles in sizes and colours, each variant with its own barcode and price.
    const t0 = performance.now();
    await inParallel(
      Array.from({ length: STYLES }, (_, i) => i),
      4,
      async (i) => {
        const [code, , hsn, noun, base] = CLOTHING[i % CLOTHING.length];
        const price = Math.round((base * (0.7 + rnd() * 0.9)) / 10) * 10 - 1;
        const style = await timed('create style', () =>
          api('post', '/items', { name: `${noun} style ${i + 1}`, itemGroupId: groupIds[code], brandId: pick(brandIds), baseUnitId: pcs, hsnCode: hsn, mrp: String(price), variantAttributeIds: [size.id, colour.id] }),
        );
        const colours = [COLOURS[i % 8], COLOURS[(i + 3) % 8]];
        await timed('create variants', () => api('post', `/items/${style.id}/variants`, { values: { [size.id]: SIZES, [colour.id]: colours } }));
        const variants = await prisma.item.findMany({ where: { parentItemId: style.id }, select: { id: true, code: true } });
        for (const v of variants) {
          await timed('add barcode', () => api('post', `/items/${v.id}/barcodes`, { code: nextBarcode() }));
          await timed('add price', () => api('post', '/prices', { priceListId: sellList, itemId: v.id, price: String(price), startDate: '2025-04-01' }));
          sellables.push({ id: v.id, code: v.code, price, cost: Math.round(price * 0.52 * 100) / 100, supplier: i % 8 });
        }
        if (i % 250 === 249) console.log(`styles ${i + 1}/${STYLES}`);
      },
    );
    notes[`create ${STYLES} styles with ${sellables.length} variants`] = `${((performance.now() - t0) / 1000).toFixed(0)} s`;

    // Fancy items from an Excel sheet, as a shop would load them at go-live.
    const fancyRows: Sheet = [['Item name', 'Item group code', 'Brand code', 'Unit', 'HSN code', 'MRP', 'Selling price', 'Barcode']];
    const fancyPrice = new Map<string, number>();
    for (let i = 0; i < FANCY_ITEMS; i++) {
      const [code, , hsn, noun, base] = FANCY[i % FANCY.length];
      const price = Math.max(10, Math.round((base * (0.5 + rnd() * 1.2)) / 5) * 5);
      const barcode = nextBarcode();
      fancyPrice.set(barcode, price);
      fancyRows.push([`${noun} design ${i + 1}`, code, pick(BRANDS), 'PCS', hsn, price, price, barcode]);
    }
    await importSheet('items', fancyRows, [1, 2, 3, 4, 7]);
    const fancy = await prisma.barcode.findMany({ where: { code: { in: [...fancyPrice.keys()] } }, select: { code: true, item: { select: { id: true, code: true } } } });
    for (const b of fancy) {
      const price = fancyPrice.get(b.code)!;
      sellables.push({ id: b.item.id, code: b.item.code, price, cost: Math.round(price * 0.48 * 100) / 100, supplier: 8 + (sellables.length % 7) });
    }
    notes['sellable items'] = sellables.length;
    popularity = sellables.map((_, i) => i).sort(() => rnd() - 0.5);

    // Customers from an Excel sheet.
    const customerRows: Sheet = [['Name', 'Mobile']];
    for (let i = 0; i < CUSTOMERS; i++) customerRows.push([`Customer ${i + 1}`, String(9000000000 + i * 7)]);
    await importSheet('customers', customerRows, [1]);
    customerIds.push(...(await prisma.customer.findMany({ where: { isWalkIn: false }, select: { id: true } })).map((c) => c.id));

    // Opening stock per shop from Excel, then the draft opening counts are finalised.
    // Each shop loads its whole catalogue in one sheet, as a shop would at go-live;
    // if that count cannot be finalised, it is cancelled and loaded in smaller sheets.
    const CHUNK = 1500;
    for (const s of stores) {
      const rowsFor = (items: Sellable[]): Sheet => [['Store code', 'Location code', 'Item code', 'Quantity', 'Cost per unit'], ...items.map((it) => [s.code, `${s.code}-FLOOR`, it.code, it.supplier < 8 ? 8 : 15, it.cost])];
      const finaliseDrafts = async (label: string) => {
        const drafts = await prisma.stockDocument.findMany({ where: { storeId: s.id, status: 'draft' }, select: { id: true } });
        for (const d of drafts) {
          const t0 = performance.now();
          try {
            await timed(label, () => api('post', `/stock/documents/${d.id}/finalise`));
          } catch (err) {
            notes[`${label} failed`] = `after ${((performance.now() - t0) / 1000).toFixed(0)} s: ${String(err).slice(0, 300)}`;
            await api('post', `/stock/documents/${d.id}/cancel`, { reason: 'Too big to finalise in one go' }).catch((e) => fail('cancel opening count', e));
            return false;
          }
        }
        return true;
      };
      await importSheet('opening_stock', rowsFor(sellables), [0, 1, 2]);
      if (await finaliseDrafts(`finalise one opening count of ${sellables.length} lines`)) continue;
      for (let i = 0; i < sellables.length; i += CHUNK) {
        await importSheet('opening_stock', rowsFor(sellables.slice(i, i + CHUNK)), [0, 1, 2]);
        await finaliseDrafts(`finalise opening count of up to ${CHUNK} lines`);
      }
    }
    notes['opening stock rows'] = await prisma.stockPosition.count();

    // Tills: two per shop.
    const methods = (await api('get', '/pos/payment-methods')) as { code: string; id: string }[];
    for (const m of methods) pm[m.code] = m.id;
    for (const [si, s] of stores.entries()) {
      for (const code of [`T${si * 2 + 1}`, `T${si * 2 + 2}`]) {
        const till = await api('post', '/pos/tills', { storeId: s.id, code, name: `${s.code} counter ${code}`, locationId: s.floor, priceListId: sellList, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }, { paymentMethodId: pm.UPI }] });
        const token = (await api('post', `/pos/tills/${till.id}/register`, { deviceName: `${s.code} ${code} PC` })).token;
        const row = await prisma.till.findUniqueOrThrow({ where: { id: till.id } });
        tills.push({ id: till.id, code: `${s.code}-${code}`, store: si, token, prefix: row.seriesKind, counters: {}, shiftId: '', shiftClientId: '', recent: [] });
      }
    }

    // A bank account for supplier payments and expenses.
    await api('get', '/accounts');
    const bankGroup = await prisma.account.findFirstOrThrow({ where: { systemKey: 'bank_group' } });
    const bank = await api('post', '/accounts', { parentId: bankGroup.id, name: 'HDFC current account', kind: 'bank' });
    await api('post', '/bank-accounts', { accountId: bank.id, bankName: 'HDFC Bank', accountNumber: '50200012345678', ifsc: 'HDFC0001234', isDefault: true });
    bankAccountId = bank.id;
    for (const key of ['rent', 'salaries', 'electricity']) expenseAccounts[key] = (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
    setUpDone = true;
    save();
  });

  it('trades for a year', async () => {
    if (!setUpDone) throw new Error('Set-up failed; see above');
    for (let day = firstDay; day < DAYS; day++) {
      const date = addDays(START, day);
      const weekday = at(date, '12:00').getUTCDay();
      setClock(date, '08:30');
      owner = await login(app, OWNER.email, OWNER.password);

      if (weekday === 1) await restock(date);
      if (date.endsWith('-15') && ['01', '04', '07', '10'].includes(date.slice(5, 7))) await countStock(date);

      setClock(date, '09:45');
      await Promise.all(tills.map((t) => openShift(t, date)));
      await tradeDay(date, weekday);
      setClock(date, '21:15');
      await Promise.all(tills.map((t) => closeShift(t)));

      if (weekday === 3) {
        setClock(date, '21:40');
        await transfer(date);
      }
      if (date.endsWith('-01')) {
        setClock(date, '22:00');
        await monthEnd(date);
      }
      if (day % 7 === 6) {
        const b = stats((timings['post bill'] ?? []).slice(-3000));
        console.log(`${date}: ${timings['post bill']?.length ?? 0} bills so far; last 3000 p50 ${b.p50} ms, p95 ${b.p95} ms; failures ${JSON.stringify(Object.fromEntries(Object.entries(failures).map(([k, v]) => [k, v.count])))}`);
      }
      if (day % 30 === 29) save();
    }
    notes['days traded'] = DAYS;
    notes['bills saved'] = await prisma.posBill.count();
    notes['bill lines saved'] = await prisma.posBillLine.count();
    notes['stock ledger rows'] = await prisma.stockLedgerEntry.count();
    notes['ledger lines'] = await prisma.ledgerLine.count();
    notes['audit rows'] = await prisma.auditLog.count();
    save();
  });
});

// ---- One day ----

function billsToday(date: string, weekday: number, store: number): number {
  const md = date.slice(5);
  let f = weekday === 0 || weekday === 6 ? 1.4 : 1;
  if (md >= '10-10' && md <= '11-05') f *= 1.9; // Deepavali
  if (md >= '01-10' && md <= '01-16') f *= 1.5; // Pongal
  if (md >= '07-01' && md <= '07-31') f *= 0.85;
  return Math.round(BASE_BILLS * STORES[store].weight * f * (0.85 + rnd() * 0.3));
}

async function tradeDay(date: string, weekday: number) {
  const plan = tills.map((t) => Math.round(billsToday(date, weekday, t.store) / 2));
  const slots = Math.max(...plan);
  const minutesOpen = 11 * 60;
  for (let s = 0; s < slots; s++) {
    setClock(date, hhmm(10 * 60 + (s * minutesOpen) / slots));
    await Promise.all(
      tills.map(async (t, i) => {
        if (s >= plan[i]) return;
        const r = rnd();
        try {
          if (r < 0.02 && t.recent.length > 5) await returnBill(t, date, false);
          else if (r < 0.03 && t.recent.length > 5) await returnBill(t, date, true);
          else await sale(t, date);
        } catch (err) {
          fail(r < 0.03 ? 'return or exchange' : 'sale', err);
        }
      }),
    );
  }
}

function nextNumber(t: Till, date: string) {
  const fy = fyName(date);
  t.counters[fy] = (t.counters[fy] ?? 0) + 1;
  return `${t.prefix}-${fy}-${String(t.counters[fy]).padStart(6, '0')}`;
}

function paymentFor(total: number) {
  const r = rnd();
  if (r < 0.45) return [{ paymentMethodId: pm.CASH, amount: String(rnd() < 0.6 ? Math.ceil(total / 100) * 100 : total) }];
  if (r < 0.85) return [{ paymentMethodId: pm.UPI, amount: String(total), reference: `UPI${Math.floor(rnd() * 1e9)}` }];
  return [{ paymentMethodId: pm.CARD, amount: String(total), reference: `AP${Math.floor(rnd() * 1e6)}` }];
}

async function sale(t: Till, date: string) {
  const count = 1 + Math.floor(rnd() ** 1.8 * 5);
  const chosen = new Map<string, { item: Sellable; qty: number }>();
  while (chosen.size < count) {
    const item = popularItem();
    chosen.set(item.id, { item, qty: rnd() < 0.1 ? 2 : 1 });
  }
  const lines = [...chosen.values()];
  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const body = {
    clientId: randomUUID(),
    tillId: t.id,
    shiftClientId: t.shiftClientId,
    soldAt: new Date().toISOString(),
    ...(rnd() < 0.35 ? { customerId: pick(customerIds) } : {}),
    sale: { number: nextNumber(t, date), lines: lines.map((l, i) => ({ lineNo: i + 1, itemId: l.item.id, quantity: String(l.qty) })) },
    payments: paymentFor(total),
    expectedTotal: String(total),
  };
  const res = await timed('post bill', () => api('post', '/pos/bills', body, { 'x-till-token': t.token }));
  t.recent.push({
    billId: res.sale.id,
    lines: (res.sale.lines as { id: string; item: { id: string } }[]).map((l) => ({ id: l.id, itemId: l.item.id, price: chosen.get(l.item.id)!.item.price })),
  });
  if (t.recent.length > 400) t.recent.shift();
}

async function returnBill(t: Till, date: string, exchange: boolean) {
  const bill = t.recent[Math.floor(rnd() * t.recent.length)];
  const line = bill.lines.shift();
  if (!bill.lines.length) t.recent.splice(t.recent.indexOf(bill), 1);
  if (!line) return sale(t, date);
  const ret = { number: nextNumber(t, date), returnOfId: bill.billId, reason: 'Size or colour not right', lines: [{ lineNo: 1, itemId: line.itemId, quantity: '1', returnOfLineId: line.id }] };
  const swap = exchange ? popularItem() : null;
  const net = (swap?.price ?? 0) - line.price;
  const body = {
    clientId: randomUUID(),
    tillId: t.id,
    shiftClientId: t.shiftClientId,
    soldAt: new Date().toISOString(),
    ret,
    ...(swap ? { sale: { number: nextNumber(t, date), lines: [{ lineNo: 1, itemId: swap.id, quantity: '1' }] } } : {}),
    payments: net > 0 ? paymentFor(net) : [{ paymentMethodId: pm.CASH, amount: String(net) }],
  };
  await timed(exchange ? 'post exchange' : 'post return', () => api('post', '/pos/bills', body, { 'x-till-token': t.token }));
}

async function openShift(t: Till, date: string) {
  t.shiftClientId = randomUUID();
  try {
    const s = await timed('open shift', () => api('post', '/pos/shifts', { clientId: t.shiftClientId, tillId: t.id, cash: [{ paymentMethodId: pm.CASH, amount: '2000' }] }, { 'x-till-token': t.token }));
    t.shiftId = s.id;
  } catch (err) {
    fail(`open shift ${date}`, err);
  }
}

/** The cash a careful cashier would count: opening float + cash taken − change given. */
async function expectedCash(shiftId: string): Promise<number> {
  const bills = await prisma.posBill.findMany({ where: { shiftId }, select: { changeAmount: true, payments: { where: { paymentMethodId: pm.CASH }, select: { amount: true } } } });
  let cash = 2000;
  for (const b of bills) {
    cash -= Number(b.changeAmount);
    for (const p of b.payments) cash += Number(p.amount);
  }
  return Math.round(cash);
}

function denominations(amount: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = Math.max(0, amount);
  for (const d of DENOMINATIONS) {
    const n = Math.floor(left / Number(d));
    if (n) out[d] = n;
    left -= n * Number(d);
  }
  return out;
}

async function closeShift(t: Till) {
  if (!t.shiftId) return;
  try {
    const counted = (await expectedCash(t.shiftId)) - (rnd() < 0.05 ? 10 : 0);
    await timed('close shift', () => api('post', `/pos/shifts/${t.shiftId}/close`, { denominations: denominations(counted) }, { 'x-till-token': t.token }));
  } catch (err) {
    fail('close shift', err);
  }
  t.shiftId = '';
}

// ---- Weekly, monthly and quarterly work ----

/** Every Monday: items running low at each shop are bought again, one bill per supplier. */
async function restock(date: string) {
  const byId = new Map(sellables.map((s) => [s.id, s]));
  for (const s of stores) {
    const low = await prisma.stockPosition.findMany({ where: { locationId: s.floor, quantity: { lt: 3 } }, select: { itemId: true, quantity: true }, take: 600 });
    const bySupplier = new Map<number, { item: Sellable; qty: number }[]>();
    for (const p of low) {
      const item = byId.get(p.itemId);
      if (!item) continue;
      const qty = (item.supplier < 8 ? 8 : 15) - Math.min(0, Math.floor(Number(p.quantity)));
      (bySupplier.get(item.supplier) ?? bySupplier.set(item.supplier, []).get(item.supplier)!).push({ item, qty });
    }
    for (const [supplier, lines] of bySupplier) {
      for (let i = 0; i < lines.length; i += 100) {
        const chunk = lines.slice(i, i + 100);
        try {
          const draft = await timed('create supplier bill', () =>
            api('post', '/purchase/bills', {
              kind: 'receives_goods',
              supplierId: supplierIds[supplier],
              supplierBillNo: `INV-${++supplierBillNo}`,
              supplierBillDate: date,
              storeId: s.id,
              lines: chunk.map((l) => ({ itemId: l.item.id, quantity: String(l.qty), rate: l.item.cost.toFixed(2), shelfLocationId: s.floor })),
            }),
          );
          const bill = await timed('finalise supplier bill', () => api('post', `/purchase/bills/${draft.id}/finalise`, { confirmPriceDifference: true }));
          supplierBills.push({ supplierId: supplierIds[supplier], total: Number(bill.total), date, paid: false });
        } catch (err) {
          fail('restock', err);
        }
      }
    }
  }
}

/** Every Wednesday night: the main shop sends 25 items to each of the other shops. */
async function transfer(date: string) {
  const main = stores[0];
  for (const to of stores.slice(1)) {
    const plenty = await prisma.stockPosition.findMany({ where: { locationId: main.floor, quantity: { gte: 8 } }, select: { itemId: true }, take: 400 });
    const lines = plenty.sort(() => rnd() - 0.5).slice(0, 25);
    if (!lines.length) continue;
    try {
      const draft = await api('post', '/stock/documents', { storeId: main.id, kind: 'transfer_send', fromLocationId: main.floor, toStoreId: to.id, lines: lines.map((l) => ({ itemId: l.itemId, quantity: '2' })) });
      await timed('send transfer', () => api('post', `/stock/documents/${draft.id}/finalise`));
      await timed('receive transfer', () => api('post', `/stock/transfers/${draft.id}/receive`, { toLocationId: to.floor }));
    } catch (err) {
      fail(`transfer ${date}`, err);
    }
  }
}

/** Every quarter: 150 items counted at each shop; a few are short (shrinkage). */
async function countStock(date: string) {
  for (const s of stores) {
    const positions = await prisma.stockPosition.findMany({ where: { locationId: s.floor, quantity: { gt: 0 } }, select: { itemId: true, quantity: true }, take: 3000 });
    const lines = positions.sort(() => rnd() - 0.5).slice(0, 150);
    try {
      const draft = await api('post', '/stock/counts', { countType: 'normal', storeId: s.id, locationId: s.floor, lines: lines.map((l) => ({ itemId: l.itemId, countedQuantity: String(Math.max(0, Number(l.quantity) - (rnd() < 0.3 ? 1 : 0))) })) });
      await timed('finalise stock count', () => api('post', `/stock/documents/${draft.id}/finalise`));
    } catch (err) {
      fail(`count ${date}`, err);
    }
  }
}

/** On the 1st: suppliers paid for bills over 30 days old; rent, salaries and power booked per shop. */
async function monthEnd(date: string) {
  const due = new Map<string, number>();
  for (const b of supplierBills) {
    if (b.paid || b.date > addDays(date, -30)) continue;
    due.set(b.supplierId, (due.get(b.supplierId) ?? 0) + b.total);
    b.paid = true;
  }
  for (const [supplierId, amount] of due) {
    try {
      const p = await timed('create payment', () => api('post', '/payments', { kind: 'payment', paymentDate: date, partyType: 'supplier', partyId: supplierId, fromAccountId: bankAccountId, amount: amount.toFixed(2), reference: `NEFT${Math.floor(rnd() * 1e8)}` }));
      await timed('post payment', () => api('post', `/payments/${p.id}/post`));
    } catch (err) {
      fail('supplier payment', err);
    }
  }
  const lines = stores.flatMap((s, i) => [
    { accountId: expenseAccounts.rent, storeId: s.id, debit: String([90000, 70000, 65000][i]) },
    { accountId: expenseAccounts.salaries, storeId: s.id, debit: String([180000, 120000, 110000][i]) },
    { accountId: expenseAccounts.electricity, storeId: s.id, debit: String([22000, 16000, 15000][i]) },
  ]);
  const total = lines.reduce((s, l) => s + Number(l.debit), 0);
  try {
    const j = await timed('create journal', () => api('post', '/journals', { journalDate: date, remark: 'Rent, salaries and electricity', lines: [...lines, { accountId: bankAccountId, credit: String(total) }] }));
    await timed('post journal', () => api('post', `/journals/${j.id}/post`));
  } catch (err) {
    fail('expenses journal', err);
  }
}

// ---- Carrying on after a stopped run ----

/** Rebuilds what the trading loop needs from the database, closes any shift left open, and starts the next day. */
async function resume() {
  const last = (await prisma.posBill.aggregate({ _max: { businessDate: true } }))._max.businessDate!;
  const lastDay = last.toISOString().slice(0, 10);
  firstDay = Math.round((Date.parse(lastDay) - Date.parse(START)) / 86400_000) + 1;
  setClock(lastDay, '21:15');
  owner = await login(app, OWNER.email, OWNER.password);
  notes['resumed after'] = lastDay;

  const locations = await prisma.stockLocation.findMany({ where: { code: { endsWith: '-FLOOR' } } });
  for (const s of STORES) {
    const row = await prisma.store.findFirstOrThrow({ where: { code: s.code } });
    stores.push({ id: row.id, code: s.code, floor: locations.find((l) => l.code === `${s.code}-FLOOR`)!.id, weight: s.weight });
  }
  for (const m of await prisma.paymentMethod.findMany()) pm[m.code] = m.id;
  const sellList = (await prisma.catalogueSettings.findFirstOrThrow()).defaultSellingPriceListId!;
  const prices = new Map((await prisma.price.findMany({ where: { priceListId: sellList }, select: { itemId: true, price: true } })).map((p) => [p.itemId, Number(p.price)]));
  const costs = new Map((await prisma.stockPosition.findMany({ where: { locationId: stores[0].floor }, select: { itemId: true, unitCost: true } })).map((p) => [p.itemId, Number(p.unitCost)]));
  const items = await prisma.item.findMany({ where: { isParentStyle: false, isStockItem: true }, select: { id: true, code: true, parentItemId: true }, orderBy: { code: 'asc' } });
  for (const [i, it] of items.entries()) {
    const price = prices.get(it.id);
    if (!price) continue;
    sellables.push({ id: it.id, code: it.code, price, cost: costs.get(it.id) ?? Math.round(price * 0.5 * 100) / 100, supplier: it.parentItemId ? i % 8 : 8 + (i % 7) });
  }
  popularity = sellables.map((_, i) => i).sort(() => rnd() - 0.5);
  customerIds.push(...(await prisma.customer.findMany({ where: { isWalkIn: false }, select: { id: true } })).map((c) => c.id));
  supplierIds.push(...(await prisma.supplier.findMany({ orderBy: { code: 'asc' }, select: { id: true } })).map((x) => x.id));
  bankAccountId = (await prisma.account.findFirstOrThrow({ where: { name: 'HDFC current account' } })).id;
  for (const key of ['rent', 'salaries', 'electricity']) expenseAccounts[key] = (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
  supplierBillNo = await prisma.supplierBill.count();
  for (const b of await prisma.supplierBill.findMany({ where: { status: 'unpaid', postingDate: { gt: new Date(`${addDays(lastDay, -30)}T00:00:00Z`) } }, select: { supplierId: true, total: true, postingDate: true } })) {
    supplierBills.push({ supplierId: b.supplierId, total: Number(b.total), date: b.postingDate.toISOString().slice(0, 10), paid: false });
  }

  for (const till of await prisma.till.findMany({ orderBy: { code: 'asc' } })) {
    const store = stores.findIndex((s) => s.id === till.storeId);
    const token = (await api('post', `/pos/tills/${till.id}/register`, { deviceName: `${till.code} PC (resumed)` })).token as string;
    const t: Till = { id: till.id, code: till.code, store, token, prefix: till.seriesKind, counters: {}, shiftId: '', shiftClientId: '', recent: [] };
    for (const fy of ['2025-26', '2026-27']) {
      const top = await prisma.posBill.findFirst({ where: { tillId: till.id, number: { contains: `-${fy}-` } }, orderBy: { number: 'desc' }, select: { number: true } });
      if (top) t.counters[fy] = Number(top.number.slice(-6));
    }
    const recent = await prisma.posBill.findMany({
      where: { tillId: till.id, kind: 'sale', status: 'completed' },
      orderBy: { soldAt: 'desc' },
      take: 400,
      select: { id: true, lines: { where: { isFree: false }, select: { id: true, itemId: true, quantity: true, lineTotal: true, returnedQuantity: true } } },
    });
    for (const b of recent.reverse()) {
      const lines = b.lines.filter((l) => Number(l.returnedQuantity) === 0).map((l) => ({ id: l.id, itemId: l.itemId, price: Number(l.lineTotal) / Number(l.quantity) }));
      if (lines.length) t.recent.push({ billId: b.id, lines });
    }
    // A shift left open when the run stopped is closed with its expected cash.
    const open = await prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
    if (open) {
      t.shiftId = open.id;
      await closeShift(t);
    }
    tills.push(t);
  }
}
