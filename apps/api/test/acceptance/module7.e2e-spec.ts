// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 7".
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, Decimal } from 'shared';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftClientId: string;
let terms: Record<string, string>;
let supplierGroups: Record<string, string>;
let customerGroups: Record<string, string>;
let n = 0;

const today = () => businessDate();
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany(methods: string[] = ['CASH', 'CARD', 'UPI']) {
  owner = await setUpCompany(app, prisma);
  n = 0;
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  for (const [hsnCode, rate] of [['1006', '5'], ['3402', '18']]) await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: methods.map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  customerGroups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
}

async function item(name: string, hsnCode: string, price: string | null, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, ...extra }).expect(201)).body as { id: string; code: string };
  if (price) await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function opening(itemId: string, qty: string, cost: string, location = 'MAIN-FLOOR', store = MAIN) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: store, locationId: loc[location], lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

async function supplier(name: string) {
  return (await owner.post('/suppliers').send({ name, supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body as { id: string };
}

async function openShift(by: Agent, cash = '2000') {
  shiftClientId = randomUUID();
  return (await T(by.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: cash }] }).expect(201)).body;
}

function sale(lines: Record<string, unknown>[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
}

async function staff(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return { agent: a, id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

async function acct(key: string): Promise<string> {
  return (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
}

/** Debit minus credit of an account (optionally for one store), as "12.34". */
async function bal(key: string, store?: string): Promise<string> {
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: await acct(key), ...(store ? { storeId: store } : {}) }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

async function bankAccount(name = 'HDFC Current') {
  const tree = (await owner.get('/accounts').expect(200)).body;
  const folder = tree.accounts.find((a: { systemKey: string }) => a.systemKey === 'bank_group');
  return (await owner.post('/accounts').send({ parentId: folder.id, name, kind: 'bank' }).expect(201)).body.id as string;
}

/** 7.13: after every scenario the books agree with themselves and with stock. */
async function expectBooks() {
  const health = (await owner.get('/reports/book-health').expect(200)).body;
  expect(health.problems).toEqual([]);
  expect(health.totalDebit).toBe(health.totalCredit);
  const stock = (await owner.get('/reports/stock-vs-accounts').expect(200)).body;
  expect(stock.rows.filter((r: { difference: string }) => r.difference !== '0.00')).toEqual([]);
  const tb = (await owner.get(`/reports/trial-balance?from=2026-04-01&to=${today()}`).expect(200)).body;
  expect(tb.balanced).toBe(true);
}

describe('7.1 a till shift is posted when it closes (decision 39)', () => {
  let rice: { id: string };
  let bag: { id: string };
  beforeAll(async () => {
    await freshCompany();
    rice = await item('Loose Sona Masoori Rice', '1006', '62');
    bag = await item('Carry bag', '1006', '5', { isStockItem: false });
    await opening(rice.id, '250', '52');
  });
  afterAll(expectBooks);

  it('sale ₹186, exchange back ₹57, ₹9 short: one balanced entry for the bills and the drawer at zero', async () => {
    const shift = await openShift(owner);
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '3' }], [{ paymentMethodId: pm.CASH, amount: '200' }])).expect(201)).body.sale;
    const riceLine = first.lines.find((l: { item: { id: string } }) => l.item.id === rice.id);
    await T(owner.post('/pos/bills'))
      .send({
        clientId: randomUUID(),
        tillId,
        soldAt: new Date().toISOString(),
        ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: rice.id, quantity: '1', returnOfLineId: riceLine.id }] },
        sale: { number: num(), lines: [{ lineNo: 1, itemId: bag.id, quantity: '1' }] },
        payments: [{ paymentMethodId: pm.CASH, amount: '-57' }],
      })
      .expect(201);
    // Nothing from the till reaches the accounts before the shift closes.
    expect(await bal('sales', MAIN)).toBe('0.00');
    expect(await bal('cost_of_goods_sold', MAIN)).toBe('0.00');

    await T(owner.post(`/pos/shifts/${shift.id}/close`)).send({ denominations: { '500': 4, '100': 1, '20': 1 } }).expect(200);
    const entries = await prisma.ledgerEntry.findMany({ where: { documentType: 'pos_shift', documentId: shift.id }, include: { lines: true } });
    expect(entries).toHaveLength(2);
    expect(await bal('sales', MAIN)).toBe('-122.85');
    expect(await bal('gst_output_cgst')).toBe('-3.07');
    expect(await bal('gst_output_sgst')).toBe('-3.08');
    expect(await bal('cost_of_goods_sold', MAIN)).toBe('104.00');
    expect(await bal('cash_short_over', MAIN)).toBe('9.00');
    expect(await bal(`cash_in_till:${MAIN}`)).toBe('0.00');
    expect(await bal(`cash_in_hand:${MAIN}`)).toBe('120.00');
    // Stock: opening 250 × ₹52 less the 2 kg that left.
    expect(await bal('stock', MAIN)).toBe(new Decimal(248 * 52).toFixed(2));
    for (const e of entries) {
      const dr = e.lines.reduce((s, l) => s.add(l.debit.toString()), new Decimal(0));
      const cr = e.lines.reduce((s, l) => s.add(l.credit.toString()), new Decimal(0));
      expect(dr.toFixed(2)).toBe(cr.toFixed(2));
    }
    expect(entries.map((e) => e.id)).toContain((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).ledgerEntryId);
  });
});

