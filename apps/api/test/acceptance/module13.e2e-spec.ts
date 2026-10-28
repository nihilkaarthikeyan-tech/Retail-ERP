// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 13":
// 13.1–13.4 loyalty points, 13.5–13.7 gift cards, with the exact amounts; plus
// the accounts reaching existing companies, the module switches and the rights.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, Decimal, giftCardExpiresOn, isValidGiftCardNumber, normaliseGiftCardNumber } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { AccountingSetup } from '../../src/ledger/accounting-setup.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { invalidateModuleCache } from '../../src/modules/module-map.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let ownerId: string;
let customerGroups: Record<string, string>;
let n = 0;

const today = () => businessDate();
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = <R extends { set: (k: string, v: string) => R }>(r: R) => r.set('x-till-token', tillToken);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  invalidateModuleCache();
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'ETHNIC', name: 'Ethnic wear' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: ['CASH', 'UPI'].map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
  customerGroups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
}

async function item(name: string, price: string) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6205' }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  // Opening stock at 60% of the price, so the till knows the cost.
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: i.id, countedQuantity: '100', unitCost: new Decimal(price).mul('0.6').toFixed(2) }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  return i;
}

async function customer(name: string, mobile: string) {
  return (await owner.post('/customers').send({ name, customerGroupId: customerGroups.RETAIL, mobile }).expect(201)).body as { id: string; code: string };
}

async function openShift(cash = '2000') {
  return (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: cash }] }).expect(201)).body as { id: string };
}

async function expectedCash() {
  const expected = (await T(owner.get(`/pos/till/${tillId}/shift`)).expect(200)).body.expected as { kind: string; expected: string }[];
  return expected.find((e) => e.kind === 'cash')!.expected;
}

async function closeShift(shiftId: string) {
  const cash = new Decimal(await expectedCash());
  const d500 = cash.divToInt(500).toNumber();
  const d100 = cash.sub(d500 * 500).divToInt(100).toNumber();
  const d1 = cash.sub(d500 * 500 + d100 * 100).toNumber();
  return (await T(owner.post(`/pos/shifts/${shiftId}/close`)).send({ denominations: { '500': d500, '100': d100, '1': d1 } }).expect(200)).body;
}

function sale(lines: Record<string, unknown>[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
}

function returnOf(bill: { id: string; lines: { id: string; item: { id: string } }[] }, qty: string, payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const l = bill.lines[0];
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), buyer: { name: 'Walk-in customer' }, ret: { number: num(), returnOfId: bill.id, lines: [{ lineNo: 1, itemId: l.item.id, quantity: qty, returnOfLineId: l.id }] }, payments, ...extra };
}

const cash = (amount: string) => [{ paymentMethodId: pm.CASH, amount }];

async function postBill(body: Record<string, unknown>, status = 201) {
  const res = await T(owner.post('/pos/bills')).send(body).expect(status);
  return res.body;
}

/** Credit minus debit of a role's account (store accounts: for MAIN); a liability shows plus. */
async function credit(role: string) {
  const company = await prisma.company.findFirstOrThrow();
  const a = await app.get(LedgerService).accountFor(prisma, company.id, { role, storeId: MAIN });
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.credit?.toString() ?? '0').sub(new Decimal(s._sum.debit?.toString() ?? '0')).toFixed(2);
}

async function points(customerId: string) {
  return (await owner.get(`/loyalty/customers/${customerId}`).expect(200)).body as { balance: number; available: number; tier: { name: string } | null; history: { kind: string; points: number; expiresOn: string | null }[]; expiringSoon: { points: number }[]; yearSpend: string };
}

async function approval(action: string) {
  return (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action }).expect(200)).body.token as string;
}

/** A manager-approved cancellation (the approval is asked for first). */
async function cancelBill(id: string, reason: string, status = 200) {
  const approvalToken = await approval('cancel_bill');
  return (await owner.post(`/pos/bills/${id}/cancel`).send({ reason, approvalToken }).expect(status)).body;
}

async function expectBooks() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  const health = (await owner.get('/reports/book-health').expect(200)).body;
  expect(health.problems).toEqual([]);
  expect(health.totalDebit).toBe(health.totalCredit);
}

async function person(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

async function sellCard(amount: string, payments: { paymentMethodId: string; reference?: string } = { paymentMethodId: pm.CASH }, extra: Record<string, unknown> = {}) {
  return (await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount, ...payments, ...extra }).expect(201)).body as {
    repeated: boolean;
    card: { id: string; number: string; balance: string; expiresOn: string; status: string };
    receipt: { number: string; giftCards: { action: string; number: string; barcode: boolean; balance: string }[]; gstTable: unknown[]; totals: { total: string } };
  };
}

