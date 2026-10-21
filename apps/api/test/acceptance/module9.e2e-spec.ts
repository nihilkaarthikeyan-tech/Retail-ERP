// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 9".
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, Decimal } from 'shared';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { MailerService } from '../../src/reports/mailer.service.js';
import { SummaryEmailService } from '../../src/reports/summary-email.service.js';
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
let terms: Record<string, string>;
let supplierGroups: Record<string, string>;
const tills: Record<string, { id: string; token: string; prefix: string; n: number }> = {};

const today = () => businessDate();

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '1006', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  await till('T1', MAIN, 'MAIN-FLOOR', 'MAIN');
}

async function till(code: string, store: string, location: string, _storeCode: string) {
  const t = (
    await owner
      .post('/pos/tills')
      .send({ storeId: store, code, name: `Counter ${code}`, locationId: loc[location], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] })
      .expect(201)
  ).body;
  const token = (await owner.post(`/pos/tills/${t.id}/register`).send({ deviceName: `${code} PC` }).expect(201)).body.token;
  tills[code] = { id: t.id, token, prefix: `${t.numberPrefix}/2627/`, n: 0 };
}

/** Prices include 5% GST, so ₹105 is ₹100 before GST. */
async function item(name: string, price: string, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '1006', maxDiscountPercent: '15', ...extra }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function opening(itemId: string, q: string, cost: string, location = 'MAIN-FLOOR', store = MAIN) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: store, locationId: loc[location], lines: [{ itemId, countedQuantity: q, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

async function receive(itemId: string, q: string, rate: string) {
  const s = (await owner.post('/suppliers').send({ name: `Supplier ${randomUUID().slice(0, 6)}`, supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body;
  const d = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: s.id, noOrderReason: 'Local purchase', lines: [{ itemId, receivedQuantity: q, rate, gstRate: '5' }] }).expect(201)).body;
  return (await owner.post(`/purchase/receipts/${d.id}/finalise`).expect(200)).body as { id: string };
}

async function openShift(code = 'T1', cash = '0') {
  const t = tills[code];
  return (await owner.post('/pos/shifts').set('x-till-token', t.token).send({ clientId: randomUUID(), tillId: t.id, cash: [{ paymentMethodId: pm.CASH, amount: cash }] }).expect(201)).body as { id: string };
}

async function sell(lines: Record<string, unknown>[], total: string, code = 'T1', extra: Record<string, unknown> = {}) {
  const t = tills[code];
  const body = { clientId: randomUUID(), tillId: t.id, soldAt: new Date().toISOString(), sale: { number: `${t.prefix}${String(++t.n).padStart(6, '0')}`, lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount: total }], ...extra };
  const res = await owner.post('/pos/bills').set('x-till-token', t.token).send(body);
  if (res.status !== 201) throw new Error(`Sale refused: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.sale as { id: string; total: string; lines: { id: string; item: { id: string } }[] };
}

async function closeShift(shiftId: string, counted: Record<string, number>, code = 'T1') {
  await owner.post(`/pos/shifts/${shiftId}/close`).set('x-till-token', tills[code].token).send({ denominations: counted }).expect(200);
}

async function staff(firstName: string, email: string, role: string, stores = [MAIN]) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: stores }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return { agent: a, id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

describe('9.1 daily sales by store, 9.8 store limits', () => {
  let rice: { id: string };
  beforeAll(async () => {
    await freshCompany();
    await till('T2', ANNA, 'ANNA-FLOOR', 'ANNA');
    rice = await item('Ponni Rice 1 kg', '105');
    await opening(rice.id, '100', '60');
    await opening(rice.id, '100', '60', 'ANNA-FLOOR', ANNA);
    await openShift('T1');
    await openShift('T2');
    const first = await sell([{ itemId: rice.id, quantity: '3' }], '315');
    await sell([{ itemId: rice.id, quantity: '3' }], '315');
    await sell([{ itemId: rice.id, quantity: '4' }], '420');
    await sell([{ itemId: rice.id, quantity: '5' }], '525', 'T2');
    // A return of 2 the same day: it reduces net sales but is not a bill.
    const t = tills.T1;
    await owner
      .post('/pos/bills')
      .set('x-till-token', t.token)
      .send({ clientId: randomUUID(), tillId: t.id, soldAt: new Date().toISOString(), ret: { number: `${t.prefix}${String(++t.n).padStart(6, '0')}`, returnOfId: first.id, lines: [{ lineNo: 1, itemId: rice.id, quantity: '2', returnOfLineId: first.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-210' }] })
      .expect(201);
  });

  it('MAIN 3 bills worth ₹1,000 less a ₹200 return; ANNA 1 bill of ₹500', async () => {
    const r = (await owner.get(`/reports/daily-sales?from=${today()}&to=${today()}`).expect(200)).body;
    const main = r.rows.find((x: { storeId: string }) => x.storeId === MAIN);
    const anna = r.rows.find((x: { storeId: string }) => x.storeId === ANNA);
    expect(main).toMatchObject({ saleBills: 3, returnBills: 1, grossSales: '1000.00', returns: '-200.00', netSales: '800.00', averageBill: '266.67', quantity: '10' });
    expect(anna).toMatchObject({ saleBills: 1, netSales: '500.00', averageBill: '500.00' });
    expect(r.totals).toMatchObject({ saleBills: 4, netSales: '1300.00', tax: '65.00' });
    expect(main.cost).toBe('480.00');
  });

  it('9.8 a store manager of MAIN sees only MAIN, and the totals are MAIN’s own', async () => {
    const m = await staff('Priya', 'priya@rademics.test', 'store_manager');
    const r = (await m.agent.get(`/reports/daily-sales?from=${today()}&to=${today()}`).expect(200)).body;
    expect(r.rows.map((x: { storeId: string }) => x.storeId)).toEqual([MAIN]);
    expect(r.totals.netSales).toBe('800.00');
    await m.agent.get(`/reports/daily-sales?storeId=${ANNA}`).expect(403);
    const d = (await m.agent.get('/dashboards/store').expect(200)).body;
    expect(d.tiles.find((t: { key: string }) => t.key === 'sales_today').value).toBe('800.00');
    const items = (await m.agent.get(`/reports/item-sales?from=${today()}&to=${today()}`).expect(200)).body;
    expect(items.totals.netSales).toBe('800.00');
    expect((await m.agent.get('/dashboards').expect(200)).body.dashboards).not.toContain('owner');
  });
});

describe('9.2 best sellers and gross profit, 9.9 dashboards agree with reports', () => {
  let atta: { id: string };
  let dal: { id: string };
  let moong: { id: string };
  beforeAll(async () => {
    await freshCompany();
    atta = await item('Atta 1 kg', '210');
    dal = await item('Toor Dal 1 kg', '105');
    moong = await item('Moong Dal 1 kg', '157.50');
    await opening(atta.id, '50', '100');
    await opening(dal.id, '50', '90');
  });

  it('ranks by quantity, sales and margin; freight added after the sale lowers the margin as in the accounts; a cashier sees none of it', async () => {
    const receipt = await receive(moong.id, '10', '105');
    const shift = await openShift();
    await sell([{ itemId: atta.id, quantity: '2' }], '420');
    await sell([{ itemId: dal.id, quantity: '7' }], '735');
    await sell([{ itemId: moong.id, quantity: '4' }], '630');
    await closeShift(shift.id, { '500': 3, '200': 1, '50': 1, '20': 1, '10': 1, '5': 1 });

    const by = async (rankBy: string, worst = false) => (await owner.get(`/reports/best-sellers?from=${today()}&to=${today()}&rankBy=${rankBy}${worst ? '&worst=true' : ''}`).expect(200)).body.rows.map((r: { key: string }) => r.key);
    expect(await by('quantity')).toEqual([dal.id, moong.id, atta.id]);
    expect(await by('sales')).toEqual([dal.id, moong.id, atta.id]);
    expect(await by('margin')).toEqual([atta.id, moong.id, dal.id]);
    expect(await by('margin', true)).toEqual([dal.id, moong.id, atta.id]);

    const charge = (await owner.post('/purchase/charges').send({ shareBy: 'value', receiptIds: [receipt.id], charges: [{ description: 'Freight', chargeType: 'freight', amount: '100' }] }).expect(201)).body;
    await owner.post(`/purchase/charges/${charge.id}/finalise`).expect(200);
    const gp = (await owner.get(`/reports/gross-profit?from=${today()}&to=${today()}&groupBy=item`).expect(200)).body;
    expect(gp.rows.find((r: { key: string }) => r.key === moong.id)).toMatchObject({ netSales: '600.00', cost: '460.00', grossProfit: '140.00', marginPercent: '23.33' });
    // The report's cost of goods sold equals the accounts.
    const cogs = await prisma.ledgerLine.aggregate({ where: { account: { systemKey: 'cost_of_goods_sold' } }, _sum: { debit: true, credit: true } });
    expect(gp.totals.cost).toBe(new Decimal(cogs._sum.debit!.toString()).sub(cogs._sum.credit!.toString()).toFixed(2));

    const cashier = await staff('Arun', 'arun@rademics.test', 'cashier');
    await cashier.agent.get(`/reports/gross-profit?from=${today()}&to=${today()}`).expect(403);
    await cashier.agent.get(`/reports/best-sellers?from=${today()}&to=${today()}`).expect(403);
  });

  it('9.9 today’s sales tile equals the daily sales report; month-to-date margin equals the gross profit report', async () => {
    const daily = (await owner.get(`/reports/daily-sales?from=${today()}&to=${today()}`).expect(200)).body;
    const store = (await owner.get('/dashboards/store').expect(200)).body;
    expect(store.tiles.find((t: { key: string }) => t.key === 'sales_today').value).toBe(daily.totals.netSales);
    const monthStart = `${today().slice(0, 7)}-01`;
    const gp = (await owner.get(`/reports/gross-profit?from=${monthStart}&to=${today()}&groupBy=store`).expect(200)).body;
    const ownerDash = (await owner.get('/dashboards/owner').expect(200)).body;
    expect(ownerDash.tiles.find((t: { key: string }) => t.key === 'margin_mtd').value).toBe(gp.totals.marginPercent);
    expect(ownerDash.tiles.find((t: { key: string }) => t.key === 'sales_mtd').value).toBe(gp.totals.netSales);
    for (const d of ['purchasing', 'accounts']) await owner.get(`/dashboards/${d}`).expect(200);
  });
});

describe('9.3 discounts given', () => {
  it('a manual 5%, a manager-approved 12% and an offer each show, with who approved', async () => {
    await freshCompany();
    const oils = (await owner.post('/catalogue/item-groups').send({ code: 'OIL', name: 'Oils' }).expect(201)).body.id;
    const soap = await item('Dove Soap', '105');
    const oil = await item('Sunflower Oil 1 L', '210', { itemGroupId: oils });
    await opening(soap.id, '50', '60');
    await opening(oil.id, '50', '150');
    await owner.post('/pos/offers').send({ code: 'OIL10', name: '10% off oils', kind: 'percent', value: '10', appliesTo: 'groups', targetIds: [oils], startDate: '2026-04-01' }).expect(201);
    const m = await staff('Priya', 'priya@rademics.test', 'store_manager');
    await m.agent.post('/pos/pin').send({ pin: '7391', currentPassword: 'Own-pass-12345' }).expect(200);
    await openShift();
    await sell([{ itemId: soap.id, quantity: '1', discountPercent: '5' }], '100');
    const { token } = (await owner.post('/pos/approvals').send({ tillId: tills.T1.id, managerId: m.id, pin: '7391', action: 'discount' }).expect(200)).body;
    await sell([{ itemId: soap.id, quantity: '1', discountPercent: '12', approvalToken: token }], '100');
    await sell([{ itemId: oil.id, quantity: '1' }], '189');
    const r = (await owner.get(`/reports/discounts?from=${today()}&to=${today()}`).expect(200)).body;
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ discountPercent: '5.00', lineAndBillDiscount: '5.25', approvedBy: null });
    expect(r.rows[1]).toMatchObject({ discountPercent: '12.00', lineAndBillDiscount: '12.60', approvedBy: 'Priya' });
    expect(r.rows[2]).toMatchObject({ offer: '10% off oils', offerDiscount: '21.00' });
    expect(r.totals).toMatchObject({ lineAndBillDiscounts: '17.85', offers: '21.00', all: '38.85' });
  });
});

describe('9.4 stock cover and sell-through, 9.5 stock age', () => {
  beforeAll(freshCompany);

  it('60 in stock after selling 90 over 30 days leaves 20 days; 150 came in, so sell-through is 60%', async () => {
    const rice = await item('Sona Rice 1 kg', '105');
    await opening(rice.id, '100', '60');
    await receive(rice.id, '50', '62');
    await openShift();
    await sell([{ itemId: rice.id, quantity: '90' }], '9450');
    const r = (await owner.get(`/reports/stock-cover?days=30&itemId=${rice.id}`).expect(200)).body;
    expect(r.rows).toEqual([expect.objectContaining({ itemId: rice.id, onHand: '60', sold: '90', perDay: '3', daysLeft: '20.0', cameIn: '150', sellThroughPercent: '60.00' })]);
  });

  it('ages the stock on hand from the receipts it came from', async () => {
    const dal = await item('Urad Dal 1 kg', '105');
    await receive(dal.id, '40', '80');
    await receive(dal.id, '20', '80');
    await sell([{ itemId: dal.id, quantity: '30' }], '3150');
    const now = (await owner.get(`/reports/stock-age?itemId=${dal.id}`).expect(200)).body;
    expect(now.rows[0]).toMatchObject({ onHand: '30', value: '2400.00' });
    expect(now.rows[0].bands['0–30']).toEqual({ quantity: '30', value: '2400.00' });
    const later = (await owner.get(`/reports/stock-age?itemId=${dal.id}&asOf=${addDays(today(), 100)}`).expect(200)).body;
    expect(later.rows[0].bands['91–180'].quantity).toBe('30');
    expect(later.rows[0].bands['0–30'].quantity).toBe('0');
  });
});

describe('9.6 stock variance and loss', () => {
  it('₹180 damage and a ₹270 count shortfall against ₹9,000 sales is ₹450, 5.00%', async () => {
    await freshCompany();
    const rice = await item('Basmati Rice 1 kg', '105');
    await opening(rice.id, '100', '90');
    await openShift();
    await sell([{ itemId: rice.id, quantity: '90' }], '9450');
    const wo = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '2' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${wo.id}/finalise`).expect(200);
    const count = (await owner.post('/stock/counts').send({ countType: 'normal', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, countedQuantity: '5' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    const r = (await owner.get(`/reports/shrinkage?from=${today()}&to=${today()}`).expect(200)).body;
    expect(r.totals).toEqual({ loss: '450.00', netSales: '9000.00', shrinkagePercent: '5.00' });
    expect(r.byReason.find((b: { reason: string }) => b.reason === 'Damaged').value).toBe('180.00');
    expect(r.byReason.find((b: { reason: string }) => b.reason === 'Stock count shortfall').value).toBe('270.00');
  });
});

describe('9.7 cash position and cash flow', () => {
  it('opening + trading + investing + financing = closing; cash taken to the bank is in none of them', async () => {
    await freshCompany();
    const rice = await item('Ponni Rice 1 kg', '105');
    await opening(rice.id, '20', '60');
    const shift = await openShift();
    await sell([{ itemId: rice.id, quantity: '10' }], '1050');
    await closeShift(shift.id, { '500': 2, '50': 1 });
    const tree = (await owner.get('/accounts').expect(200)).body.accounts as { id: string; systemKey: string | null }[];
    const key = (k: string) => tree.find((a) => a.systemKey === k)!.id;
    const bank = (await owner.post('/accounts').send({ parentId: key('bank_group'), name: 'HDFC Current', kind: 'bank' }).expect(201)).body.id;
    const equipment = (await owner.post('/accounts').send({ parentId: key('fixed_assets'), name: 'Shop fittings', kind: 'other' }).expect(201)).body.id;
    const cash = key(`cash_in_hand:${MAIN}`);
    const journal = async (lines: Record<string, unknown>[]) => {
      const j = (await owner.post('/journals').send({ journalDate: today(), reference: 'R1', referenceDate: today(), lines }).expect(201)).body;
      await owner.post(`/journals/${j.id}/post`).expect(200);
    };
    await journal([{ accountId: bank, debit: '5000' }, { accountId: key('capital'), credit: '5000' }]);
    await journal([{ accountId: equipment, debit: '2000' }, { accountId: bank, credit: '2000' }]);
    const deposit = (await owner.post('/payments').send({ kind: 'transfer', paymentDate: today(), storeId: MAIN, fromAccountId: cash, toAccountId: bank, amount: '1000' }).expect(201)).body;
    await owner.post(`/payments/${deposit.id}/post`).expect(200);

    const pos = (await owner.get(`/reports/cash-position?asOf=${today()}`).expect(200)).body;
    expect(pos.total).toBe('4050.00');
    expect(pos.rows.find((r: { accountId: string }) => r.accountId === bank).balance).toBe('4000.00');
    const monthStart = `${today().slice(0, 7)}-01`;
    const flow = (await owner.get(`/reports/cash-flow?from=${monthStart}&to=${today()}`).expect(200)).body;
    expect(flow).toMatchObject({ opening: '0.00', closing: '4050.00', netChange: '4050.00', agrees: true });
    expect(flow.trading.total).toBe('1050.00');
    expect(flow.investing.total).toBe('-2000.00');
    expect(flow.financing.total).toBe('5000.00');
    expect(flow.transfers.total).toBe('0.00');
  });
});

describe('9.10 daily summary email, 9.11 downloads recorded', () => {
  beforeAll(freshCompany);

  it('sent once a day to active recipients, with the figures; a failure is recorded', async () => {
    const rice = await item('Ponni Rice 1 kg', '105');
    await opening(rice.id, '20', '60');
    await openShift();
    await sell([{ itemId: rice.id, quantity: '2' }], '210');
    const active = await staff('Meena', 'meena@rademics.test', 'accountant');
    const off = await staff('Ravi', 'ravi@rademics.test', 'accountant');
    await prisma.user.update({ where: { id: off.id }, data: { active: false } });
    const ownerId = (await owner.get('/auth/me').expect(200)).body.id;
    await active.agent.get('/summary-email/settings').expect(403);
    await owner.put('/summary-email/settings').send({ enabled: true, sendAt: '00:00', recipientIds: [ownerId, active.id, off.id], figures: ['sales_by_store', 'month_to_date', 'cash_and_bank', 'dues'] }).expect(200);

    const mailer = app.get(MailerService);
    mailer.outbox.length = 0;
    const service = app.get(SummaryEmailService);
    // Late in the evening (Indian time) so the email covers today.
    const evening = new Date(`${today()}T17:00:00Z`);
    expect(await service.tick(evening)).toBe(1);
    expect(await service.tick(evening)).toBe(0);
    expect(mailer.outbox).toHaveLength(1);
    const mail = mailer.outbox[0];
    expect(mail.to.sort()).toEqual(['meena@rademics.test', 'owner@rademics.test']);
    expect(mail.subject).toContain(`daily summary for ${today()}`);
    expect(mail.text).toContain('₹200.00 from 1 bills');
    expect(mail.text).toContain('This month so far');

    const send = mailer.send.bind(mailer);
    mailer.send = async () => {
      throw new Error('Mail server refused the login');
    };
    try {
      await owner.post('/summary-email/test').expect(200);
    } finally {
      mailer.send = send;
    }
    const runs = (await owner.get('/summary-email/runs').expect(200)).body;
    expect(runs[0]).toMatchObject({ kind: 'test', error: 'Mail server refused the login', sentAt: null });
    expect(runs.find((r: { kind: string }) => r.kind === 'scheduled')).toMatchObject({ businessDate: today(), error: null });
  });

  it('9.11 a download is recorded in the history with the report and filters', async () => {
    await owner.post('/reports/export-log').send({ report: 'Daily sales by store', filters: { from: today(), to: today() }, rows: 2 }).expect(204);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'export' }, orderBy: { at: 'desc' } });
    expect(row.changes).toMatchObject({ report: 'Daily sales by store', filters: { from: today(), to: today() }, rows: 2 });
  });
});
