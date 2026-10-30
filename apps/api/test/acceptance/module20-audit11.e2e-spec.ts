// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 11 (tests), 30 October 2026: the minimum scenarios of CLAUDE.md §6.6 end to end, each
// checking the stock, the accounts (by account) and the GST, to the paisa. Rice (HSN 1006, 5%) sells at
// ₹105 = ₹100 + ₹2.50 CGST + ₹2.50 SGST and costs ₹60; soap (HSN 3402, 18%) sells at ₹118 and costs ₹70.
// The opening float (₹1,000) is counted back at the close and never reaches the accounts.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { Decimal } from 'shared';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, OWNER, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let floor: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let rice: { id: string };
let soap: { id: string };
let n = 0;
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
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
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  floor = (await prisma.stockLocation.findFirstOrThrow({ where: { code: 'MAIN-FLOOR' } })).id;
  const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  const group = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  const list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  for (const [hsnCode, rate] of [['1006', '5'], ['3402', '18']]) await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
  const item = async (name: string, hsnCode: string, price: string, cost: string, qty: string) => {
    const i = (await owner.post('/items').send({ name, itemGroupId: group, baseUnitId: pcs, hsnCode }).expect(201)).body as { id: string };
    await owner.post('/prices').send({ priceListId: list, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: floor, lines: [{ itemId: i.id, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
    await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
    return i;
  };
  rice = await item('Ponni Rice 1 kg', '1006', '105', '60', '50');
  soap = await item('Bath soap', '3402', '118', '70', '20');
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: floor, priceListId: list, paymentMethods: ['CASH', 'CARD', 'UPI'].map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
}

async function openShift() {
  return (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201)).body as { id: string };
}

function sale(lines: { itemId: string; quantity: string }[], payments: Record<string, unknown>[]) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments };
}

/** Closes the shift with this much cash counted (in ₹500, ₹100, ₹10, ₹5 and ₹1 notes and coins). */
async function closeShift(shiftId: string, counted: number) {
  const denominations: Record<string, number> = {};
  let left = counted;
  for (const d of [500, 100, 10, 5, 1]) {
    if (left >= d) denominations[String(d)] = Math.floor(left / d);
    left %= d;
  }
  await T(owner.post(`/pos/shifts/${shiftId}/close`)).send({ denominations }).expect(200);
}

/** Debit minus credit of a system account, as "12.34". */
async function bal(key: string): Promise<string> {
  // The cash accounts are per store ("cash_in_hand:<store id>").
  const systemKey = key.startsWith('cash_in_') ? `${key}:${MAIN}` : key;
  const account = await prisma.account.findFirstOrThrow({ where: { systemKey } });
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: account.id }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

async function position(itemId: string) {
  const p = await prisma.stockPosition.findUniqueOrThrow({ where: { itemId_locationId: { itemId, locationId: floor } } });
  return { quantity: new Decimal(p.quantity.toString()).toString(), value: new Decimal(p.value.toString()).toFixed(2) };
}

async function billGst(id: string) {
  const b = await prisma.posBill.findUniqueOrThrow({ where: { id } });
  return { taxable: b.taxableAmount.toFixed(2), cgst: b.cgst.toFixed(2), sgst: b.sgst.toFixed(2), total: b.total.toFixed(2) };
}

/** The books agree with themselves and with the stock after every scenario. */
async function expectBooks() {
  const health = (await owner.get('/reports/book-health').expect(200)).body;
  expect(health.problems).toEqual([]);
  const stock = (await owner.get('/reports/stock-vs-accounts').expect(200)).body;
  expect(stock.rows.filter((r: { difference: string }) => r.difference !== '0.00')).toEqual([]);
}