describe('7.2 card and UPI; a card payout less commission', () => {
  beforeAll(async () => {
    await freshCompany();
  });
  afterAll(expectBooks);

  it('₹899 by card and UPI goes to the settlement accounts; the payout moves ₹491 to the bank and ₹9 to commission', async () => {
    const atta = await item('Aashirvaad Atta 10 kg', '1006', '899');
    await opening(atta.id, '10', '700');
    const shift = await openShift(owner, '0');
    await T(owner.post('/pos/bills'))
      .send(sale([{ itemId: atta.id, quantity: '1' }], [{ paymentMethodId: pm.CARD, amount: '500', reference: '482913' }, { paymentMethodId: pm.UPI, amount: '399', reference: 'UPI-77' }]))
      .expect(201);
    await T(owner.post(`/pos/shifts/${shift.id}/close`)).send({ denominations: {}, counted: [{ paymentMethodId: pm.CARD, amount: '500' }, { paymentMethodId: pm.UPI, amount: '399' }] }).expect(200);
    expect(await bal('card_settlement')).toBe('500.00');
    expect(await bal('upi_settlement')).toBe('399.00');
    expect(await bal(`cash_in_till:${MAIN}`)).toBe('0.00');

    const bank = await bankAccount();
    const payout = (
      await owner
        .post('/payments')
        .send({ kind: 'transfer', paymentDate: today(), storeId: MAIN, fromAccountId: await acct('card_settlement'), toAccountId: bank, amount: '500', deductions: [{ accountId: await acct('card_commission'), amount: '9' }] })
        .expect(201)
    ).body;
    const posted = (await owner.post(`/payments/${payout.id}/post`).expect(200)).body;
    expect(posted.number).toMatch(/^TRF-2026-27-/);
    expect(await bal('card_settlement')).toBe('0.00');
    const bankBal = await prisma.ledgerLine.aggregate({ where: { accountId: bank }, _sum: { debit: true } });
    expect(bankBal._sum.debit?.toFixed(2)).toBe('491.00');
    expect(await bal('card_commission', MAIN)).toBe('9.00');
  });
});