describe('13.1 earning points', () => {
  let kurta: { id: string };
  let priya: { id: string };
  let shift: { id: string };

  beforeAll(async () => {
    await freshCompany();
    kurta = await item('Silk kurta', '2450');
    priya = await customer('Priya', '9840012345');
    shift = await openShift();
  });
  afterAll(expectBooks);

  it('Priya buys for ₹2,450 and earns 24 points (fractions dropped), expiring in 365 days; the receipt shows her new balance', async () => {
    const res = await postBill(sale([{ itemId: kurta.id, quantity: '1' }], cash('2450'), { customerId: priya.id, expectedTotal: '2450.00' }));
    expect(res.sale.total).toBe('2450.00');
    expect(res.receipts[0].loyalty).toMatchObject({ scheme: 'Loyalty points', earned: 24, spent: 0, balance: 24 });
    const p = await points(priya.id);
    expect(p).toMatchObject({ balance: 24, available: 24 });
    expect(p.history).toEqual([expect.objectContaining({ kind: 'earn', points: 24, expiresOn: addDays(today(), 365) })]);
  });

  it('a walk-in bill earns nothing', async () => {
    const before = await prisma.loyaltyEntry.count();
    const res = await postBill(sale([{ itemId: kurta.id, quantity: '1' }], cash('2450')));
    expect(res.receipts[0].loyalty).toBeNull();
    expect(await prisma.loyaltyEntry.count()).toBe(before);
  });

  it('at closing, loyalty expense is debited and the points liability credited ₹24.00', async () => {
    // Before closing the points are held but not yet in the ledger; the check counts them as still to post.
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 24, value: '24.00', ledger: '0.00', pending: '24.00', ok: true });
    await closeShift(shift.id);
    expect(await credit('loyalty_liability')).toBe('24.00');
    expect(await credit('loyalty_expense')).toBe('-24.00');
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 24, value: '24.00', ledger: '24.00', pending: '0.00', difference: '0.00', ok: true });
  });
});

describe('13.2 spending points', () => {
  let saree: { id: string };
  let dupatta: { id: string };
  let priya: { id: string };
  let shift: { id: string };

  beforeAll(async () => {
    await freshCompany();
    saree = await item('Silk saree', '15000');
    dupatta = await item('Dupatta', '500');
    priya = await customer('Priya', '9840012345');
    shift = await openShift();
    await postBill(sale([{ itemId: saree.id, quantity: '1' }], cash('15000'), { customerId: priya.id }));
    await closeShift(shift.id);
    shift = await openShift();
  });
  afterAll(expectBooks);

  it('Priya has 150 points', async () => {
    expect(await points(priya.id)).toMatchObject({ balance: 150, available: 150 });
    expect(await credit('loyalty_liability')).toBe('150.00');
  });

  it('spending 90 points is refused (minimum 100); 300 points on a ₹500 bill is refused (more than 50%); offline is refused', async () => {
    expect((await postBill(sale([{ itemId: dupatta.id, quantity: '1' }], cash('410'), { customerId: priya.id, redeemPoints: 90 }), 400)).message).toBe('At least 100 points must be spent at a time');
    n--;
    expect((await postBill(sale([{ itemId: dupatta.id, quantity: '1' }], cash('200'), { customerId: priya.id, redeemPoints: 300 }), 400)).message).toBe('At most 50% of the bill (₹250.00) can be paid with points');
    n--;
    expect((await postBill(sale([{ itemId: dupatta.id, quantity: '1' }], cash('400'), { customerId: priya.id, redeemPoints: 100, offline: true }), 400)).message).toMatch(/^Paying with points needs the connection/);
    n--;
    // A walk-in bill cannot be paid with points.
    expect((await postBill(sale([{ itemId: dupatta.id, quantity: '1' }], cash('400'), { redeemPoints: 100 }), 400)).message).toMatch(/Choose the customer/);
    n--;
    expect(await prisma.loyaltyEntry.count({ where: { kind: 'spend' } })).toBe(0);
  });

  it('on a ₹500 bill she spends 100 points: ₹100.00 paid with points, she pays ₹400.00, and earns 4 points on what she paid', async () => {
    const res = await postBill(sale([{ itemId: dupatta.id, quantity: '1' }], cash('400'), { customerId: priya.id, redeemPoints: 100, expectedTotal: '500.00' }));
    expect(res.sale.total).toBe('500.00');
    const paid = res.sale.payments.map((p: { paymentMethod: { code: string }; amount: string; reference: string | null }) => [p.paymentMethod.code, p.amount, p.reference]);
    expect(paid).toEqual(expect.arrayContaining([['CASH', '400.00', null], ['POINTS', '100.00', '100 points']]));
    expect(res.receipts[0].loyalty).toMatchObject({ earned: 4, spent: 100, balance: 54 });
    // GST is on the goods as usual: the points are a payment, not a discount (CA to confirm).
    expect(res.sale.taxableAmount).toBe('476.20');
    expect(await points(priya.id)).toMatchObject({ balance: 54 });
  });

  it('the liability goes down ₹100.00 (and up ₹4.00 for the points earned) when the shift closes', async () => {
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 54, ledger: '150.00', pending: '-96.00', ok: true });
    await closeShift(shift.id);
    expect(await credit('loyalty_liability')).toBe('54.00');
    expect(await credit('loyalty_expense')).toBe('-154.00');
    // The points were a payment: cash in the till is only the ₹400.
    expect(await credit('sales')).toBe('14761.92');
  });
});