// Opening stock: rice 50 × ₹60 = ₹3,000 and soap 20 × ₹70 = ₹1,400, so the stock account starts at ₹4,400.
describe('audit 11: the minimum scenarios, stock + accounts + GST', () => {
  beforeEach(freshShop);
  afterEach(expectBooks);

  it('a sale and its GST tax invoice: 2 rice for ₹210 cash', async () => {
    const shift = await openShift();
    const bill = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '2' }], [{ paymentMethodId: pm.CASH, amount: '210' }])).expect(201)).body.sale;
    expect(await billGst(bill.id)).toEqual({ taxable: '200.00', cgst: '5.00', sgst: '5.00', total: '210.00' });
    expect(await position(rice.id)).toEqual({ quantity: '48', value: '2880.00' });
    await closeShift(shift.id, 1210);
    expect(await bal('sales')).toBe('-200.00');
    expect(await bal('gst_output_cgst')).toBe('-5.00');
    expect(await bal('gst_output_sgst')).toBe('-5.00');
    expect(await bal('cost_of_goods_sold')).toBe('120.00');
    expect(await bal('stock')).toBe('4280.00');
    expect(await bal('cash_in_hand')).toBe('210.00');
    expect(await bal('cash_in_till')).toBe('0.00');
    expect(await bal('cash_short_over')).toBe('0.00');
  });

  it('a return: 1 of the 2 rice comes back for ₹105 cash', async () => {
    const shift = await openShift();
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '2' }], [{ paymentMethodId: pm.CASH, amount: '210' }])).expect(201)).body.sale;
    await T(owner.post('/pos/bills'))
      .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), buyer: { name: 'Walk-in customer' }, ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: rice.id, quantity: '1', returnOfLineId: first.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-105' }] })
      .expect(201);
    const retBill = await prisma.posBill.findFirstOrThrow({ where: { kind: 'return', returnOfId: first.id } });
    expect(await billGst(retBill.id)).toEqual({ taxable: '-100.00', cgst: '-2.50', sgst: '-2.50', total: '-105.00' });
    // Back into stock at the cost it left with.
    expect(await position(rice.id)).toEqual({ quantity: '49', value: '2940.00' });
    await closeShift(shift.id, 1105);
    expect(await bal('sales')).toBe('-100.00');
    expect(await bal('gst_output_cgst')).toBe('-2.50');
    expect(await bal('gst_output_sgst')).toBe('-2.50');
    expect(await bal('cost_of_goods_sold')).toBe('60.00');
    expect(await bal('stock')).toBe('4340.00');
    expect(await bal('cash_in_hand')).toBe('105.00');
  });

  it('an exchange: soap (18%) back, rice (5%) out, ₹13 refunded', async () => {
    const shift = await openShift();
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '118' }])).expect(201)).body.sale;
    await T(owner.post('/pos/bills'))
      .send({
        clientId: randomUUID(),
        tillId,
        soldAt: new Date().toISOString(),
        buyer: { name: 'Walk-in customer' },
        ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: soap.id, quantity: '1', returnOfLineId: first.lines[0].id }] },
        sale: { number: num(), lines: [{ lineNo: 1, itemId: rice.id, quantity: '1' }] },
        payments: [{ paymentMethodId: pm.CASH, amount: '-13' }],
      })
      .expect(201);
    const back = await prisma.posBill.findFirstOrThrow({ where: { kind: 'return', returnOfId: first.id } });
    const out = await prisma.posBill.findFirstOrThrow({ where: { kind: 'sale', id: { not: first.id } } });
    // Each part carries its own rate: the soap credit at 18%, the rice sale at 5%.
    expect(await billGst(back.id)).toEqual({ taxable: '-100.00', cgst: '-9.00', sgst: '-9.00', total: '-118.00' });
    expect(await billGst(out.id)).toEqual({ taxable: '100.00', cgst: '2.50', sgst: '2.50', total: '105.00' });
    expect(await position(soap.id)).toEqual({ quantity: '20', value: '1400.00' });
    expect(await position(rice.id)).toEqual({ quantity: '49', value: '2940.00' });
    await closeShift(shift.id, 1105);
    expect(await bal('sales')).toBe('-100.00');
    expect(await bal('gst_output_cgst')).toBe('-2.50');
    expect(await bal('gst_output_sgst')).toBe('-2.50');
    expect(await bal('cost_of_goods_sold')).toBe('60.00');
    expect(await bal('stock')).toBe('4340.00');
    expect(await bal('cash_in_hand')).toBe('105.00');
  });

  it('a sale below zero at the till: 52 rice with 50 on the shelf', async () => {
    const shift = await openShift();
    const bill = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '52' }], [{ paymentMethodId: pm.CASH, amount: '5460' }])).expect(201)).body.sale;
    expect(await billGst(bill.id)).toEqual({ taxable: '5200.00', cgst: '130.00', sgst: '130.00', total: '5460.00' });
    expect((await prisma.posBill.findUniqueOrThrow({ where: { id: bill.id } })).checkFlags).toContain('stock_negative');
    // The 2 sold beyond stock go out at the last cost: -2 × ₹60.
    expect(await position(rice.id)).toEqual({ quantity: '-2', value: '-120.00' });
    await closeShift(shift.id, 6460);
    expect(await bal('sales')).toBe('-5200.00');
    expect(await bal('gst_output_cgst')).toBe('-130.00');
    expect(await bal('gst_output_sgst')).toBe('-130.00');
    expect(await bal('cost_of_goods_sold')).toBe('3120.00');
    expect(await bal('stock')).toBe('1280.00');
  });

  it('a shift closed ₹2 short: the shortage goes to cash short or over', async () => {
    const shift = await openShift();
    await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '105' }])).expect(201);
    await closeShift(shift.id, 1103);
    expect(await bal('cash_short_over')).toBe('2.00');
    expect(await bal('cash_in_hand')).toBe('103.00');
    expect(await bal('cash_in_till')).toBe('0.00');
    expect(await bal('sales')).toBe('-100.00');
  });

  it('card and UPI at the till: the money waits in the settlement accounts; stock and GST as for cash', async () => {
    const shift = await openShift();
    const card = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CARD, amount: '105', reference: 'APPR-1' }])).expect(201)).body.sale;
    const upi = (await T(owner.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1' }], [{ paymentMethodId: pm.UPI, amount: '118', reference: 'UPI-778' }])).expect(201)).body.sale;
    expect(await billGst(card.id)).toEqual({ taxable: '100.00', cgst: '2.50', sgst: '2.50', total: '105.00' });
    expect(await billGst(upi.id)).toEqual({ taxable: '100.00', cgst: '9.00', sgst: '9.00', total: '118.00' });
    expect(await position(rice.id)).toEqual({ quantity: '49', value: '2940.00' });
    expect(await position(soap.id)).toEqual({ quantity: '19', value: '1330.00' });
    await closeShift(shift.id, 1000);
    expect(await bal('card_settlement')).toBe('105.00');
    expect(await bal('upi_settlement')).toBe('118.00');
    expect(await bal('cash_in_hand')).toBe('0.00');
    expect(await bal('sales')).toBe('-200.00');
    expect(await bal('gst_output_cgst')).toBe('-11.50');
    expect(await bal('gst_output_sgst')).toBe('-11.50');
    expect(await bal('cost_of_goods_sold')).toBe('130.00');
  });

  it("11.8 a return without the bill: needs a manager, never offline, refunded only by a refund method; stock back at today's cost", async () => {
    const ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
    await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
    const shift = await openShift();
    const ret = (extra: Record<string, unknown>, payments: Record<string, unknown>[]) => ({
      clientId: randomUUID(),
      tillId,
      soldAt: new Date().toISOString(),
      buyer: { name: 'Walk-in customer' },
      ret: { number: num(), reason: 'No bill', lines: [{ lineNo: 1, itemId: rice.id, quantity: '1', price: '105' }], ...extra },
      payments,
    });
    const cash = [{ paymentMethodId: pm.CASH, amount: '-105' }];
    const approval = async () => (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'return_without_bill' }).expect(200)).body.token as string;
    expect((await T(owner.post('/pos/bills')).send(ret({}, cash))).status).toBeGreaterThanOrEqual(400);
    // Each approval is fetched before the bill request is made (supertest sends one request at a time).
    const a1 = await approval();
    expect((await T(owner.post('/pos/bills')).send({ ...ret({ approvalToken: a1 }, cash), offline: true })).status).toBeGreaterThanOrEqual(400);
    // A shop that does not refund by UPI (refunds are allowed on every method by default).
    await prisma.paymentMethod.update({ where: { id: pm.UPI }, data: { allowRefund: false } });
    const a2 = await approval();
    expect((await T(owner.post('/pos/bills')).send(ret({ approvalToken: a2 }, [{ paymentMethodId: pm.UPI, amount: '-105', reference: 'UPI-1' }]))).status).toBeGreaterThanOrEqual(400);
    const a3 = await approval();
    const ok = await T(owner.post('/pos/bills')).send(ret({ approvalToken: a3 }, cash));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const bill = await prisma.posBill.findFirstOrThrow({ where: { kind: 'return', returnOfId: null } });
    expect(bill.total.toFixed(2)).toBe('-105.00');
    expect(await position(rice.id)).toEqual({ quantity: '51', value: '3060.00' });
    await closeShift(shift.id, 895);
    expect(await bal('cash_in_hand')).toBe('-105.00');
    expect(await bal('stock')).toBe('4460.00');
  });

  it('A7.2 an e-way bill on the portal also stops the trial data from being cleared', async () => {
    const company = await prisma.company.findFirstOrThrow();
    const shift = await openShift();
    const bill = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '105' }])).expect(201)).body.sale;
    await prisma.eWayBill.create({ data: { companyId: company.id, documentType: 'pos_bill', documentId: bill.id, documentNumber: bill.number, value: '105', status: 'generated', number: '391000000001' } });
    const res = await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: 'Rademics Retail Pvt Ltd', reason: 'End of the trial' }).expect(403);
    expect(res.body.message).toMatch(/1 e-way bill/);
    expect(await prisma.posBill.count()).toBe(1);
    expect(await prisma.shift.count({ where: { id: shift.id } })).toBe(1);
    await closeShift(shift.id, 1105);
  });
});

