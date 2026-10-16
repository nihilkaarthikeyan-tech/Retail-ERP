// Copyright (c) 2026, Rademics. All rights reserved.
// Automated version of docs/acceptance-tests.md scenario 11.23 (supplier
// sale-or-return), plan 11 part 2 §3.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { AccountingSetup } from '../../src/ledger/accounting-setup.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, OWNER, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let companyId: string;
let n = 0;

const today = () => businessDate();
const monthStart = () => `${today().slice(0, 8)}01`;
const num = () => `MAIN-T1-2026-27-${String(++n).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const cash = (amount: string) => [{ paymentMethodId: pm.CASH, amount }];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  companyId = (await prisma.company.findFirstOrThrow()).id;
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '4202', rate: '12', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
  await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '2000' }] }).expect(201);
}

async function position(itemId: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc['MAIN-FLOOR'] } } });
  return { q: p?.quantity.toString() ?? '0', value: p?.value.toFixed(2) ?? '0.00' };
}

/** Credit balance of the account behind a role. */
async function roleBalance(role: string) {
  const d = await prisma.accountDefault.findUniqueOrThrow({ where: { companyId_role: { companyId, role } } });
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: d.accountId }, _sum: { debit: true, credit: true } });
  return (Number(s._sum.credit ?? 0) - Number(s._sum.debit ?? 0)).toFixed(2);
}

function sell(itemId: string, quantity: string, total: string) {
  return T(owner.post('/pos/bills')).send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: [{ lineNo: 1, itemId, quantity }] }, payments: cash(total) });
}

describe('11.23 supplier sale-or-return', () => {
  let fancyWorld: { id: string };
  let handbag: { id: string; code: string };
  let receipt: { id: string; lines: { id: string }[] };
  let statement: { id: string; number: string };
  let early: { id: string };
  let billId: string;

  beforeAll(async () => {
    await freshCompany();
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'BAGS', name: 'Bags' }).expect(201)).body.id;
    handbag = (await owner.post('/items').send({ name: 'Ladies handbag', itemGroupId: group, baseUnitId: pcs, hsnCode: '4202' }).expect(201)).body;
    await owner.post('/prices').send({ priceListId: listId, itemId: handbag.id, price: '599', startDate: '2026-04-01' }).expect(201);
    const groups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
    const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
    fancyWorld = (await owner.post('/suppliers').send({ name: 'Fancy World', supplierGroupId: groups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body;
    // The shop also owns 5 of the same handbag (bought outright earlier).
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: handbag.id, countedQuantity: '5', unitCost: '280' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
  });

  afterAll(async () => {
    expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  });

  it('an existing company gets the new "Owed to suppliers on consignment" account and default', async () => {
    const setup = app.get(AccountingSetup);
    await setup.ensure(prisma, companyId);
    // Pretend the company was set up before the account existed.
    await prisma.accountDefault.delete({ where: { companyId_role: { companyId, role: 'consignment_payable' } } });
    await prisma.account.delete({ where: { companyId_systemKey: { companyId, systemKey: 'consignment_payable' } } });
    await setup.ensure(prisma, companyId);
    const account = await prisma.account.findUniqueOrThrow({ where: { companyId_systemKey: { companyId, systemKey: 'consignment_payable' } }, include: { parent: true } });
    expect([account.number, account.name, account.family, account.parent?.systemKey]).toEqual(['2150', 'Owed to suppliers on consignment', 'liability', 'current_liabilities']);
    expect((await prisma.accountDefault.findUniqueOrThrow({ where: { companyId_role: { companyId, role: 'consignment_payable' } } })).accountId).toBe(account.id);
  });

  it('20 handbags at ₹300 on sale or return: stock up by 20 (₹6,000.00) against the consignment balance, not the supplier', async () => {
    // Sale-or-return goods cannot come from a purchase order.
    const draft = (
      await owner
        .post('/purchase/receipts')
        .send({ supplierId: fancyWorld.id, storeId: MAIN, isConsignment: true, deliveryNoteNo: 'FW-77', lines: [{ itemId: handbag.id, receivedQuantity: '20', rate: '300', gstRate: '0' }] })
        .expect(201)
    ).body;
    expect(draft.isConsignment).toBe(true);
    receipt = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    expect(receipt).toMatchObject({ isConsignment: true, status: 'completed', taxableAmount: '6000.00', stockValue: '6000.00' });
    expect(await position(handbag.id)).toEqual({ q: '25', value: '7400.00' });
    expect(await roleBalance('consignment_payable')).toBe('6000.00');
    expect(await roleBalance('goods_received_not_billed')).toBe('0.00');
    expect((await app.get(LedgerService).partyBalance(prisma, 'supplier', fancyWorld.id)).toFixed(2)).toBe('0.00');
    const list = (await owner.get('/purchase/receipts?isConsignment=true&isReturn=false').expect(200)).body;
    expect(list.rows.map((r: { id: string; isConsignment: boolean }) => [r.id, r.isConsignment])).toEqual([[receipt.id, true]]);
    expect((await owner.get('/purchase/consignment/check').expect(200)).body).toEqual({ fromGoods: '6000.00', ledger: '6000.00', difference: '0.00', ok: true });
  });

  it('it can never be billed by a normal supplier bill, nor take freight on its cost', async () => {
    const res = await owner
      .post('/purchase/bills')
      .send({ kind: 'against_receipt', supplierId: fancyWorld.id, supplierBillNo: 'FW/9', supplierBillDate: today(), lines: [{ receiptLineId: receipt.lines[0].id, itemId: handbag.id, quantity: '20' }] })
      .expect(400);
    expect(res.body.message).toMatch(/sale or return; it is billed from a consignment statement/);
  });

  it('7 sold at the till (8 sold, 1 brought back), 3 returned unsold to the supplier', async () => {
    await sell(handbag.id, '5', '2995').expect(201);
    const second = (await sell(handbag.id, '3', '1797').expect(201)).body;
    await T(owner.post('/pos/bills'))
      .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: second.sale.id, lines: [{ lineNo: 1, itemId: handbag.id, quantity: '1', returnOfLineId: second.sale.lines[0].id }] }, payments: cash('-599') })
      .expect(201);
    expect((await position(handbag.id)).q).toBe('18');
    // Only goods still held on sale or return may go back: 13 are left.
    const tooMany = await owner.post(`/purchase/receipts/${receipt.id}/return`).send({ reason: 'Unsold', lines: [{ originalLineId: receipt.lines[0].id, acceptedQuantity: '14' }] }).expect(400);
    expect(tooMany.body.message).toMatch(/only 13 of this supplier's sale-or-return goods are still in the shop/);
    const ret = (await owner.post(`/purchase/receipts/${receipt.id}/return`).send({ reason: 'Unsold, going back', lines: [{ originalLineId: receipt.lines[0].id, acceptedQuantity: '3' }] }).expect(201)).body;
    expect(ret).toMatchObject({ isReturn: true, isConsignment: true, stockValue: '-900.00' });
    expect((await position(handbag.id)).q).toBe('15');
    expect(await roleBalance('consignment_payable')).toBe('5100.00');
    // Goods that were sold are owed: the receipt cannot be cancelled.
    expect((await owner.post(`/purchase/receipts/${receipt.id}/cancel`).send({ reason: 'Oops' }).expect(400)).body.message).toMatch(/returned|sold/);
  });

  it('the statement for the month: received 20, sold 7, returned 3, held 10; it becomes a bill of ₹2,100.00', async () => {
    early = (await owner.post('/purchase/consignment/statements').send({ supplierId: fancyWorld.id, storeId: MAIN, fromDate: monthStart(), toDate: today() }).expect(201)).body;
    const draft = (await owner.post('/purchase/consignment/statements').send({ supplierId: fancyWorld.id, storeId: MAIN, fromDate: monthStart(), toDate: today() }).expect(201)).body;
    expect(draft).toMatchObject({ status: 'draft', amount: '2100.00', fromDate: monthStart(), toDate: today(), bill: null });
    expect(draft.number).toMatch(/^CS-MAIN-2026-27-\d{5}$/);
    expect(draft.lines).toEqual([{ item: { id: handbag.id, code: handbag.code, name: 'Ladies handbag' }, received: '20', sold: '7', returned: '3', held: '10', rate: '300.00', amount: '2100.00' }]);
    statement = draft;

    const billed = (await owner.post(`/purchase/consignment/statements/${statement.id}/bill`).send({ supplierBillNo: 'FW/SOR/1' }).expect(200)).body;
    expect(billed).toMatchObject({ status: 'billed', amount: '2100.00', bill: { status: 'unpaid', total: '2100.00' } });
    billId = billed.bill.id;
    const bill = (await owner.get(`/purchase/bills/${billId}`).expect(200)).body;
    expect(bill).toMatchObject({ supplierBillNo: 'FW/SOR/1', taxableAmount: '2100.00', total: '2100.00', amountDue: '2100.00', paymentStatus: 'unpaid' });
    expect(bill.lines).toMatchObject([{ quantity: '7', rate: '300.00', accountRole: 'consignment_payable', receiptLineId: receipt.lines[0].id }]);
    // The consignment balance is ₹3,000.00 for the 10 still held; the supplier is owed ₹2,100.00 as usual.
    expect(await roleBalance('consignment_payable')).toBe('3000.00');
    expect((await app.get(LedgerService).partyBalance(prisma, 'supplier', fancyWorld.id)).toFixed(2)).toBe('2100.00');
    expect((await owner.get('/purchase/consignment/check').expect(200)).body).toEqual({ fromGoods: '3000.00', ledger: '3000.00', difference: '0.00', ok: true });
  });

  it('a second statement for the same period adds nothing twice', async () => {
    const again = await owner.post('/purchase/consignment/statements').send({ supplierId: fancyWorld.id, storeId: MAIN, fromDate: monthStart(), toDate: today() }).expect(400);
    expect(again.body.message).toMatch(/already settled sales up to/);
    // A draft made before the first was billed cannot bill the same sales either.
    expect((await owner.post(`/purchase/consignment/statements/${early.id}/bill`).send({}).expect(400)).body.message).toMatch(/already settled sales up to/);
    expect((await owner.post(`/purchase/consignment/statements/${early.id}/cancel`).send({ reason: 'Duplicate' }).expect(200)).body.status).toBe('cancelled');
    // The bill cannot take a debit note: the statement is cancelled and made again instead.
    await owner.post(`/purchase/bills/${billId}/debit-note`).send({ reason: 'Price', lines: [{ originalLineId: (await prisma.supplierBillLine.findFirstOrThrow({ where: { billId } })).id, quantity: '1' }] }).expect(400);
  });

  it('lists: consignment stock by supplier and sold-but-not-settled amounts', async () => {
    let report = (await owner.get('/purchase/consignment/stock').expect(200)).body;
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ supplier: { id: fancyWorld.id }, heldQuantity: '10', heldValue: '3000.00', soldNotSettledQuantity: '0', soldNotSettledAmount: '0.00', owed: '3000.00' });
    expect(report.check).toMatchObject({ ok: true, ledger: '3000.00' });
    // One more sale: from the sale-or-return goods first, so ₹300.00 is now sold but not settled.
    await sell(handbag.id, '1', '599').expect(201);
    report = (await owner.get(`/purchase/consignment/stock?supplierId=${fancyWorld.id}`).expect(200)).body;
    expect(report.rows[0]).toMatchObject({ heldQuantity: '9', heldValue: '2700.00', soldNotSettledQuantity: '1', soldNotSettledAmount: '300.00', owed: '3000.00' });
    expect(report.rows[0].items).toMatchObject([{ item: { id: handbag.id }, heldQuantity: '9' }]);
  });

  it('cancelling a billed statement cancels its bill; the sold units are owed on consignment again', async () => {
    const cancelled = (await owner.post(`/purchase/consignment/statements/${statement.id}/cancel`).send({ reason: 'Wrong period' }).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'cancelled', bill: { id: billId, status: 'cancelled' } });
    expect(await roleBalance('consignment_payable')).toBe('5100.00');
    expect((await app.get(LedgerService).partyBalance(prisma, 'supplier', fancyWorld.id)).toFixed(2)).toBe('0.00');
    expect((await owner.get('/purchase/consignment/check').expect(200)).body.ok).toBe(true);
    // A new statement for the same period now settles all 8 sold.
    const fresh = (await owner.post('/purchase/consignment/statements').send({ supplierId: fancyWorld.id, storeId: MAIN, fromDate: monthStart(), toDate: today() }).expect(201)).body;
    expect(fresh.lines[0]).toMatchObject({ received: '20', sold: '8', returned: '3', held: '9', amount: '2400.00' });
    const billed = (await owner.post(`/purchase/consignment/statements/${fresh.id}/bill`).send({ supplierBillNo: 'FW/SOR/2' }).expect(200)).body;
    expect(billed.bill.total).toBe('2400.00');
    expect(await roleBalance('consignment_payable')).toBe('2700.00');
    expect((await owner.get('/purchase/consignment/check').expect(200)).body).toMatchObject({ ledger: '2700.00', ok: true });
    const list = (await owner.get(`/purchase/consignment/statements?supplierId=${fancyWorld.id}`).expect(200)).body;
    expect(list.map((s: { status: string }) => s.status).sort()).toEqual(['billed', 'cancelled', 'cancelled']);
  });
});