describe('13.3 returns and cancelling (decision 16)', () => {
  let saree: { id: string };
  let stole: { id: string };
  let priya: { id: string };
  let shift: { id: string };
  let bill: { id: string; number: string; lines: { id: string; item: { id: string } }[] };
  let ret: { id: string };

  beforeAll(async () => {
    await freshCompany();
    saree = await item('Silk saree', '15000');
    stole = await item('Stole', '250');
    priya = await customer('Priya', '9840012345');
    shift = await openShift();
    await postBill(sale([{ itemId: saree.id, quantity: '1' }], cash('15000'), { customerId: priya.id }));
    // 13.2's bill: two stoles (₹500), 100 points and ₹400 cash; 4 points earned.
    bill = (await postBill(sale([{ itemId: stole.id, quantity: '2' }], cash('400'), { customerId: priya.id, redeemPoints: 100 }))).sale;
    expect(await points(priya.id)).toMatchObject({ balance: 54 });
  });
  afterAll(expectBooks);

  it('returning half of the bill takes back 2 of the 4 points earned and gives back 50 of the 100 points spent; ₹200.00 is refunded in cash', async () => {
    // The till refunds only its part; the points part goes back automatically.
    expect((await postBill(returnOf(bill, '1', cash('-250'), { customerId: priya.id }), 400)).message).toBe('The refund must be exactly ₹200.00');
    n--;
    const res = await postBill(returnOf(bill, '1', cash('-200'), { customerId: priya.id }));
    ret = res.return;
    expect(res.return.total).toBe('-250.00');
    const paid = res.return.payments.map((p: { paymentMethod: { code: string }; amount: string }) => [p.paymentMethod.code, p.amount]);
    expect(paid).toEqual(expect.arrayContaining([['CASH', '-200.00'], ['POINTS', '-50.00']]));
    expect(res.receipts[0].loyalty).toMatchObject({ restored: 50, reversed: 2, balance: 102 });
    expect(await points(priya.id)).toMatchObject({ balance: 102 });
    // The bill now shows what is left to give back on a second return.
    const after = (await owner.get(`/pos/bills/${bill.id}`).expect(200)).body;
    expect(after.refundParts).toMatchObject({ returnedTotal: '250.00', points: { spent: 100, restoredBefore: 50 } });
  });

  it('cancelling the return puts both back; cancelling the bill reverses both completely', async () => {
    await cancelBill(ret.id, 'Customer kept it');
    expect(await points(priya.id)).toMatchObject({ balance: 54 });
    await cancelBill(bill.id, 'Wrong customer');
    expect(await points(priya.id)).toMatchObject({ balance: 150, available: 150 });
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 150, ok: true });
  });

  it('at closing only the first bill’s 150 points reach the accounts', async () => {
    await closeShift(shift.id);
    expect(await credit('loyalty_liability')).toBe('150.00');
    expect(await credit('loyalty_expense')).toBe('-150.00');
  });

  it('a bill whose earned points were spent cannot be cancelled until the bill that spent them is', async () => {
    shift = await openShift();
    const first = (await postBill(sale([{ itemId: stole.id, quantity: '4' }], cash('1000'), { customerId: priya.id }))).sale;
    // 150 + 10 points: spending 155 needs some of the 10 just earned.
    const big = await item('Lehenga', '400');
    const ok = (await postBill(sale([{ itemId: big.id, quantity: '1' }], cash('245'), { customerId: priya.id, redeemPoints: 155 }))).sale;
    expect(await points(priya.id)).toMatchObject({ balance: 7 });
    expect((await cancelBill(first.id, 'Test', 400)).message).toMatch(/already spent; cancel the bill that spent them first/);
    await cancelBill(ok.id, 'Test');
    await cancelBill(first.id, 'Test');
    expect(await points(priya.id)).toMatchObject({ balance: 150 });
    await closeShift(shift.id);
  });
});