describe('audit 11: 11.9 the year is not closed while stock and accounts disagree', () => {
  beforeAll(freshShop);

  it('a stock movement with no ledger entry in March stops the year-end closing, naming the store', async () => {
    const fy = (await owner.post('/financial-years').send({ startDate: '2025-04-01', endDate: '2026-03-31' }).expect(201)).body.id;
    const company = await prisma.company.findFirstOrThrow();
    // ₹500 of rice that the stock ledger knows and the accounts never heard of (as a broken posting would leave).
    await prisma.stockLedgerEntry.create({
      data: {
        companyId: company.id, itemId: rice.id, locationId: floor, documentId: randomUUID(), documentLineId: randomUUID(), postingDate: new Date('2026-03-15T00:00:00Z'), postingAt: new Date('2026-03-15T06:00:00Z'),
        kind: 'in', intentQuantity: '5', incomingCost: '100', quantityChange: '5', valueChange: '500', unitCost: '100', quantityAfter: '5', unitCostAfter: '100', valueAfter: '500', accountRole: 'stock_adjustment', postedValue: '500',
      },
    });
    await owner.patch('/accounting/lock-date').send({ lockDate: '2026-03-31', reason: 'Year end' }).expect(200);
    const retained = (await prisma.account.findFirstOrThrow({ where: { systemKey: 'retained_earnings' } })).id;
    const res = await owner.post('/year-end-closings').send({ financialYearId: fy, closingAccountId: retained }).expect(400);
    expect(res.body.message).toMatch(/The stock value on 2026-03-31 does not match the stock accounts \(MAIN: accounts differ from stock by ₹-500\.00\)/);
    expect(await prisma.yearEndClosing.count()).toBe(0);
  });
});

describe('audit 11: the till\'s "changes since" download overlaps', () => {
  beforeAll(freshShop);

  it("an item saved by a change that began before the till's download still reaches the till next time", async () => {
    const first = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    // The answer reaches back 5 minutes, so a save that started earlier but finished after the download is caught.
    expect(Date.now() - new Date(first.serverTime).getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    // As if a long save had stamped the item a minute before the download and finished after it.
    await prisma.item.update({ where: { id: rice.id }, data: { name: 'Ponni Rice 1 kg (new pack)', updatedAt: new Date(Date.now() - 60_000) } });
    const delta = (await T(owner.get(`/pos/till/${tillId}/snapshot?since=${encodeURIComponent(first.serverTime)}`)).expect(200)).body;
    expect(delta.full).toBe(false);
    expect((delta.items as { id: string; name: string }[]).find((i) => i.id === rice.id)?.name).toBe('Ponni Rice 1 kg (new pack)');
  });
});

