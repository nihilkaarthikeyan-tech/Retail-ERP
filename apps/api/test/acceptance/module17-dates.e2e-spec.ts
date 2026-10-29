// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 6 (dates and the Indian calendar), 29 October 2026: the server's clock set a few
// minutes before and after midnight Indian time on 31 March, the last day of a financial year.
// Only Date is faked; timers run as usual. Times are UTC instants; India is UTC+05:30.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { shortFinancialYear } from 'shared';
import { FinancialYearsService } from '../../src/financial-years/financial-years.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let loc: Record<string, string>;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shirtId: string;
const counters: Record<string, number> = {};
const num = (fy: string) => `MAT1/${shortFinancialYear(fy)}/${String((counters[fy] = (counters[fy] ?? 0) + 1)).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 31 March 2027, 23:40 in India: the company and its login are made on that clock (each later step is
  // under 30 minutes on, so the login stays alive).
  at('2027-03-31T18:10:00Z');
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  await app.get(FinancialYearsService).createNextYearsIfDue('2027-03-31'); // 2027-28
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  const group = (await owner.post('/catalogue/item-groups').send({ code: 'APP', name: 'Apparel' }).expect(201)).body;
  const list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2025-09-22' }).expect(201);
  shirtId = (await owner.post('/items').send({ name: 'Cotton Shirt', itemGroupId: group.id, baseUnitId: pcs, hsnCode: '62052000' }).expect(201)).body.id;
  await owner.post('/prices').send({ priceListId: list, itemId: shirtId, price: '1050', startDate: '2026-04-01' }).expect(201);
  const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: shirtId, countedQuantity: '20', unitCost: '500' }] }).expect(201)).body;
  await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: list, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
});

function sale(soldAt: string, fy: string, extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt, sale: { number: num(fy), lines: [{ lineNo: 1, itemId: shirtId, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '1050' }], ...extra };
}

describe('audit 6: a few minutes either side of midnight on 31 March (Indian time)', () => {
  let oldShift: { id: string; businessDate: string };

  it('23:50 and 23:59 IST on 31 March: the shift and the bill belong to 31 March and to 2026-27', async () => {
    at('2027-03-31T18:20:00Z'); // 23:50 IST
    oldShift = (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201)).body;
    expect(oldShift.businessDate).toBe('2027-03-31');
    at('2027-03-31T18:29:30Z'); // 23:59:30 IST
    const res = await T(owner.post('/pos/bills')).send(sale('2027-03-31T18:29:30Z', '2026-27'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.sale).toMatchObject({ businessDate: '2027-03-31', number: 'MAT1/2627/000001' });
    expect((await prisma.posBill.findUniqueOrThrow({ where: { id: res.body.sale.id }, select: { gstPeriod: true } })).gstPeriod).toBe('2027-03');
  });

  it('00:05 IST on 1 April: an online bill on yesterday’s shift is refused; after closing, the new shift and its bills are in 2027-28', async () => {
    at('2027-03-31T18:35:00Z'); // 00:05 IST, 1 April
    const refused = await T(owner.post('/pos/bills')).send(sale('2027-03-31T18:35:00Z', '2027-28'));
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/shift/i);
    counters['2027-28'] = 0;
    // Opening ₹1,000 + one sale of ₹1,050: ₹2,050 counted, no difference.
    await T(owner.post(`/pos/shifts/${oldShift.id}/close`)).send({ denominations: { '500': 4, '50': 1 } }).expect(200);
    const shift = (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '2050' }] }).expect(201)).body;
    expect(shift.businessDate).toBe('2027-04-01');
    const res = await T(owner.post('/pos/bills')).send(sale('2027-03-31T18:35:30Z', '2027-28'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.sale).toMatchObject({ businessDate: '2027-04-01', number: 'MAT1/2728/000001' });
    expect((await prisma.posBill.findUniqueOrThrow({ where: { id: res.body.sale.id }, select: { gstPeriod: true } })).gstPeriod).toBe('2027-04');
    // The sale's ledger entry (posted when the shift closes) is dated on the bill's day, not the UTC day.
    const yesterday = await prisma.ledgerEntry.findMany({ where: { documentType: 'pos_shift', documentId: oldShift.id }, select: { entryDate: true } });
    expect(yesterday.map((e) => e.entryDate.toISOString().slice(0, 10))).toEqual(expect.arrayContaining(['2027-03-31']));
  });

  it('00:10 IST: a stock document saved without a date is dated 1 April', async () => {
    at('2027-03-31T18:40:00Z');
    const draft = (await owner.post('/stock/documents').send({ kind: 'stock_out', storeId: MAIN, fromLocationId: loc['MAIN-FLOOR'], reason: 'damage', lines: [{ itemId: shirtId, quantity: '1' }] }).expect(201)).body;
    const doc = (await owner.post(`/stock/documents/${draft.id}/finalise`).expect(200)).body;
    expect(doc.postingDate ?? doc.date, JSON.stringify(doc)).toBe('2027-04-01');
  });

  it('a till whose clock is behind cannot open a shift dated before its last close', async () => {
    at('2027-03-31T18:45:00Z');
    const current = (await prisma.shift.findFirstOrThrow({ where: { tillId, status: 'open' } })).id;
    await T(owner.post(`/pos/shifts/${current}/close`)).send({ denominations: { '500': 6, '100': 1 } }).expect(200);
    const res = await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, openedAt: '2027-03-25T05:00:00+05:30', cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/clock is behind/);
  });

  it('the daily summary e-mail time must be at most 23:55 (it runs every 5 minutes)', async () => {
    const res = await owner.put('/summary-email/settings').send({ enabled: true, sendAt: '23:58', recipientIds: [], figures: ['sales'] });
    expect(JSON.stringify(res.body)).toMatch(/23:55/);
  });
});