describe('7.3–7.4 buying and paying a supplier; 7.7 cancelling', () => {
  let smt: { id: string };
  let rice: { id: string };
  let receipt: { id: string; lines: { id: string }[] };
  let bill1: { id: string };
  let bank: string;
  beforeAll(async () => {
    await freshCompany();
    smt = await supplier('Sri Murugan Traders');
    rice = await item('Ponni Rice 1 kg', '1006', '70');
    bank = await bankAccount();
  });
  afterAll(expectBooks);

  it('7.3 the receipt and freight post to stock; the bill clears goods received not billed', async () => {
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, noOrderReason: 'Local purchase', lines: [{ itemId: rice.id, receivedQuantity: '10', rate: '100', gstRate: '5' }] }).expect(201)).body;
    receipt = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    expect(await bal('stock', MAIN)).toBe('1000.00');
    expect(await bal('goods_received_not_billed')).toBe('-1000.00');

    const charge = (await owner.post('/purchase/charges').send({ shareBy: 'value', receiptIds: [receipt.id], charges: [{ description: 'Lorry freight', chargeType: 'freight', amount: '100' }] }).expect(201)).body;
    await owner.post(`/purchase/charges/${charge.id}/finalise`).expect(200);
    expect(await bal('stock', MAIN)).toBe('1100.00');
    expect(await bal('freight_inward', MAIN)).toBe('-100.00');

    const billDraft = (
      await owner
        .post('/purchase/bills')
        .send({ kind: 'against_receipt', supplierId: smt.id, supplierBillNo: 'SMT/1', supplierBillDate: today(), lines: [{ receiptLineId: receipt.lines[0].id, itemId: rice.id, quantity: '10', rate: '102' }] })
        .expect(201)
    ).body;
    expect(billDraft).toMatchObject({ taxableAmount: '1020.00', total: '1071.00', priceDifference: '20.00' });
    bill1 = (await owner.post(`/purchase/bills/${billDraft.id}/finalise`).send({ confirmPriceDifference: true }).expect(200)).body;
    expect(await bal('goods_received_not_billed')).toBe('0.00');
    expect(await bal('purchase_price_difference', MAIN)).toBe('20.00');
    expect(new Decimal(await bal('gst_input_cgst')).add(await bal('gst_input_sgst')).toFixed(2)).toBe('51.00');
    expect(await bal('supplier_payable')).toBe('-1071.00');
    const view = (await owner.get(`/ledger/entries?documentType=supplier_bill&documentId=${bill1.id}`).expect(200)).body;
    expect(view).toHaveLength(1);
  });

  it('7.4 one payment settles two bills oldest first; the rest is an advance the next bill uses; a held supplier cannot be paid', async () => {
    const service = await item('Unloading charges', '1006', null, { isStockItem: false });
    const second = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: smt.id, supplierBillNo: 'SMT/2', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: service.id, quantity: '1', rate: '800', gstRate: '0' }] }).expect(201)).body;
    await owner.post(`/purchase/bills/${second.id}/finalise`).send({}).expect(200);

    // A bank payment needs its reference.
    await owner.post('/payments').send({ kind: 'payment', paymentDate: today(), partyType: 'supplier', partyId: smt.id, fromAccountId: bank, amount: '2000' }).expect(400);
    const pay = (await owner.post('/payments').send({ kind: 'payment', paymentDate: today(), partyType: 'supplier', partyId: smt.id, fromAccountId: bank, amount: '2000', reference: 'NEFT-1', referenceDate: today() }).expect(201)).body;
    expect(pay.allocations.map((a: { amount: string }) => a.amount).sort()).toEqual(['1071.00', '800.00']);
    const posted = (await owner.post(`/payments/${pay.id}/post`).expect(200)).body;
    expect(posted).toMatchObject({ status: 'posted', unused: '129.00' });
    let items = (await owner.get(`/parties/supplier/${smt.id}/open-items`).expect(200)).body;
    expect(items).toEqual([expect.objectContaining({ itemType: 'payment', owed: '-129.00' })]);
    expect(await bal('supplier_payable')).toBe('129.00');

    const third = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: smt.id, supplierBillNo: 'SMT/3', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: service.id, quantity: '1', rate: '300', gstRate: '0' }] }).expect(201)).body;
    await owner.post(`/purchase/bills/${third.id}/finalise`).send({}).expect(200);
    items = (await owner.post('/settlements').send({ partyType: 'supplier', partyId: smt.id, billType: 'supplier_bill', billId: third.id, byType: 'payment', byId: pay.id, amount: '129' }).expect(201)).body;
    expect(items.find((i: { itemId: string }) => i.itemId === third.id).owed).toBe('171.00');

    await prisma.supplier.update({ where: { id: smt.id }, data: { holdType: 'payments', holdReason: 'Quality dispute' } });
    expect((await owner.post('/payments').send({ kind: 'payment', paymentDate: today(), partyType: 'supplier', partyId: smt.id, fromAccountId: bank, amount: '171', reference: 'NEFT-2', referenceDate: today() }).expect(400)).body.message).toMatch(/on hold/);
    await prisma.supplier.update({ where: { id: smt.id }, data: { holdType: 'none', holdReason: null } });
  });

  it('7.7 cancelling a posted bill writes equal and opposite lines; the ledger refuses edits', async () => {
    const service = await item('Repairs', '1006', null, { isStockItem: false });
    const before = (await owner.get(`/reports/trial-balance?from=2026-04-01&to=${today()}`).expect(200)).body.totals;
    const b = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: smt.id, supplierBillNo: 'SMT/9', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: service.id, quantity: '1', rate: '500', gstRate: '18' }] }).expect(201)).body;
    await owner.post(`/purchase/bills/${b.id}/finalise`).send({}).expect(200);
    await owner.post(`/purchase/bills/${b.id}/cancel`).send({ reason: 'Entered twice' }).expect(200);
    const entries = await prisma.ledgerEntry.findMany({ where: { documentType: 'supplier_bill', documentId: b.id }, include: { lines: true } });
    expect(entries).toHaveLength(2);
    const reversal = entries.find((e) => e.cancelsId)!;
    expect(reversal.entryDate.toISOString().slice(0, 10)).toBe(entries.find((e) => !e.cancelsId)!.entryDate.toISOString().slice(0, 10));
    const after = (await owner.get(`/reports/trial-balance?from=2026-04-01&to=${today()}`).expect(200)).body.totals;
    expect(after.closingDebit).toBe(before.closingDebit);
    await expect(prisma.ledgerLine.updateMany({ where: { entryId: reversal.id }, data: { remark: 'changed' } })).rejects.toThrow();
    await expect(prisma.ledgerEntry.deleteMany({ where: { id: reversal.id } })).rejects.toThrow();
  });
});