describe('13.4 expiry and tiers', () => {
  let saree: { id: string };
  let lehenga: { id: string };
  let priya: { id: string };
  let meena: { id: string };
  let shift: { id: string };

  beforeAll(async () => {
    await freshCompany();
    saree = await item('Silk saree', '15000');
    lehenga = await item('Lehenga', '1000');
    priya = await customer('Priya', '9840012345');
    meena = await customer('Meena', '9840054321');
    shift = await openShift();
    await postBill(sale([{ itemId: saree.id, quantity: '1' }], cash('15000'), { customerId: priya.id }));
    await closeShift(shift.id);
  });
  afterAll(expectBooks);

  it('points not spent within 365 days expire; the liability goes down by their value, credited back as set', async () => {
    const lot = await prisma.loyaltyEntry.findFirstOrThrow({ where: { customerId: priya.id, kind: 'earn' } });
    expect(lot.expiresOn?.toISOString().slice(0, 10)).toBe(addDays(today(), 365));
    // The run before the day changes nothing; 365 days later (moved here to today) they expire.
    expect((await owner.post('/loyalty/expiry/run').send({ confirm: true }).expect(200)).body).toMatchObject({ points: 0 });
    await prisma.loyaltyEntry.update({ where: { id: lot.id }, data: { expiresOn: new Date(`${today()}T00:00:00Z`) } });
    expect((await owner.get('/loyalty/reports/expiring').query({ from: today(), to: today() }).expect(200)).body).toMatchObject({ points: 150, value: '150.00' });
    expect(await points(priya.id)).toMatchObject({ balance: 150, available: 0 });
    expect((await owner.post('/loyalty/expiry/run').send({ confirm: true }).expect(200)).body).toEqual({ points: 150, value: '150.00', customers: 1 });
    // Running again the same night changes nothing.
    expect((await owner.post('/loyalty/expiry/run').send({ confirm: true }).expect(200)).body).toMatchObject({ points: 0 });
    expect(await points(priya.id)).toMatchObject({ balance: 0 });
    expect(await credit('loyalty_liability')).toBe('0.00');
    // Written back to loyalty expense (the default): it is as if the points had never been given.
    expect(await credit('loyalty_expense')).toBe('0.00');
  });

  it('expired points can be written back to other income instead', async () => {
    await owner.patch('/loyalty/settings').send({ expiryTo: 'other_income' }).expect(200);
    shift = await openShift();
    await postBill(sale([{ itemId: lehenga.id, quantity: '1' }], cash('1000'), { customerId: priya.id }));
    await closeShift(shift.id);
    await prisma.loyaltyEntry.updateMany({ where: { customerId: priya.id, kind: 'earn', remaining: { gt: 0 } }, data: { expiresOn: new Date(`${today()}T00:00:00Z`) } });
    expect((await owner.post('/loyalty/expiry/run').send({ confirm: true }).expect(200)).body).toMatchObject({ points: 10, value: '10.00' });
    expect(await credit('other_income')).toBe('10.00');
    expect(await credit('loyalty_expense')).toBe('-10.00');
    await owner.patch('/loyalty/settings').send({ expiryTo: 'loyalty_expense' }).expect(200);
  });

  it('tiers: the lowest must start at ₹0; Gold from ₹25,000 spent in a year earns ₹100 = 2 points from the bill that crosses it', async () => {
    expect((await owner.post('/loyalty/tiers').send({ name: 'Gold', spendFrom: '25000', earnSpend: '100', earnPoints: 2 }).expect(400)).body.message).toBe('The lowest tier must start at ₹0 spent');
    await owner.post('/loyalty/tiers').send({ name: 'Silver', spendFrom: '0', earnSpend: '100', earnPoints: 1 }).expect(201);
    const settings = (await owner.post('/loyalty/tiers').send({ name: 'Gold', spendFrom: '25000', earnSpend: '100', earnPoints: 2 }).expect(201)).body;
    expect(settings.tiers.map((t: { name: string; spendFrom: string }) => [t.name, t.spendFrom])).toEqual([
      ['Silver', '0.00'],
      ['Gold', '25000.00'],
    ]);
    shift = await openShift('5000');
    let res = await postBill(sale([{ itemId: lehenga.id, quantity: '24' }], cash('24000'), { customerId: meena.id }));
    expect(res.receipts[0].loyalty).toMatchObject({ earned: 240 });
    expect((await points(meena.id)).tier).toMatchObject({ name: 'Silver' });
    res = await postBill(sale([{ itemId: lehenga.id, quantity: '2' }], cash('2000'), { customerId: meena.id }));
    expect(res.receipts[0].loyalty).toMatchObject({ earned: 40 });
    res = await postBill(sale([{ itemId: lehenga.id, quantity: '1' }], cash('1000'), { customerId: meena.id }));
    expect(res.receipts[0].loyalty).toMatchObject({ earned: 20, balance: 300 });
    expect(await points(meena.id)).toMatchObject({ balance: 300, yearSpend: '27000.00', tier: { name: 'Gold' } });
  });

  it('the liability always equals unexpired points × point value, also after the point value changes', async () => {
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 300, value: '300.00', ok: true });
    await closeShift(shift.id);
    expect(await credit('loyalty_liability')).toBe('300.00');
    // Points are now worth 50 paise: the liability is adjusted the same day.
    await owner.patch('/loyalty/settings').send({ pointValue: '0.5' }).expect(200);
    expect(await credit('loyalty_liability')).toBe('150.00');
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 300, value: '150.00', ledger: '150.00', ok: true });
    await owner.patch('/loyalty/settings').send({ pointValue: '1' }).expect(200);
    expect((await owner.get('/loyalty/reports/liability').expect(200)).body).toMatchObject({ points: 300, value: '300.00', ledger: '300.00', ok: true });
    const months = (await owner.get('/loyalty/reports/by-month').expect(200)).body;
    expect(months).toEqual([expect.objectContaining({ month: today().slice(0, 7), earned: { points: 460, value: '460.00' }, expired: { points: 160, value: '160.00' } })]);
  });
});

