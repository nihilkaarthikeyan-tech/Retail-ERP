// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 2 (28 October 2026): money and accounts. Each problem found, proved fixed:
// cancelling a return gives its freight share back; a double click posts or cancels once;
// the books cannot be locked over an open till shift; ageing of one store shows its own bills.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addDays, businessDate, Decimal } from 'shared';
import type { App } from 'supertest/types.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let pcs: string;
let groupId: string;
let supplierId: string;
let loc: Record<string, string>;

const today = () => businessDate();

async function bal(key: string): Promise<string> {
  const acct = (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: acct }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

async function item(name: string) {
  return (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6109' }).expect(201)).body as { id: string };
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  MAIN = await storeId(prisma, 'MAIN');
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'TEES', name: 'T-shirts' }).expect(201)).body.id;
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  const groups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  supplierId = (await owner.post('/suppliers').send({ name: 'Tiruppur Garments', supplierGroupId: groups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body.id;
});

afterAll(async () => {
  await app.close();
});

describe('audit 2: money and accounts', () => {
  it('cancelling a return to the supplier also gives its freight share back', async () => {
    const tee = await item('Polo T-shirt');
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId, noOrderReason: 'Local purchase', lines: [{ itemId: tee.id, receivedQuantity: '10', rate: '100', gstRate: '5' }] }).expect(201)).body;
    const receipt = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    const charge = (await owner.post('/purchase/charges').send({ shareBy: 'value', receiptIds: [receipt.id], charges: [{ description: 'Lorry freight', chargeType: 'freight', amount: '100' }] }).expect(201)).body;
    await owner.post(`/purchase/charges/${charge.id}/finalise`).expect(200);
    const before = { grnb: await bal('goods_received_not_billed'), freight: await bal('freight_inward') };
    const ret = (await owner.post(`/purchase/receipts/${receipt.id}/return`).send({ reason: 'Wrong colour', lines: [{ originalLineId: receipt.lines[0].id, acceptedQuantity: '2' }] }).expect(201)).body;
    expect(new Decimal(await bal('freight_inward')).sub(before.freight).toFixed(2)).toBe('20.00');
    await owner.post(`/purchase/receipts/${ret.id}/cancel`).send({ reason: 'Supplier sent them back' }).expect(200);
    expect(await bal('freight_inward')).toBe(before.freight);
    expect(await bal('goods_received_not_billed')).toBe(before.grnb);
  });

  it('a double click on "Finalise" moves the stock once', async () => {
    const tee = await item('V-neck T-shirt');
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: tee.id, countedQuantity: '10', unitCost: '100' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    const out = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: tee.id, quantity: '3' }] }).expect(201)).body;
    const [a, b] = await Promise.all([owner.post(`/stock/documents/${out.id}/finalise`), owner.post(`/stock/documents/${out.id}/finalise`)]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 400]);
    const position = await prisma.stockPosition.findUniqueOrThrow({ where: { itemId_locationId: { itemId: tee.id, locationId: loc['MAIN-FLOOR'] } } });
    expect(position.quantity.toString()).toBe('7');
    // …and a double click on "Cancel" gives it back once.
    const [c, d] = await Promise.all([owner.post(`/stock/documents/${out.id}/cancel`).send({ reason: 'Not damaged' }), owner.post(`/stock/documents/${out.id}/cancel`).send({ reason: 'Not damaged' })]);
    expect([c.status, d.status].sort((x, y) => x - y)).toEqual([200, 400]);
    expect((await prisma.stockPosition.findUniqueOrThrow({ where: { itemId_locationId: { itemId: tee.id, locationId: loc['MAIN-FLOOR'] } } })).quantity.toString()).toBe('10');
  });

  it('a double click on "Post" posts a payment once; amounts are whole paise', async () => {
    const cashIn = (await prisma.account.findFirstOrThrow({ where: { systemKey: `cash_in_hand:${MAIN}` } })).id;
    const cashTill = (await prisma.account.findFirstOrThrow({ where: { systemKey: `cash_in_till:${MAIN}` } })).id;
    await owner.post('/payments').send({ kind: 'transfer', paymentDate: today(), storeId: MAIN, fromAccountId: cashIn, toAccountId: cashTill, amount: '100.004' }).expect(400);
    const draft = (await owner.post('/payments').send({ kind: 'transfer', paymentDate: today(), storeId: MAIN, fromAccountId: cashIn, toAccountId: cashTill, amount: '300' }).expect(201)).body;
    const [a, b] = await Promise.all([owner.post(`/payments/${draft.id}/post`), owner.post(`/payments/${draft.id}/post`)]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 400]);
    expect(await prisma.ledgerEntry.count({ where: { documentType: 'payment', documentId: draft.id } })).toBe(1);
  });

  it('the books cannot be locked over a till shift that is still open', async () => {
    const sellList = (await owner.get('/catalogue/settings').expect(200)).body.defaultSellingPriceListId;
    const pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    const till = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: sellList, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] }).expect(201)).body;
    const token = (await owner.post(`/pos/tills/${till.id}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
    const shiftClientId = randomUUID();
    await owner.post('/pos/shifts').set('x-till-token', token).send({ clientId: shiftClientId, tillId: till.id, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
    const res = await owner.patch('/accounting/lock-date').send({ lockDate: today(), reason: 'Month closed' }).expect(400);
    expect(res.body.message).toMatch(/Close these till shifts first: |Close these till shifts first/);
    expect(res.body.message).toContain('T1');
    // A date before the shift's day is fine.
    await owner.patch('/accounting/lock-date').send({ lockDate: addDays(today(), -1), reason: 'Up to yesterday' }).expect(200);

    // An offline bill of yesterday arriving now is kept, and listed: its accounts go to today.
    const tee = await item('Offline T-shirt');
    await owner.post('/prices').send({ priceListId: sellList, itemId: tee.id, price: '300', startDate: '2026-04-01' }).expect(201);
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], postingDate: addDays(today(), -2), lines: [{ itemId: tee.id, countedQuantity: '5', unitCost: '100' }] })).body;
    if (c.id) await owner.post(`/stock/documents/${c.id}/finalise`);
    await owner.post('/pos/gst-rates').send({ hsnCode: '6109', rate: '5', effectiveFrom: '2026-04-01' });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const offline = await owner.post('/pos/bills').set('x-till-token', token).send({ clientId: randomUUID(), tillId: till.id, shiftClientId, offline: true, soldAt: yesterday, sale: { number: 'MAT1/2627/000001', lines: [{ lineNo: 1, itemId: tee.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '300' }] });
    expect(offline.status, JSON.stringify(offline.body)).toBe(201);
    expect(offline.body.sale.checkFlags).toContain('after_books_locked');
    await owner.patch('/accounting/lock-date').send({ lockDate: null, reason: 'Test over' }).expect(200);

    // A gift card sold by card at the till is in the till payments report's card total.
    await owner.patch('/modules/gift_cards').send({ enabled: true });
    await owner.post('/pos/gift-cards/sell').set('x-till-token', token).send({ clientId: randomUUID(), tillId: till.id, amount: '500', paymentMethodId: pm.CARD, reference: 'APPR-1' }).expect(201);
    const report = (await owner.get(`/pos/reports/payments?from=${today()}&to=${today()}`).expect(200)).body as { method: string; kind: string; amount: string }[];
    expect(report.find((r) => r.kind === 'card')?.amount).toBe('500.00');
  });
});
