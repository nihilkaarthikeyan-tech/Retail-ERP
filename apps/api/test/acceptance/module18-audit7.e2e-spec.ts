// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 7 (data safety), 29 October 2026: clearing trial data empties every table of
// transactions (gift cards and points too) and keeps the rest; it is refused once anything was
// reported to the GST portal.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate } from 'shared';
import { KEPT_TABLES, TRANSACTION_TABLES } from '../../src/documents/go-live.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let tillId: string;
let tillToken: string;
let pm: Record<string, string>;
const COMPANY = 'Rademics Retail Pvt Ltd';
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshShop() {
  owner = await setUpCompany(app, prisma);
  const MAIN = await storeId(prisma, 'MAIN');
  const loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  const list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: list, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
  await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '0' }] }).expect(201);
}

describe('audit 7: clearing trial data', () => {
  it('every table with a shop column is either cleared or kept, never forgotten', async () => {
    const rows = await prisma.$queryRaw<{ t: string }[]>`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'companyId'`;
    const cleared = TRANSACTION_TABLES.flatMap((s) => s.tables);
    const listed = [...cleared, ...KEPT_TABLES];
    expect(listed.length).toBe(new Set(listed).size);
    expect(rows.map((r) => r.t).filter((t) => !listed.includes(t))).toEqual([]);
    expect(listed.filter((t) => !rows.some((r) => r.t === t))).toEqual([]);
  });

  it('a gift card and points from the trial are cleared with the ledger, so nothing can be spent afterwards', async () => {
    await freshShop();
    const card = (await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '1000', paymentMethodId: pm.CASH }).expect(201)).body.card;
    const company = await prisma.company.findFirstOrThrow();
    const group = await prisma.customerGroup.findFirstOrThrow();
    const priya = (await owner.post('/customers').send({ name: 'Priya', customerGroupId: group.id, mobile: '9876543210' }).expect(201)).body;
    await prisma.loyaltyEntry.create({ data: { companyId: company.id, customerId: priya.id, kind: 'earn', points: 50, value: '50', entryDate: new Date(`${businessDate()}T00:00:00Z`), remaining: 50 } });

    await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: COMPANY, reason: 'End of the trial' }).expect(200);
    expect(await prisma.giftCard.count()).toBe(0);
    expect(await prisma.giftCardEntry.count()).toBe(0);
    expect(await prisma.loyaltyEntry.count()).toBe(0);
    expect(await prisma.ledgerLine.count()).toBe(0);
    expect(await prisma.customer.count({ where: { id: priya.id } })).toBe(1);
    await owner.post(`/pos/till/${tillId}/gift-cards/check`).send({ number: card.number }).expect(404);
    expect((await owner.get('/reports/book-health').expect(200)).body.ok).toBe(true);
  });

  it('the database refuses deleting a saved document, changing history, or an impossible value', async () => {
    await freshShop();
    const card = (await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '500', paymentMethodId: pm.CASH }).expect(201)).body.card;
    const MAIN = await storeId(prisma, 'MAIN');
    const floor = await prisma.stockLocation.findFirstOrThrow({ where: { code: 'MAIN-FLOOR' } });
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'APP', name: 'Apparel' }).expect(201)).body;
    const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
    const shirt = (await owner.post('/items').send({ name: 'Shirt', itemGroupId: group.id, baseUnitId: pcs, hsnCode: '6205' }).expect(201)).body;
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: floor.id, lines: [{ itemId: shirt.id, countedQuantity: '5', unitCost: '100' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    await expect(prisma.stockDocument.delete({ where: { id: count.id } })).rejects.toThrow(/cannot be deleted; cancel them instead/);
    await expect(prisma.giftCardEntry.updateMany({ data: { amount: '1' } })).rejects.toThrow(/history and cannot be changed/);
    await expect(prisma.giftCard.update({ where: { id: card.id }, data: { balance: '-1' } })).rejects.toThrow(/GiftCard_balance_not_negative/);
    await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
    await expect(prisma.gstRate.updateMany({ data: { rate: '101' } })).rejects.toThrow(/GstRate_rate_range/);
  });

  it('is refused once a month is marked as filed or an e-invoice is registered', async () => {
    await freshShop();
    const company = await prisma.company.findFirstOrThrow();
    const reg = await prisma.gstRegistration.findFirstOrThrow();
    const e = await prisma.eInvoice.create({ data: { companyId: company.id, gstRegistrationId: reg.id, documentType: 'pos_bill', documentId: randomUUID(), documentNumber: 'MAT1/2627/000009', status: 'registered', irn: 'x'.repeat(64) } });
    const refused = await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: COMPANY, reason: 'End of the trial' }).expect(403);
    expect(refused.body.message).toMatch(/1 registered e-invoice.*can no longer be cleared/);
    expect(await prisma.shift.count()).toBe(1);

    await prisma.eInvoice.update({ where: { id: e.id }, data: { status: 'cancelled' } });
    await prisma.gstFiledPeriod.create({ data: { companyId: company.id, gstRegistrationId: reg.id, period: '2026-04', returnType: 'gstr1', filedOn: new Date('2026-05-11T00:00:00Z') } });
    expect((await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: COMPANY, reason: 'End of the trial' }).expect(403)).body.message).toMatch(/1 month\(s\) marked as filed/);
  });
});