describe('13.5 selling and reloading a gift card', () => {
  let shift: { id: string };
  let first: Awaited<ReturnType<typeof sellCard>>;

  beforeAll(async () => {
    await freshCompany();
    shift = await openShift();
  });
  afterAll(expectBooks);

  it('selling a ₹1,000 gift card for cash: cash up ₹1,000.00 and gift card liability up ₹1,000.00, with no GST and no stock', async () => {
    const body = { clientId: randomUUID(), tillId, amount: '1000', paymentMethodId: pm.CASH, holderName: 'Anita' };
    first = (await T(owner.post('/pos/gift-cards/sell')).send(body).expect(201)).body;
    expect(first.card).toMatchObject({ balance: '1000.00', status: 'active', expiresOn: giftCardExpiresOn(today()) });
    expect(first.card.number).toHaveLength(16);
    expect(isValidGiftCardNumber(first.card.number)).toBe(true);
    // The receipt shows the number (with a barcode); there is no tax table.
    expect(first.receipt.giftCards).toEqual([expect.objectContaining({ action: 'sold', barcode: true, balance: '1000.00' })]);
    expect(normaliseGiftCardNumber(first.receipt.giftCards[0].number)).toBe(first.card.number);
    expect(first.receipt.number).toMatch(/^GC-2026-27-\d{5}$/);
    expect(first.receipt.gstTable).toEqual([]);
    // Sent twice: saved once.
    const again = (await T(owner.post('/pos/gift-cards/sell')).send(body).expect(201)).body;
    expect(again).toMatchObject({ repeated: true, card: { number: first.card.number, balance: '1000.00' } });
    expect(await credit('gift_card_liability')).toBe('1000.00');
    expect(await credit('cash_in_hand')).toBe('-1000.00');
    expect(await expectedCash()).toBe('3000.00');
    for (const role of ['gst_output_cgst', 'gst_output_sgst', 'gst_output_igst', 'sales']) expect(await credit(role)).toBe('0.00');
    expect(await prisma.stockLedgerEntry.count()).toBe(0);
  });

  it('every card gets its own number', async () => {
    const second = await sellCard('500', { paymentMethodId: pm.UPI, reference: 'UPI-1' });
    expect(second.card.number).not.toBe(first.card.number);
    expect(isValidGiftCardNumber(second.card.number)).toBe(true);
  });

  it('reloading ₹500 more makes the balance ₹1,500.00', async () => {
    const reload = await sellCard('500', { paymentMethodId: pm.UPI, reference: 'UPI-2' }, { number: first.card.number });
    expect(reload.card).toMatchObject({ id: first.card.id, balance: '1500.00' });
    expect(reload.receipt.giftCards[0]).toMatchObject({ action: 'loaded', balance: '1500.00' });
    expect(await credit('gift_card_liability')).toBe('2000.00');
    expect(await credit('upi_settlement')).toBe('-1000.00');
    // A card number with a wrong digit is caught before anything is looked up.
    const wrong = `${first.card.number.slice(0, 15)}${(Number(first.card.number[15]) + 1) % 10}`;
    expect((await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '100', paymentMethodId: pm.CASH, number: wrong }).expect(400)).body.errors).toEqual([{ path: 'number', message: 'That gift card number is not right; check the digits' }]);
    const check = (await owner.post(`/pos/till/${tillId}/gift-cards/check`).send({ number: first.card.number }).expect(200)).body;
    expect(check).toMatchObject({ balance: '1500.00', problem: null, holderName: 'Anita' });
  });

  it('the liability equals the sum of the card balances, before and after closing', async () => {
    expect((await owner.get('/gift-cards/reports/liability').expect(200)).body).toMatchObject({ cards: 2, balance: '2000.00', ledger: '2000.00', ok: true });
    await closeShift(shift.id);
    expect((await owner.get('/gift-cards/reports/liability').expect(200)).body).toMatchObject({ balance: '2000.00', ledger: '2000.00', ok: true });
    expect((await owner.get('/gift-cards/reports/by-month').expect(200)).body).toEqual([{ month: today().slice(0, 7), loaded: '2000.00', spent: '0.00', refunded: '0.00', expired: '0.00' }]);
  });
});

