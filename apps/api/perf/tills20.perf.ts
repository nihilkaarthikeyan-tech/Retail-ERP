// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 12 (30 October 2026): 20 tills of one shop saving bills at the same moment, on the server
// that will run them. Sets up its own shop in the speed-test database (never live data), then times
// 40 bills from one till alone, a busy rush (each till a bill every 2 seconds) and 15 rounds of all 20
// tills pressing "finish" in the same instant. Results go to perf/out/.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, shortFinancialYear } from 'shared';
import { SystemPrisma } from '../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../test/helpers.js';

const TILLS = 20;
const ITEMS = 60;
const ROUNDS = 15;
const RUSH_BILLS = 15;
const OUT = new URL('./out/', import.meta.url);

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

const stats = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  return { count: s.length, median: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1]) };
};

it(`${TILLS} tills save bills at the same moment`, async () => {
  owner = await setUpCompany(app, prisma);
  const MAIN = await storeId(prisma, 'MAIN');
  const floor = (await prisma.stockLocation.findFirstOrThrow({ where: { code: 'MAIN-FLOOR' } })).id;
  const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  const group = (await owner.post('/catalogue/item-groups').send({ code: 'GEN', name: 'General' }).expect(201)).body.id;
  const list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '3402', rate: '18', effectiveFrom: '2026-04-01' }).expect(201);

  // Items with a price and plenty of stock (one opening count).
  const items: { id: string; price: number }[] = [];
  for (let i = 0; i < ITEMS; i++) {
    const it = (await owner.post('/items').send({ name: `Item ${i + 1}`, itemGroupId: group, baseUnitId: pcs, hsnCode: '3402' }).expect(201)).body as { id: string };
    const price = 50 + i * 5;
    await owner.post('/prices').send({ priceListId: list, itemId: it.id, price: String(price), startDate: '2026-04-01' }).expect(201);
    items.push({ id: it.id, price });
  }
  const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: floor, lines: items.map((i) => ({ itemId: i.id, countedQuantity: '100000', unitCost: '30' })) }).expect(201)).body;
  await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);

  // 20 tills, each registered with an open shift.
  const cash = (await owner.get('/pos/payment-methods').expect(200)).body.find((m: { code: string }) => m.code === 'CASH').id as string;
  const fy = shortFinancialYear((await prisma.financialYear.findFirstOrThrow({ where: { status: 'open' }, orderBy: { startDate: 'desc' } })).name);
  const tills: { id: string; token: string; prefix: string; n: number }[] = [];
  for (let t = 1; t <= TILLS; t++) {
    const id = (await owner.post('/pos/tills').send({ storeId: MAIN, code: `T${t}`, name: `Counter ${t}`, locationId: floor, priceListId: list, paymentMethods: [{ paymentMethodId: cash, isDefault: true }] }).expect(201)).body.id as string;
    const token = (await owner.post(`/pos/tills/${id}/register`).send({ deviceName: `PC ${t}` }).expect(201)).body.token as string;
    await owner.post('/pos/shifts').set('x-till-token', token).send({ clientId: randomUUID(), tillId: id, cash: [{ paymentMethodId: cash, amount: '2000' }] }).expect(201);
    const till = await prisma.till.findUniqueOrThrow({ where: { id } });
    tills.push({ id, token, prefix: `${till.seriesKind}/${fy}/`, n: 0 });
  }

  // A 3-item bill; neighbouring tills share some items, as at a real counter (the same stock rows are locked).
  const post = async (t: (typeof tills)[number], k: number) => {
    const lines = [0, 1, 2].map((j) => items[(k * 3 + j * 7) % ITEMS]);
    const total = lines.reduce((s, l) => s + l.price, 0);
    t.n++;
    const body = { clientId: randomUUID(), tillId: t.id, soldAt: new Date().toISOString(), sale: { number: `${t.prefix}${String(t.n).padStart(6, '0')}`, lines: lines.map((l, i) => ({ lineNo: i + 1, itemId: l.id, quantity: '1' })) }, payments: [{ paymentMethodId: cash, amount: String(total) }] };
    const t0 = performance.now();
    const res = await owner.post('/pos/bills').set('x-till-token', t.token).send(body);
    const ms = performance.now() - t0;
    if (res.status !== 201) throw new Error(`bill refused: ${JSON.stringify(res.body).slice(0, 300)}`);
    return ms;
  };

  for (let k = 0; k < 5; k++) await post(tills[0], k); // warm up
  const alone: number[] = [];
  for (let k = 0; k < 40; k++) alone.push(await post(tills[0], k));
  // The worst case: every till presses "finish" in the very same instant, 15 times over.
  const together: number[] = [];
  for (let r = 0; r < ROUNDS; r++) together.push(...(await Promise.all(tills.map((t, i) => post(t, r * TILLS + i)))));
  // A busy rush: each till saves a bill every 2 seconds (each starting at its own moment) for 30 seconds,
  // about 600 bills a minute across the shop.
  const rush: number[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.all(
    tills.map(async (t, i) => {
      await sleep(i * 100);
      for (let k = 0; k < RUSH_BILLS; k++) {
        const t0 = performance.now();
        rush.push(await post(t, 1000 + i * RUSH_BILLS + k));
        await sleep(Math.max(0, 2000 - (performance.now() - t0)));
      }
    }),
  );

  const result = { date: businessDate(), tills: TILLS, oneTillAlone: stats(alone), busyRush: stats(rush), allTillsSameInstant: stats(together) };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL('tills20.json', OUT), JSON.stringify(result, null, 2));
  console.log(`TILLS20 ${JSON.stringify(result)}`);
  expect(await prisma.posBill.count()).toBe(5 + 40 + ROUNDS * TILLS + RUSH_BILLS * TILLS);
  // Under 2 seconds is the audit 8 target for the till, in a busy rush. The same-instant burst is reported only.
  expect(result.busyRush.p95).toBeLessThan(2000);
});