describe('7.5 stock movements and 7.6 re-costing', () => {
  let rice: { id: string };
  beforeAll(async () => {
    await freshCompany();
    rice = await item('Basmati Rice 1 kg', '1006', '120');
    await opening(rice.id, '100', '90');
  });
  afterAll(expectBooks);

  it('7.5 transfer through goods in transit, damage to write-off, a count difference to stock adjustment', async () => {
    const send = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: ANNA, lines: [{ itemId: rice.id, quantity: '20' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${send.id}/finalise`).expect(200);
    expect(await bal('goods_in_transit')).toBe('1800.00');
    expect(await bal('stock', MAIN)).toBe('7200.00');
    expect(await bal('stock_transfer_clearing')).toBe('0.00');
    await owner.post(`/stock/transfers/${send.id}/receive`).send({}).expect(201);
    expect(await bal('goods_in_transit')).toBe('0.00');
    expect(await bal('stock', ANNA)).toBe('1800.00');

    const wo = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '2' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${wo.id}/finalise`).expect(200);
    expect(await bal('write_off', MAIN)).toBe('180.00');

    const count = (await owner.post('/stock/counts').send({ countType: 'normal', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, countedQuantity: '75' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    expect(await bal('stock_adjustment', MAIN)).toBe('270.00');
  });

  it('7.6 freight added after a write-off posts only the difference; earlier entries are unchanged', async () => {
    const smt = await supplier('Sri Murugan Traders');
    const dal = await item('Moong Dal 1 kg', '1006', '140');
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, noOrderReason: 'Local purchase', lines: [{ itemId: dal.id, receivedQuantity: '10', rate: '100', gstRate: '5' }] }).expect(201)).body;
    const receipt = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    const wo = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: dal.id, quantity: '4' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${wo.id}/finalise`).expect(200);
    const woBefore = await prisma.ledgerEntry.findMany({ where: { documentId: wo.id }, include: { lines: true } });
    const writeOff = new Decimal(await bal('write_off', MAIN));

    const charge = (await owner.post('/purchase/charges').send({ shareBy: 'value', receiptIds: [receipt.id], charges: [{ description: 'Freight', chargeType: 'freight', amount: '100' }] }).expect(201)).body;
    await owner.post(`/purchase/charges/${charge.id}/finalise`).expect(200);
    expect(new Decimal(await bal('write_off', MAIN)).sub(writeOff).toFixed(2)).toBe('40.00');
    expect(await bal('freight_inward', MAIN)).toBe('-100.00');
    const woAfter = await prisma.ledgerEntry.findMany({ where: { documentId: wo.id }, include: { lines: true } });
    // The write-off's own entry is untouched; the correction is a new entry.
    expect(woAfter.find((e) => e.id === woBefore[0].id)!.lines).toEqual(woBefore[0].lines);
    expect(woAfter.length).toBe(woBefore.length + 1);
  });
});

describe('7.8 locked books, 7.9 journals', () => {
  let accountant: Agent;
  let manager: Agent;
  beforeAll(async () => {
    await freshCompany();
    accountant = (await staff('Ravi', 'ravi@rademics.test', 'accountant')).agent;
    manager = (await staff('Priya', 'priya@rademics.test', 'store_manager')).agent;
    await owner.get('/accounts').expect(200);
  });
  afterAll(expectBooks);

  const pettyCash = async (date: string) => ({
    kind: 'cash',
    journalDate: date,
    remark: 'Electricity bill paid in cash',
    lines: [
      { accountId: await acct('electricity'), storeId: MAIN, debit: '450' },
      { accountId: await acct(`cash_in_hand:${MAIN}`), storeId: MAIN, credit: '450' },
    ],
  });

  it('7.8 after locking to 30 September a store manager is refused on that date; the Accountant is not', async () => {
    await owner.patch('/accounting/lock-date').send({ lockDate: '2026-09-30', reason: 'September closed' }).expect(200);
    await manager.patch('/accounting/lock-date').send({ lockDate: null, reason: 'x' }).expect(403);
    const j = (await manager.post('/journals').send(await pettyCash('2026-09-30')).expect(201)).body;
    expect((await manager.post(`/journals/${j.id}/post`).expect(400)).body.message).toMatch(/locked up to 2026-09-30/);
    const k = (await accountant.post('/journals').send(await pettyCash('2026-09-30')).expect(201)).body;
    expect((await accountant.post(`/journals/${k.id}/post`).expect(200)).body).toMatchObject({ status: 'posted', number: expect.stringMatching(/^JV-2026-27-/) });
    // Store managers can only make cash journals.
    await manager.post('/journals').send({ ...(await pettyCash(today())), kind: 'general' }).expect(403);
  });

  it('7.9 an unbalanced journal, a supplier line without a supplier, an income line without a store and over-settling are refused', async () => {
    const cash = await acct(`cash_in_hand:${MAIN}`);
    await accountant.post('/journals').send({ journalDate: today(), lines: [{ accountId: cash, storeId: MAIN, debit: '100.06' }, { accountId: await acct('other_income'), storeId: MAIN, credit: '100' }] }).expect(400);
    await accountant.post('/journals').send({ journalDate: today(), lines: [{ accountId: cash, storeId: MAIN, debit: '100' }, { accountId: await acct('supplier_payable'), credit: '100' }] }).expect(400);
    await accountant.post('/journals').send({ journalDate: today(), lines: [{ accountId: cash, storeId: MAIN, debit: '100' }, { accountId: await acct('other_income'), credit: '100' }] }).expect(400);
    const smt = await supplier('Sri Murugan Traders');
    const service = await item('Repairs', '1006', null, { isStockItem: false });
    const b = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: smt.id, supplierBillNo: 'R/1', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: service.id, quantity: '1', rate: '300', gstRate: '0' }] }).expect(201)).body;
    await owner.post(`/purchase/bills/${b.id}/finalise`).send({}).expect(200);
    const over = { journalDate: today(), kind: 'contra', lines: [{ accountId: await acct('supplier_payable'), partyType: 'supplier', partyId: smt.id, debit: '400', againstType: 'supplier_bill', againstId: b.id }, { accountId: cash, storeId: MAIN, credit: '400' }] };
    expect((await accountant.post('/journals').send(over).expect(400)).body.message).toMatch(/owes only ₹300.00/);
    const ok = (await accountant.post('/journals').send({ ...over, lines: [{ ...over.lines[0], debit: '300' }, { ...over.lines[1], credit: '300' }] }).expect(201)).body;
    await accountant.post(`/journals/${ok.id}/post`).expect(200);
    expect((await owner.get(`/parties/supplier/${smt.id}/open-items`).expect(200)).body).toEqual([]);
    // Cancelling the journal makes the bill owed again.
    await accountant.post(`/journals/${ok.id}/cancel`).send({ reason: 'Paid by cheque instead' }).expect(200);
    expect((await owner.get(`/parties/supplier/${smt.id}/open-items`).expect(200)).body).toEqual([expect.objectContaining({ itemId: b.id, owed: '300.00' })]);
  });
});

describe('7.10 opening balances', () => {
  beforeAll(async () => {
    await freshCompany();
  });
  afterAll(expectBooks);

  it('an opening journal, two opening customer bills and opening stock leave the temporary opening account at zero', async () => {
    const rice = await item('Basmati Rice 1 kg', '1006', '120');
    await opening(rice.id, '10', '50');
    const c = (await owner.post('/customers').send({ name: 'Lakshmi Stores', customerGroupId: customerGroups.RETAIL, mobile: '9840011223' }).expect(201)).body;
    await owner.post('/financial-years').send({ startDate: '2025-04-01', endDate: '2026-03-31' }).expect(201);
    const j = (
      await owner
        .post('/journals')
        .send({
          kind: 'opening',
          journalDate: '2026-03-31',
          lines: [
            { accountId: await acct(`cash_in_hand:${MAIN}`), storeId: MAIN, debit: '5000' },
            { accountId: await acct('temporary_opening'), debit: '2500' },
            { accountId: await acct('capital'), credit: '7500' },
          ],
        })
        .expect(201)
    ).body;
    await owner.post(`/journals/${j.id}/post`).expect(200);
    await owner.post('/opening-bills').send({ partyType: 'customer', partyId: c.id, billNumber: 'OLD/101', billDate: '2026-08-01', dueDate: '2026-08-01', amount: '1200' }).expect(201);
    await owner.post('/opening-bills').send({ partyType: 'customer', partyId: c.id, billNumber: 'OLD/102', billDate: '2026-09-20', dueDate: '2026-09-20', amount: '800' }).expect(201);
    expect((await owner.get('/accounting/opening-check').expect(200)).body).toMatchObject({ ok: true, difference: '0.00' });
    const ageing = (await owner.get(`/reports/ageing?asOf=2026-10-15&partyType=customer`).expect(200)).body;
    expect(ageing.rows[0]).toMatchObject({ name: 'Lakshmi Stores', owed: '2000.00' });
    expect(ageing.rows[0].bands).toMatchObject({ '61–90': '1200.00', '0–30': '800.00' });
  });
});

describe('7.11 year-end closing', () => {
  let fy2526: string;
  beforeAll(async () => {
    await freshCompany();
    fy2526 = (await owner.post('/financial-years').send({ startDate: '2025-04-01', endDate: '2026-03-31' }).expect(201)).body.id;
    await owner.get('/accounts').expect(200);
  });
  afterAll(expectBooks);

  it('income and expenses start the new year at zero; retained earnings take the profit; the closed year is refused until the closing is cancelled', async () => {
    const cash = await acct(`cash_in_hand:${MAIN}`);
    const post = async (date: string, lines: Record<string, unknown>[], status = 200) => {
      const j = (await owner.post('/journals').send({ journalDate: date, lines }).expect(201)).body;
      return owner.post(`/journals/${j.id}/post`).expect(status);
    };
    await post('2026-02-10', [{ accountId: cash, storeId: MAIN, debit: '1000' }, { accountId: await acct('other_income'), storeId: MAIN, credit: '1000' }]);
    await post('2026-03-05', [{ accountId: await acct('rent'), storeId: MAIN, debit: '300' }, { accountId: cash, storeId: MAIN, credit: '300' }]);
    const pl = (await owner.get('/reports/profit-and-loss?from=2025-04-01&to=2026-03-31').expect(200)).body;
    expect(pl.netTotal).toBe('700.00');

    // Plan 11 A10: the year's books must be locked to its last day first.
    expect((await owner.post('/year-end-closings').send({ financialYearId: fy2526, closingAccountId: await acct('retained_earnings') }).expect(400)).body.message).toMatch(/Lock the books up to 2026-03-31/);
    await owner.patch('/accounting/lock-date').send({ lockDate: '2026-03-31', reason: 'Year end' }).expect(200);
    const closing = (await owner.post('/year-end-closings').send({ financialYearId: fy2526, closingAccountId: await acct('retained_earnings') }).expect(201)).body;
    expect(await bal('other_income', MAIN)).toBe('0.00');
    expect(await bal('rent', MAIN)).toBe('0.00');
    expect(await bal('retained_earnings', MAIN)).toBe('-700.00');
    // The year's own profit and loss still shows its figures.
    expect((await owner.get('/reports/profit-and-loss?from=2025-04-01&to=2026-03-31').expect(200)).body.netTotal).toBe('700.00');
    expect((await post('2026-03-31', [{ accountId: cash, storeId: MAIN, debit: '10' }, { accountId: await acct('other_income'), storeId: MAIN, credit: '10' }], 400)).body.message).toMatch(/closed/);
    await owner.post(`/year-end-closings/${closing.id}/cancel`).send({ reason: 'A late bill' }).expect(200);
    await post('2026-03-31', [{ accountId: cash, storeId: MAIN, debit: '10' }, { accountId: await acct('other_income'), storeId: MAIN, credit: '10' }]);
    expect(await bal('retained_earnings', MAIN)).toBe('0.00');
  });
});

describe('7.12 credit sale at the till (decision 22)', () => {
  let rice: { id: string };
  let customer: { id: string };
  let managerId: string;
  beforeAll(async () => {
    await freshCompany(['CASH', 'ACCOUNT']);
    rice = await item('Ponni Rice 25 kg', '1006', '100');
    await opening(rice.id, '100', '80');
    customer = (await owner.post('/customers').send({ name: 'Hotel Saravana', customerGroupId: customerGroups.RETAIL, mobile: '9840055667' }).expect(201)).body;
    await prisma.customer.update({ where: { id: customer.id }, data: { creditLimit: '5000', paymentTermsId: terms.NET30 } });
    await owner.post('/opening-bills').send({ partyType: 'customer', partyId: customer.id, billNumber: 'OLD/7', billDate: '2026-10-01', dueDate: '2026-10-31', amount: '4500' }).expect(201);
    const m = await staff('Priya', 'priya@rademics.test', 'store_manager');
    managerId = m.id;
    await m.agent.post('/pos/pin').send({ pin: '7391', currentPassword: 'Own-pass-12345' }).expect(200);
    await openShift(owner);
  });
  afterAll(expectBooks);

  it('₹400 on account is accepted; ₹200 more needs a manager and is logged; walk-in and offline cannot use it; the receipt settles oldest first', async () => {
    const onAccount = (amount: string) => [{ paymentMethodId: pm.ACCOUNT, amount }];
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '4' }], onAccount('400'), { customerId: customer.id })).expect(201)).body;
    expect(first.sale.total).toBe('400.00');
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '2' }], onAccount('200'), { customerId: customer.id })).expect(403)).body.message).toMatch(/Over the credit limit/);
    n--;
    const { token } = (await owner.post('/pos/approvals').send({ tillId, managerId, pin: '7391', action: 'credit_over_limit' }).expect(200)).body;
    const over = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '2' }], onAccount('200'), { customerId: customer.id, creditApprovalToken: token })).expect(201)).body;
    expect(over.sale.checkFlags).toContain('credit_override');
    await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], onAccount('100'))).expect(400);
    n--;
    await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], onAccount('100'), { customerId: customer.id, offline: true, shiftClientId })).expect(400);
    n--;

    const shift = (await owner.get(`/pos/till/${tillId}/shift`).expect(200)).body;
    await T(owner.post(`/pos/shifts/${shift.id}/close`)).send({ denominations: { '500': 4 } }).expect(200);
    expect(await bal('customer_receivable')).toBe('5100.00');
    const items = (await owner.get(`/parties/customer/${customer.id}/open-items`).expect(200)).body;
    expect(items.map((i: { owed: string }) => i.owed)).toEqual(['4500.00', '400.00', '200.00']);

    const cash = await acct(`cash_in_hand:${MAIN}`);
    const receipt = (await owner.post('/payments').send({ kind: 'receipt', paymentDate: today(), partyType: 'customer', partyId: customer.id, toAccountId: cash, storeId: MAIN, amount: '4900' }).expect(201)).body;
    await owner.post(`/payments/${receipt.id}/post`).expect(200);
    const statement = (await owner.get(`/reports/party-statement/customer/${customer.id}`).expect(200)).body;
    expect(statement.closing).toBe('200.00');
    expect(statement.openItems).toEqual([expect.objectContaining({ itemId: over.sale.id, owed: '200.00' })]);
    const ageing = (await owner.get(`/reports/ageing?asOf=${today()}&partyType=customer`).expect(200)).body;
    expect(ageing.rows[0]).toMatchObject({ owed: '200.00', net: '200.00' });
  });
});