describe('13.6 spending a gift card', () => {
  let shirt: { id: string };
  let shift: { id: string };
  let card: Awaited<ReturnType<typeof sellCard>>['card'];

  beforeAll(async () => {
    await freshCompany();
    shirt = await item('Linen shirt', '600');
    shift = await openShift();
    card = (await sellCard('1000')).card;
    card = (await sellCard('500', { paymentMethodId: pm.UPI, reference: 'UPI-9' }, { number: card.number })).card;
  });
  afterAll(expectBooks);

  it('a ₹600 bill (GST included) paid with the card charges GST on the goods as usual and leaves ₹900.00 on the card', async () => {
    const res = await postBill(sale([{ itemId: shirt.id, quantity: '1' }], cash('0'), { giftCards: [{ number: card.number, amount: '600' }], expectedTotal: '600.00' }));
    expect(res.sale).toMatchObject({ total: '600.00', taxableAmount: '571.42' });
    expect(new Decimal(res.sale.cgst).add(res.sale.sgst).toFixed(2)).toBe('28.58');
    expect(res.sale.payments).toEqual([expect.objectContaining({ amount: '600.00', reference: `**** ${card.number.slice(-4)}`, paymentMethod: expect.objectContaining({ code: 'GIFTCARD' }) })]);
    expect(res.receipts[0].giftCards).toEqual([expect.objectContaining({ action: 'spent', number: `**** ${card.number.slice(-4)}`, amount: '600.00', balance: '900.00' })]);
    const check = (await owner.post(`/pos/till/${tillId}/gift-cards/check`).send({ number: card.number }).expect(200)).body;
    expect(check.balance).toBe('900.00');
  });

  it('more than the balance, offline, a blocked card and an expired card are refused', async () => {
    expect((await postBill(sale([{ itemId: shirt.id, quantity: '2' }], cash('200'), { giftCards: [{ number: card.number, amount: '1000' }] }), 400)).message).toMatch(/has only ₹900.00/);
    n--;
    expect((await postBill(sale([{ itemId: shirt.id, quantity: '1' }], cash('0'), { giftCards: [{ number: card.number, amount: '600' }], offline: true }), 400)).message).toMatch(/^Paying with a gift card needs the connection/);
    n--;
    await owner.post(`/gift-cards/${card.id}/block`).send({ reason: 'Customer lost the card' }).expect(200);
    expect((await postBill(sale([{ itemId: shirt.id, quantity: '1' }], cash('0'), { giftCards: [{ number: card.number, amount: '600' }] }), 400)).message).toMatch(/this gift card is blocked/);
    n--;
    // A blocked card cannot be reloaded either; the manager unblocks it when it is found.
    expect((await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '100', paymentMethodId: pm.CASH, number: card.number }).expect(400)).body.message).toMatch(/blocked; it cannot be reloaded/);
    await owner.post(`/gift-cards/${card.id}/unblock`).expect(200);
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresOn: new Date(`${today()}T00:00:00Z`) } });
    expect((await postBill(sale([{ itemId: shirt.id, quantity: '1' }], cash('0'), { giftCards: [{ number: card.number, amount: '600' }] }), 400)).message).toMatch(/expired on/);
    n--;
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresOn: new Date(`${giftCardExpiresOn(today())}T00:00:00Z`) } });
    const history = (await owner.get(`/gift-cards/${card.id}`).expect(200)).body;
    expect(history.entries.map((e: { kind: string; amount: string; balanceAfter: string }) => [e.kind, e.amount, e.balanceAfter])).toEqual([
      ['load', '1000.00', '1000.00'],
      ['load', '500.00', '1500.00'],
      ['spend', '-600.00', '900.00'],
    ]);
  });

  it('a member paying with a card earns points only on what she paid otherwise', async () => {
    const priya = await customer('Priya', '9840012345');
    const res = await postBill(sale([{ itemId: shirt.id, quantity: '2' }], cash('300'), { customerId: priya.id, giftCards: [{ number: card.number, amount: '900' }] }));
    expect(res.receipts[0].loyalty).toMatchObject({ earned: 3 });
    expect(res.receipts[0].giftCards[0]).toMatchObject({ balance: '0.00' });
  });

  it('the liability goes down by what was spent when the shift closes', async () => {
    expect((await owner.get('/gift-cards/reports/liability').expect(200)).body).toMatchObject({ balance: '0.00', ledger: '1500.00', pending: '1500.00', ok: true });
    await closeShift(shift.id);
    expect(await credit('gift_card_liability')).toBe('0.00');
  });
});

describe('13.7 returns and expiry of gift cards', () => {
  let tee: { id: string };
  let shift: { id: string };
  let card: Awaited<ReturnType<typeof sellCard>>['card'];

  beforeAll(async () => {
    await freshCompany();
    tee = await item('Printed tee', '300');
    shift = await openShift();
    card = (await sellCard('1000')).card;
  });
  afterAll(expectBooks);

  it('returning goods paid with a gift card puts the money back on the card', async () => {
    const bill = (await postBill(sale([{ itemId: tee.id, quantity: '2' }], cash('0'), { giftCards: [{ number: card.number, amount: '600' }] }))).sale;
    const res = await postBill(returnOf(bill, '1', cash('0')));
    expect(res.return.payments).toEqual([expect.objectContaining({ amount: '-300.00', paymentMethod: expect.objectContaining({ code: 'GIFTCARD' }) })]);
    expect(res.receipts[0].giftCards).toEqual([expect.objectContaining({ action: 'refunded', amount: '300.00', balance: '700.00' })]);
    expect((await owner.post(`/pos/till/${tillId}/gift-cards/check`).send({ number: card.number }).expect(200)).body.balance).toBe('700.00');
    await closeShift(shift.id);
    expect(await credit('gift_card_liability')).toBe('700.00');
  });

  it('a card expiring soon shows in the expiring-cards report; when it expires its balance is written back to other income', async () => {
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresOn: new Date(`${addDays(today(), 10)}T00:00:00Z`) } });
    const soon = (await owner.get('/gift-cards/reports/expiring').expect(200)).body;
    expect(soon).toMatchObject({ balance: '700.00', rows: [expect.objectContaining({ id: card.id, balance: '700.00' })] });
    expect((await owner.post('/gift-cards/expiry/run').send({ confirm: true }).expect(200)).body).toEqual({ cards: 0, value: '0.00' });
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresOn: new Date(`${today()}T00:00:00Z`) } });
    expect((await owner.post('/gift-cards/expiry/run').send({ confirm: true }).expect(200)).body).toEqual({ cards: 1, value: '700.00' });
    const after = (await owner.get(`/gift-cards/${card.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'expired', balance: '0.00' });
    expect(after.entries.at(-1)).toMatchObject({ kind: 'expire', amount: '-700.00', balanceAfter: '0.00' });
    expect(await credit('gift_card_liability')).toBe('0.00');
    expect(await credit('other_income')).toBe('700.00');
  });

  it('the gift card liability always equals the sum of card balances', async () => {
    expect((await owner.get('/gift-cards/reports/liability').expect(200)).body).toMatchObject({ balance: '0.00', ledger: '0.00', difference: '0.00', ok: true });
  });
});

describe('13 accounts, switches and rights', () => {
  beforeAll(freshCompany);
  afterAll(async () => {
    await owner.patch('/modules/loyalty').send({ enabled: true }).expect(200);
    await owner.patch('/modules/gift_cards').send({ enabled: true }).expect(200);
  });

  it('a company made before plan 13 gets the loyalty and gift card accounts and the payment methods', async () => {
    const company = await prisma.company.findFirstOrThrow();
    await app.get(AccountingSetup).ensure(prisma, company.id);
    const roles = ['loyalty_expense', 'loyalty_liability', 'gift_card_liability', 'other_income', 'gift_card_expiry'];
    await prisma.accountDefault.deleteMany({ where: { companyId: company.id, role: { in: roles } } });
    await prisma.account.deleteMany({ where: { companyId: company.id, systemKey: { in: ['loyalty_expense', 'loyalty_liability', 'gift_card_liability'] } } });
    // The accountant used 2160 for an account of their own: the standard one is made without a number.
    const parent = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, systemKey: 'current_liabilities' } });
    await prisma.account.create({ data: { companyId: company.id, parentId: parent.id, number: '2160', name: 'Staff advances', family: 'liability', kind: 'other' } });
    await app.get(AccountingSetup).ensure(prisma, company.id);
    const defaults = await prisma.accountDefault.findMany({ where: { companyId: company.id, role: { in: roles } }, include: { account: true } });
    expect(Object.fromEntries(defaults.map((d) => [d.role, [d.account.number, d.account.name]]))).toEqual({
      loyalty_expense: ['5320', 'Loyalty points expense'],
      loyalty_liability: [null, 'Loyalty points owed to customers'],
      gift_card_liability: ['2170', 'Gift card balances owed'],
      other_income: ['4210', 'Other income'],
      gift_card_expiry: ['4210', 'Other income'],
    });
    await prisma.paymentMethod.deleteMany({ where: { companyId: company.id, code: { in: ['POINTS', 'GIFTCARD'] } } });
    const methods = (await owner.get('/pos/payment-methods').expect(200)).body as { code: string; kind: string; use: string }[];
    expect(methods.filter((m) => ['POINTS', 'GIFTCARD'].includes(m.code)).map((m) => [m.code, m.kind, m.use])).toEqual([
      ['GIFTCARD', 'other', 'gift_card'],
      ['POINTS', 'other', 'points'],
    ]);
    // They have their own buttons at the till, so they are never ticked for a till.
    const points = (await prisma.paymentMethod.findFirstOrThrow({ where: { code: 'POINTS' } })).id;
    expect((await owner.patch(`/pos/tills/${tillId}`).send({ paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: points }] }).expect(400)).body.message).toMatch(/own button at the till/);
  });

  it('a cashier sells gift cards but cannot block them or change the scheme', async () => {
    const cashier = await person('Ravi', 'ravi@rademics.test', 'cashier');
    await openShift();
    await cashier.post('/pos/gift-cards/sell').set('x-till-token', tillToken).send({ clientId: randomUUID(), tillId, amount: '200', paymentMethodId: pm.CASH }).expect(201);
    const card = await prisma.giftCard.findFirstOrThrow();
    await cashier.post(`/gift-cards/${card.id}/block`).send({ reason: 'Lost' }).expect(403);
    await cashier.patch('/loyalty/settings').send({ minRedeem: 10 }).expect(403);
    await cashier.get('/gift-cards').expect(403);
  });

  it('switched off, a module’s screens, till parts and earning stop; its data stays', async () => {
    const priya = await customer('Priya', '9840012345');
    const kurta = await item('Kurta', '1000');
    expect((await owner.patch('/modules/loyalty').send({ enabled: false }).expect(200)).body).toMatchObject({ done: true });
    const off = (await owner.get('/loyalty/settings').expect(403)).body;
    expect(off).toMatchObject({ code: 'MODULE_OFF', message: 'Loyalty points is switched off in Settings → My modules' });
    const res = await postBill(sale([{ itemId: kurta.id, quantity: '1' }], cash('1000'), { customerId: priya.id }));
    expect(res.receipts[0].loyalty).toBeNull();
    expect((await postBill(sale([{ itemId: kurta.id, quantity: '1' }], cash('1000'), { customerId: priya.id, redeemPoints: 100 }), 403)).message).toBe('Loyalty points is switched off in Settings → My modules');
    n--;
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.till.loyalty).toBeNull();
    expect(snap.modules.loyalty).toBe(false);
    // Switching gift cards off with money on a card asks first.
    expect((await owner.patch('/modules/gift_cards').send({ enabled: false }).expect(200)).body).toMatchObject({ done: false, needsConfirm: true, warnings: ['1 gift card still has money on it'] });
    await owner.patch('/modules/gift_cards').send({ enabled: false, confirm: true }).expect(200);
    await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '200', paymentMethodId: pm.CASH }).expect(403);
    await owner.get('/gift-cards').expect(403);
    expect((await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body.till.giftCards).toBeNull();
  });
});
