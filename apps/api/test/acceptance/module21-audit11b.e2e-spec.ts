// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 11 (tests), part 2, 30 October 2026: the gaps the first pass found. The till's own
// pricing against the server's, the balance sheet, undoing a payment link, cancelling an opening bill,
// points and gift cards used as plain payments, changing an item's units after stock exists, the
// reports no test called, and editing drafts. Money is compared as strings, to the paisa.
// Rice (HSN 1006, 5%) sells at ₹105 and costs ₹60; soap (HSN 3402, 18%) sells at ₹118 and costs ₹70;
// oil (HSN 1508, 5%) sells at ₹199 and costs ₹150.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, Decimal, gstinCheckCharacter } from 'shared';
import { invalidateModuleCache } from '../../src/modules/module-map.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

// The till works out every bill itself (apps/web/src/lib/till/pricing.ts); the same code is used
// here, fed with the till's own snapshot from the server, so a difference shows up as a failure.
// It is loaded when the tests run: this project's type check covers only apps/api (rootDir), so
// only the few shapes used are written out below.
const TILL_PRICING = new URL('../../../web/src/lib/till/pricing.ts', import.meta.url).href;
interface TillLine {
  amount: Decimal;
  discountAmount: Decimal;
  gstRate: Decimal;
  tax: { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal };
}
interface ComputedPart {
  lines: TillLine[];
  total: Decimal;
  rounding: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}
interface ComputedBill {
  sale: ComputedPart | null;
  ret: ComputedPart | null;
  net: Decimal;
  due: Decimal;
  problems: string[];
  approvals: unknown[];
}
interface TillSnapshot {
  till: { paymentMethods: unknown[] };
}
interface DraftLine {
  key: string;
  itemId: string;
  unitId: string;
  quantity: string;
  barcode: string | null;
  priceOverride: string | null;
  discountPercent: string;
}
type DraftBill = { lines: DraftLine[] } & Record<string, unknown>;
interface TillPricing {
  emptyDraft(id: string): DraftBill;
  priceBill(draft: DraftBill, ctx: { snapshot: TillSnapshot; date: string }): ComputedBill;
  buildTransaction(draft: DraftBill, bill: ComputedBill, methods: unknown[], o: { clientId: string; tillId: string; shiftClientId: string; soldAt: string; offline: boolean; numbers: { sale?: string; ret?: string } }): { expectedTotal?: string };
}
let till: TillPricing;

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let floor: string;
let pcs: string;
let group: string;
let list: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftClientId: string;
let rice: { id: string; code: string };
let soap: { id: string; code: string };
let oil: { id: string; code: string };
let n = 0;
const today = () => businessDate();
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = <R extends { set: (k: string, v: string) => R }>(r: R) => r.set('x-till-token', tillToken);
/** A Karnataka (29) GSTIN with a correct check character. */
const KA_GSTIN = `29AABCK1234A1Z${gstinCheckCharacter('29AABCK1234A1Z')}`;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

/** A new company with its chart of accounts, and nothing else. */
async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  invalidateModuleCache();
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  floor = (await prisma.stockLocation.findFirstOrThrow({ where: { code: 'MAIN-FLOOR' } })).id;
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  // The accounts are made the first time they are asked for.
  await owner.get('/accounts').expect(200);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
}

async function item(name: string, hsnCode: string, price: string | null, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: group, baseUnitId: pcs, hsnCode, maxDiscountPercent: '30', ...extra }).expect(201)).body as { id: string; code: string };
  if (price) await owner.post('/prices').send({ priceListId: list, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function opening(itemId: string, qty: string, cost: string) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: floor, lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

/** The company, three items with opening stock (₹3,000 + ₹1,400 + ₹1,500) and a till that lets the cashier give up to 25%. */
async function freshShop() {
  await freshCompany();
  group = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  for (const [hsnCode, rate] of [['1006', '5'], ['3402', '18'], ['1508', '5']]) await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
  rice = await item('Ponni Rice 1 kg', '1006', '105');
  soap = await item('Bath soap', '3402', '118');
  oil = await item('Groundnut oil 1 l', '1508', '199');
  await opening(rice.id, '50', '60');
  await opening(soap.id, '20', '70');
  await opening(oil.id, '10', '150');
  tillId = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: floor, priceListId: list, cashierDiscountPercent: '25', paymentMethods: ['CASH', 'CARD', 'UPI'].map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
}

async function openShift() {
  shiftClientId = randomUUID();
  return (await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201)).body as { id: string };
}

function sale(lines: { itemId: string; quantity: string }[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
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

async function acct(key: string): Promise<string> {
  return (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
}

/** Debit minus credit of a system account, as "12.34". */
async function bal(key: string): Promise<string> {
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: await acct(key) }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

/** Stock of an item over all its places: quantity and value. */
async function stockOf(itemId: string) {
  const s = await prisma.stockPosition.aggregate({ where: { itemId }, _sum: { quantity: true, value: true } });
  return { quantity: new Decimal(s._sum.quantity?.toString() ?? '0').toString(), value: new Decimal(s._sum.value?.toString() ?? '0').toFixed(2) };
}

async function supplier(name: string) {
  const groupId = (await prisma.supplierGroup.findFirstOrThrow({ where: { code: 'DISTRIBUTORS' } })).id;
  const termsId = (await prisma.paymentTerms.findFirstOrThrow({ where: { code: 'NET30' } })).id;
  return (await owner.post('/suppliers').send({ name, supplierGroupId: groupId, paymentTermsId: termsId }).expect(201)).body as { id: string };
}

async function customer(name: string, mobile: string) {
  const groupId = (await prisma.customerGroup.findFirstOrThrow({ where: { code: 'RETAIL' } })).id;
  return (await owner.post('/customers').send({ name, customerGroupId: groupId, mobile }).expect(201)).body as { id: string };
}

/** A goods receipt without an order, finalised. */
async function receive(supplierId: string, lines: Record<string, unknown>[]) {
  const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId, noOrderReason: 'Local purchase', lines }).expect(201)).body;
  return (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body as { id: string; status: string; lines: { id: string; factor: string; basicAcceptedQuantity: string }[] };
}

async function billReceipt(supplierId: string, billNo: string, receipt: { lines: { id: string }[] }, lines: Record<string, unknown>[]) {
  const draft = (
    await owner
      .post('/purchase/bills')
      .send({ kind: 'against_receipt', supplierId, supplierBillNo: billNo, supplierBillDate: today(), lines: lines.map((l, i) => ({ receiptLineId: receipt.lines[i].id, ...l })) })
      .expect(201)
  ).body;
  return (await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(200)).body as { id: string; total: string };
}

// ---- 1. The till's pricing and the server's agree ----

interface SavedLine {
  lineNo: number;
  lineTotal: string;
  discountAmount: string;
  gstRate: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
}
interface SavedBill {
  id: string;
  number: string;
  customerId: string;
  total: string;
  roundingAdjustment: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  billDiscount: string;
  lines: (SavedLine & { id: string; unitId: string; quantity: string; price: string; item: { id: string; code: string; name: string } })[];
}

/** Per line: amount, every discount, then GST (rate, taxable, CGST, SGST, IGST). */
const savedLines = (b: SavedBill) => [...b.lines].sort((x, y) => x.lineNo - y.lineNo).map((l) => [l.lineTotal, l.discountAmount, new Decimal(l.gstRate).toString(), l.taxableAmount, l.cgst, l.sgst, l.igst]);
const tillLines = (p: ComputedPart) => p.lines.map((l) => [l.amount.toFixed(2), l.discountAmount.toFixed(2), l.gstRate.toString(), l.tax.taxable.toFixed(2), l.tax.cgst.toFixed(2), l.tax.sgst.toFixed(2), l.tax.igst.toFixed(2)]);
const billFigures = (b: SavedBill) => ({ total: b.total, rounding: b.roundingAdjustment, taxable: b.taxableAmount, cgst: b.cgst, sgst: b.sgst, igst: b.igst });
const tillFigures = (p: ComputedPart) => ({ total: p.total.toFixed(2), rounding: p.rounding.toFixed(2), taxable: p.taxable.toFixed(2), cgst: p.cgst.toFixed(2), sgst: p.sgst.toFixed(2), igst: p.igst.toFixed(2) });

describe('audit 11b (1): the till prices a bill exactly as the server does', () => {
  let snap: TillSnapshot;

  beforeAll(async () => {
    till = (await import(TILL_PRICING)) as TillPricing;
  });

  beforeEach(async () => {
    await freshShop();
  });

  async function snapshot() {
    snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body as TillSnapshot;
  }

  const line = (itemId: string, quantity: string, extra: Partial<DraftLine> = {}): DraftLine => ({ key: randomUUID(), itemId, unitId: pcs, quantity, barcode: null, priceOverride: null, discountPercent: '', ...extra });

  /** Prices the bill on the till, sends it as the till does (cash, with expectedTotal) and checks both agree, line by line. */
  async function viaTill(draft: DraftBill, numbers: { sale?: string; ret?: string }) {
    const priced = till.priceBill(draft, { snapshot: snap, date: today() });
    expect(priced.problems).toEqual([]);
    expect(priced.approvals).toEqual([]);
    const paid: DraftBill = { ...draft, payments: [{ methodId: pm.CASH, amount: priced.due.abs().toFixed(2), reference: '' }] };
    const body = till.buildTransaction(paid, priced, snap.till.paymentMethods, { clientId: randomUUID(), tillId, shiftClientId, soldAt: new Date().toISOString(), offline: false, numbers });
    expect(body.expectedTotal).toBe(priced.net.toFixed(2));
    const res = await T(owner.post('/pos/bills')).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const saved = res.body as { sale: SavedBill | null; return: SavedBill | null; net: string };
    expect(saved.net).toBe(priced.net.toFixed(2));
    for (const [part, bill] of [
      [priced.sale, saved.sale],
      [priced.ret, saved.return],
    ] as const) {
      expect(!!part).toBe(!!bill);
      if (!part || !bill) continue;
      expect(savedLines(bill)).toEqual(tillLines(part));
      expect(billFigures(bill)).toEqual(tillFigures(part));
    }
    return saved;
  }

  it('a 10% offer on soap: 2 × ₹118 = ₹236 less ₹23.60 = ₹212.40, rounded to ₹212', async () => {
    await owner.post('/pos/offers').send({ code: 'SOAP10', name: '10% off soap', kind: 'percent', value: '10', appliesTo: 'items', targetIds: [soap.id], startDate: '2026-04-01' }).expect(201);
    await openShift();
    await snapshot();
    const { sale: bill } = await viaTill({ ...till.emptyDraft(randomUUID()), lines: [line(soap.id, '2')] }, { sale: num() });
    // 18% inside ₹212.40: CGST = SGST = 212.40 × 9 ÷ 118 = ₹16.20.
    expect(savedLines(bill!)).toEqual([['212.40', '23.60', '18', '180.00', '16.20', '16.20', '0.00']]);
    expect(billFigures(bill!)).toEqual({ total: '212.00', rounding: '-0.40', taxable: '180.00', cgst: '16.20', sgst: '16.20', igst: '0.00' });
  });

  it('a 10% discount typed by the cashier on 3 rice (₹283.50, rounded up to ₹284); then 1 comes back for ₹94.50, rounded to ₹95', async () => {
    await openShift();
    await snapshot();
    const { sale: bill } = await viaTill({ ...till.emptyDraft(randomUUID()), lines: [line(rice.id, '3', { discountPercent: '10' })] }, { sale: num() });
    expect(savedLines(bill!)).toEqual([['283.50', '31.50', '5', '270.00', '6.75', '6.75', '0.00']]);
    expect(billFigures(bill!)).toEqual({ total: '284.00', rounding: '0.50', taxable: '270.00', cgst: '6.75', sgst: '6.75', igst: '0.00' });

    // The return gives back a third of what the line cost after its discount; its own total rounds too.
    const ol = bill!.lines[0];
    const draft: DraftBill = {
      ...till.emptyDraft(randomUUID()),
      buyer: { gstin: '', name: 'Walk-in customer', address: '', stateCode: '' },
      ret: {
        originalBillId: bill!.id,
        originalNumber: bill!.number,
        customerId: bill!.customerId,
        reason: null,
        supply: { interState: false, noTax: false },
        lines: [
          { key: 'r1', itemId: rice.id, unitId: ol.unitId, code: ol.item.code, name: ol.item.name, quantity: '1', originalLineId: ol.id, maxQuantity: '3', originalQuantity: ol.quantity, originalPrice: ol.price, originalDiscount: ol.discountAmount, originalLineTotal: ol.lineTotal, gstRate: ol.gstRate, isFree: false },
        ],
      },
    };
    const { return: back } = await viaTill(draft, { ret: num() });
    expect(savedLines(back!)).toEqual([['-94.50', '10.50', '5', '-90.00', '-2.25', '-2.25', '0.00']]);
    expect(billFigures(back!)).toEqual({ total: '-95.00', rounding: '-0.50', taxable: '-90.00', cgst: '-2.25', sgst: '-2.25', igst: '0.00' });
  });

  it('a ₹30 bill discount shared over 3 lines by their amounts: ₹7.46, ₹8.39 and the rest ₹14.15', async () => {
    await openShift();
    await snapshot();
    const draft: DraftBill = { ...till.emptyDraft(randomUUID()), lines: [line(rice.id, '1'), line(soap.id, '1'), line(oil.id, '1')], billDiscount: { amount: '30' } };
    const { sale: bill } = await viaTill(draft, { sale: num() });
    expect(savedLines(bill!)).toEqual([
      ['97.54', '7.46', '5', '92.90', '2.32', '2.32', '0.00'],
      ['109.61', '8.39', '18', '92.89', '8.36', '8.36', '0.00'],
      ['184.85', '14.15', '5', '176.05', '4.40', '4.40', '0.00'],
    ]);
    expect(billFigures(bill!)).toEqual({ total: '392.00', rounding: '0.00', taxable: '361.84', cgst: '15.08', sgst: '15.08', igst: '0.00' });
    expect(bill!.billDiscount).toBe('30.00');
  });

  it('a Karnataka business buyer: IGST, taxable = amount ÷ 1.05 to the paisa', async () => {
    await openShift();
    await snapshot();
    const draft: DraftBill = { ...till.emptyDraft(randomUUID()), lines: [line(rice.id, '3'), line(oil.id, '1')], buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: '12 MG Road, Bengaluru 560001', stateCode: '' } };
    const { sale: bill } = await viaTill(draft, { sale: num() });
    expect(savedLines(bill!)).toEqual([
      ['315.00', '0.00', '5', '300.00', '0.00', '0.00', '15.00'],
      ['199.00', '0.00', '5', '189.52', '0.00', '0.00', '9.48'],
    ]);
    expect(billFigures(bill!)).toEqual({ total: '514.00', rounding: '0.00', taxable: '489.52', cgst: '0.00', sgst: '0.00', igst: '24.48' });
  });

  it('a till showing another total is refused with PRICE_CHANGED (409) and nothing is saved', async () => {
    await openShift();
    const res = await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '105' }], { expectedTotal: '1.00' })).expect(409);
    expect(res.body.message).toMatch(/^PRICE_CHANGED: the server total is ₹105\.00, the till showed ₹1\.00/);
    expect(await prisma.posBill.count()).toBe(0);
  });
});

// ---- 2. The balance sheet ----

describe('audit 11b (2): the balance sheet balances, and a date leaves out what came after', () => {
  beforeAll(freshShop);

  it('after a sale, a supplier bill, a part payment and an expense: assets = liabilities + capital + profit not closed', async () => {
    // Sale: 20 rice for ₹2,100 cash (₹2,000 + ₹50 CGST + ₹50 SGST), cost 20 × ₹60 = ₹1,200.
    const shift = await openShift();
    await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '20' }], [{ paymentMethodId: pm.CASH, amount: '2100' }])).expect(201);
    await closeShift(shift.id, 3100);
    // Supplier bill: 10 rice at ₹100 + 5% = ₹1,050; ₹500 of it paid in cash.
    const smt = await supplier('Sri Murugan Traders');
    const receipt = await receive(smt.id, [{ itemId: rice.id, receivedQuantity: '10', rate: '100', gstRate: '5' }]);
    expect((await billReceipt(smt.id, 'SMT/1', receipt, [{ itemId: rice.id, quantity: '10', rate: '100' }])).total).toBe('1050.00');
    const cash = await acct(`cash_in_hand:${MAIN}`);
    const pay = (await owner.post('/payments').send({ kind: 'payment', paymentDate: today(), partyType: 'supplier', partyId: smt.id, fromAccountId: cash, storeId: MAIN, amount: '500', reference: 'CASH-1', referenceDate: today() }).expect(201)).body;
    await owner.post(`/payments/${pay.id}/post`).expect(200);
    // Expense: ₹300 rent from the cash in hand.
    await owner.post('/expenses').send({ expenseDate: today(), storeId: MAIN, expenseAccountId: await acct('rent'), paidFromAccountId: cash, amount: '300' }).expect(201);

    const bs = (await owner.get(`/reports/balance-sheet?asOf=${today()}`).expect(200)).body;
    expect(bs.balanced).toBe(true);
    // Profit: sales ₹2,000 less cost ₹1,200 less rent ₹300.
    expect(bs.profitNotClosed).toBe('500.00');
    expect(new Decimal(bs.liabilities.total).add(bs.equity.total).add(bs.profitNotClosed).toFixed(2)).toBe(bs.assets.total);
    expect(bs.totalLiabilitiesAndCapital).toBe(bs.assets.total);
    const amount = async (side: { rows: { accountId: string; amount: string }[] }, key: string) => side.rows.find((r) => r.accountId === key)?.amount ?? null;
    // Cash: ₹2,100 taken less ₹500 paid and ₹300 rent; stock: ₹4,400 + ₹1,500 opening less ₹1,200 sold plus ₹1,000 bought.
    expect(await amount(bs.assets, cash)).toBe('1300.00');
    expect(await amount(bs.assets, await acct('stock'))).toBe('5700.00');
    expect(await amount(bs.liabilities, await acct('supplier_payable'))).toBe('550.00');
    expect(await amount(bs.liabilities, await acct('gst_output_cgst'))).toBe('50.00');
    expect(await amount(bs.liabilities, await acct('goods_received_not_billed'))).toBeNull();
    // The report agrees with the trial balance's own sums.
    expect(bs.assets.total).toBe(
      (await Promise.all(bs.assets.rows.map(async (r: { accountId: string }) => {
        const s = await prisma.ledgerLine.aggregate({ where: { accountId: r.accountId }, _sum: { debit: true, credit: true } });
        return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0'));
      }))).reduce((s: Decimal, v: Decimal) => s.add(v), new Decimal(0)).toFixed(2),
    );
  });

  it('as of yesterday nothing of today is in it', async () => {
    const bs = (await owner.get(`/reports/balance-sheet?asOf=${addDays(today(), -1)}`).expect(200)).body;
    expect(bs).toMatchObject({ asOf: addDays(today(), -1), balanced: true, profitNotClosed: '0.00', totalLiabilitiesAndCapital: '0.00' });
    expect(bs.assets).toEqual({ rows: [], total: '0.00' });
    expect(bs.liabilities).toEqual({ rows: [], total: '0.00' });
  });
});

// ---- 3 and 4. Undoing a payment link; cancelling an opening bill ----

describe('audit 11b (3, 4): payment links and opening bills', () => {
  let cash: string;
  let lakshmi: { id: string };

  beforeEach(async () => {
    await freshCompany();
    cash = await acct(`cash_in_hand:${MAIN}`);
    lakshmi = await customer('Lakshmi Stores', '9840011223');
  });

  const items = async () => (await owner.get(`/parties/customer/${lakshmi.id}/open-items`).expect(200)).body as { itemType: string; itemId: string; owed: string }[];
  const owed = async (itemId: string) => (await items()).find((i) => i.itemId === itemId)?.owed ?? '0.00';
  async function receipt(amount: string) {
    const r = (await owner.post('/payments').send({ kind: 'receipt', paymentDate: today(), partyType: 'customer', partyId: lakshmi.id, toAccountId: cash, storeId: MAIN, amount }).expect(201)).body;
    await owner.post(`/payments/${r.id}/post`).expect(200);
    return r as { id: string; allocations: { billType: string; billId: string; amount: string }[] };
  }
  const links = async () => (await owner.get(`/parties/customer/${lakshmi.id}/settlements`).expect(200)).body as { id: string; amount: string; undone: boolean; billId: string }[];

  it('3 ₹600 linked to a ₹1,000 bill leaves ₹400; undoing the link owes ₹1,000 again and frees the ₹600; undoing twice is refused', async () => {
    const bill = (await owner.post('/opening-bills').send({ partyType: 'customer', partyId: lakshmi.id, billNumber: 'OLD/1', billDate: '2026-08-01', amount: '1000' }).expect(201)).body.id as string;
    const pay = await receipt('600');
    // Without bills chosen, the oldest is settled first.
    expect(pay.allocations).toEqual([{ billType: 'opening_bill', billId: bill, amount: '600.00' }]);
    expect(await owed(bill)).toBe('400.00');
    expect((await owner.get(`/payments/${pay.id}`).expect(200)).body.unused).toBe('0.00');

    const [link] = await links();
    expect(link).toMatchObject({ billId: bill, amount: '600.00', undone: false });
    await owner.post(`/settlements/${link.id}/undo`).expect(200);
    expect(await owed(bill)).toBe('1000.00');
    expect(await owed(pay.id)).toBe('-600.00');
    expect((await owner.get(`/payments/${pay.id}`).expect(200)).body.unused).toBe('600.00');
    expect((await links())[0].undone).toBe(true);
    expect((await owner.post(`/settlements/${link.id}/undo`).expect(400)).body.message).toBe('Already undone');

    // Linked again by hand: ₹400 owed once more. The ledger never changed: ₹1,000 billed, ₹600 received.
    await owner.post('/settlements').send({ partyType: 'customer', partyId: lakshmi.id, billType: 'opening_bill', billId: bill, byType: 'payment', byId: pay.id, amount: '600' }).expect(201);
    expect(await owed(bill)).toBe('400.00');
    expect(await bal('customer_receivable')).toBe('400.00');
  });

  it('4 a ₹5,000 opening bill is cancelled by a reversing entry; not while a payment is linked; not twice', async () => {
    const check = async () => (await owner.get('/accounting/opening-check').expect(200)).body as { difference: string; ok: boolean };
    expect(await check()).toMatchObject({ difference: '0.00', ok: true });
    const bill = (await owner.post('/opening-bills').send({ partyType: 'customer', partyId: lakshmi.id, billNumber: 'OLD/2', billDate: '2026-08-01', amount: '5000' }).expect(201)).body.id as string;
    expect(await check()).toMatchObject({ difference: '-5000.00', ok: false });
    await receipt('2000');
    expect((await owner.post(`/opening-bills/${bill}/cancel`).send({ reason: 'Entered twice' }).expect(400)).body.message).toMatch(/Payments are linked to this bill/);

    await owner.post(`/settlements/${(await links())[0].id}/undo`).expect(200);
    await owner.post(`/opening-bills/${bill}/cancel`).send({ reason: 'Entered twice' }).expect(200);
    const entries = await prisma.ledgerEntry.findMany({ where: { documentType: 'opening_bill', documentId: bill }, include: { lines: true } });
    expect(entries).toHaveLength(2);
    const reversal = entries.find((e) => e.cancelsId)!;
    expect(reversal.cancelsId).toBe(entries.find((e) => !e.cancelsId)!.id);
    const sum = (k: 'debit' | 'credit') => reversal.lines.reduce((s, l) => s.add(l[k].toString()), new Decimal(0)).toFixed(2);
    expect([sum('debit'), sum('credit')]).toEqual(['5000.00', '5000.00']);
    expect((await owner.get('/opening-bills').expect(200)).body.find((b: { id: string }) => b.id === bill)).toMatchObject({ status: 'cancelled', owed: '0.00' });
    expect(await check()).toMatchObject({ difference: '0.00', ok: true });
    // The ₹2,000 is now an unused receipt from the customer.
    expect(await bal('customer_receivable')).toBe('-2000.00');
    expect((await owner.post(`/opening-bills/${bill}/cancel`).send({ reason: 'Again' }).expect(400)).body.message).toBe('Already cancelled');
  });
});

// ---- 5. Points and gift cards are not plain payment methods ----

describe('audit 11b (5): points and gift cards are paid only with their own buttons', () => {
  beforeAll(freshShop);

  it('a till cannot tick them; a till that has them (set up before plan 13) still cannot take them as a payment; a gift card is not bought on account', async () => {
    const company = await prisma.company.findFirstOrThrow();
    const points = (await prisma.paymentMethod.findFirstOrThrow({ where: { code: 'POINTS' } })).id;
    const card = (await prisma.paymentMethod.findFirstOrThrow({ where: { code: 'GIFTCARD' } })).id;
    const res = await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T2', name: 'Counter 2', locationId: floor, priceListId: list, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: points }] }).expect(400);
    expect(res.body.message).toBe('Loyalty points has its own button at the till; it is not ticked for a till');

    // On account can be ticked for a till, but money must buy a gift card.
    await owner.patch(`/pos/tills/${tillId}`).send({ paymentMethods: ['CASH', 'CARD', 'UPI', 'ACCOUNT'].map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) }).expect(200);
    const shift = await openShift();
    const onAccount = await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '500', paymentMethodId: pm.ACCOUNT }).expect(400);
    expect(onAccount.body.message).toBe('A gift card is paid for with money; On account cannot pay for it');

    // A till set up before plan 13 may still carry the two methods.
    await prisma.tillPaymentMethod.createMany({ data: [points, card].map((paymentMethodId) => ({ companyId: company.id, tillId, paymentMethodId })) });
    const withPoints = await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: points, amount: '105' }])).expect(400);
    expect(withPoints.body.message).toBe('Loyalty points is paid with its own button at the till');
    const withCard = await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: card, amount: '105' }])).expect(400);
    expect(withCard.body.message).toBe('Gift card is paid with its own button at the till');
    const cardWithPoints = await T(owner.post('/pos/gift-cards/sell')).send({ clientId: randomUUID(), tillId, amount: '500', paymentMethodId: points }).expect(400);
    expect(cardWithPoints.body.message).toBe('A gift card is paid for with money; Loyalty points cannot pay for it');
    expect(await prisma.posBill.count()).toBe(0);
    expect(await prisma.giftCard.count()).toBe(0);
    await closeShift(shift.id, 1000);
  });
});

// ---- 6. Units ----

describe('audit 11b (6): units', () => {
  beforeAll(freshShop);

  it('a box of 12 changed to a box of 10 after 2 boxes came in: what came in stays 24 pieces; new receipts use 10', async () => {
    const box = (await prisma.unit.findFirstOrThrow({ where: { code: 'BOX' } })).id;
    const nuts = await item('Cashew 100 g', '1006', null, { units: [{ unitId: box, factor: '12' }] });
    const smt = await supplier('Sri Murugan Traders');
    const first = await receive(smt.id, [{ itemId: nuts.id, unitId: box, receivedQuantity: '2', rate: '600', gstRate: '5' }]);
    expect(first.lines[0]).toMatchObject({ factor: '12', basicAcceptedQuantity: '24' });
    expect(await stockOf(nuts.id)).toEqual({ quantity: '24', value: '1200.00' });

    // Allowed: every document keeps the factor it was made with, so nothing already saved changes.
    const changed = (await owner.put(`/items/${nuts.id}/units`).send({ units: [{ unitId: box, factor: '10' }] }).expect(200)).body;
    expect(changed.units.find((u: { unitId: string }) => u.unitId === box).factor).toBe('10');
    const line = await prisma.goodsReceiptLine.findFirstOrThrow({ where: { receiptId: first.id } });
    expect([line.factor.toString(), line.basicAcceptedQuantity.toString()]).toEqual(['12', '24']);
    expect(await stockOf(nuts.id)).toEqual({ quantity: '24', value: '1200.00' });
    expect((await prisma.stockLedgerEntry.aggregate({ where: { itemId: nuts.id }, _sum: { quantityChange: true } }))._sum.quantityChange?.toString()).toBe('24');

    // The bill for those 2 boxes is for 24 pieces (the receipt's boxes), and clears goods received not billed.
    await billReceipt(smt.id, 'SMT/1', first, [{ itemId: nuts.id, unitId: box, quantity: '2', rate: '600' }]);
    expect(await bal('goods_received_not_billed')).toBe('0.00');
    expect((await owner.get('/purchase/reports/received-not-billed').expect(200)).body).toEqual([]);
    // A box received now holds 10.
    const second = await receive(smt.id, [{ itemId: nuts.id, unitId: box, receivedQuantity: '1', rate: '500', gstRate: '5' }]);
    expect(second.lines[0]).toMatchObject({ factor: '10', basicAcceptedQuantity: '10' });
    expect(await stockOf(nuts.id)).toEqual({ quantity: '34', value: '1700.00' });
  });

  it('boxes ordered before the box size changed come in at the size on the order', async () => {
    const box = (await prisma.unit.findFirstOrThrow({ where: { code: 'BOX' } })).id;
    const dates = await item('Dates 250 g', '1006', null, { units: [{ unitId: box, factor: '12' }] });
    const smt = await supplier('Sri Murugan Traders 2');
    const order = (await owner.post('/purchase/orders').send({ storeId: MAIN, supplierId: smt.id, neededBy: addDays(today(), 7), lines: [{ itemId: dates.id, unitId: box, quantity: '2', rate: '600', gstRate: '5' }] }).expect(201)).body;
    await owner.post(`/purchase/orders/${order.id}/finalise`).expect(200);
    await owner.put(`/items/${dates.id}/units`).send({ units: [{ unitId: box, factor: '10' }] }).expect(200);
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, lines: [{ orderLineId: order.lines[0].id, itemId: dates.id, receivedQuantity: '2' }] }).expect(201)).body;
    const got = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    // 2 boxes of 12 at ₹600 a box: 24 pieces at ₹50, not 20 at ₹60.
    expect(got.lines[0]).toMatchObject({ factor: '12', basicAcceptedQuantity: '24' });
    expect(await stockOf(dates.id)).toEqual({ quantity: '24', value: '1200.00' });
  });

  it('a conversion between two units of the same kind is added once', async () => {
    const unit = async (code: string) => (await prisma.unit.findFirstOrThrow({ where: { code } })).id;
    const pkt = await unit('PKT');
    const conv = (await owner.post('/catalogue/unit-conversions').send({ fromUnitId: pkt, toUnitId: pcs, factor: '6' }).expect(201)).body;
    expect(conv).toMatchObject({ fromUnitId: pkt, toUnitId: pcs });
    expect(new Decimal(conv.factor).toString()).toBe('6');
    const listed = (await owner.get('/catalogue/unit-conversions').expect(200)).body as { id: string; fromUnit: { code: string }; toUnit: { code: string } }[];
    expect(listed.find((c) => c.id === conv.id)).toMatchObject({ fromUnit: { code: 'PKT' }, toUnit: { code: 'PCS' } });
    // The other way round is the same conversion; a weight cannot become pieces.
    await owner.post('/catalogue/unit-conversions').send({ fromUnitId: pcs, toUnitId: pkt, factor: '0.5' }).expect(409);
    await owner.post('/catalogue/unit-conversions').send({ fromUnitId: await unit('KG'), toUnitId: pcs, factor: '4' }).expect(400);
    await owner.post('/catalogue/unit-conversions').send({ fromUnitId: pkt, toUnitId: pkt, factor: '1' }).expect(400);
  });
});

// ---- 7. Reports no test called ----

describe('audit 11b (7): purchase, till and sales reports add up', () => {
  let smt: { id: string };
  let kav: { id: string };
  let unloading: { id: string; code: string };

  beforeAll(async () => {
    await freshShop();
    smt = await supplier('Sri Murugan Traders');
    kav = await supplier('Kaveri Agencies');
    unloading = await item('Unloading charges', '1006', null, { isStockItem: false });
  });

  it('purchases: the register is every bill line; by supplier and by item add up to it; what is still to come or to be billed', async () => {
    const order = (await owner.post('/purchase/orders').send({ storeId: MAIN, supplierId: smt.id, neededBy: addDays(today(), 7), lines: [{ itemId: rice.id, quantity: '10', rate: '100', gstRate: '5' }] }).expect(201)).body;
    await owner.post(`/purchase/orders/${order.id}/finalise`).expect(200);
    const fromOrder = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, lines: [{ orderLineId: order.lines[0].id, itemId: rice.id, receivedQuantity: '4' }] }).expect(201)).body;
    const r1 = (await owner.post(`/purchase/receipts/${fromOrder.id}/finalise`).expect(200)).body;
    // ₹400 + 5% = ₹420 for the 4 received; 5 soap at ₹50 not billed yet; ₹500 + 18% = ₹590 for unloading.
    expect((await billReceipt(smt.id, 'SMT/1', r1, [{ itemId: rice.id, quantity: '4', rate: '100' }])).total).toBe('420.00');
    await receive(smt.id, [{ itemId: soap.id, receivedQuantity: '5', rate: '50', gstRate: '18' }]);
    const service = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: kav.id, supplierBillNo: 'KAV/9', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: unloading.id, quantity: '1', rate: '500', gstRate: '18' }] }).expect(201)).body;
    expect((await owner.post(`/purchase/bills/${service.id}/finalise`).send({}).expect(200)).body.total).toBe('590.00');

    const register = (await owner.get(`/purchase/reports/register?from=${today()}&to=${today()}`).expect(200)).body as { lineTotal: string; taxableAmount: string; supplier: { name: string } }[];
    // Both bills are of today, so their order between them is not fixed.
    expect(register.map((r) => [r.supplier.name, r.taxableAmount, r.lineTotal]).sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ['Kaveri Agencies', '500.00', '590.00'],
      ['Sri Murugan Traders', '400.00', '420.00'],
    ]);
    const registerTotal = register.reduce((s, r) => s.add(r.lineTotal), new Decimal(0)).toFixed(2);
    expect(registerTotal).toBe('1010.00');
    const bySupplier = (await owner.get(`/purchase/reports/by-supplier?from=${today()}&to=${today()}`).expect(200)).body as { supplier: { name: string }; bills: number; taxableAmount: string; taxAmount: string; total: string }[];
    expect(bySupplier.map((r) => [r.supplier.name, r.bills, r.taxableAmount, r.taxAmount, r.total])).toEqual([
      ['Kaveri Agencies', 1, '500.00', '90.00', '590.00'],
      ['Sri Murugan Traders', 1, '400.00', '20.00', '420.00'],
    ]);
    expect(bySupplier.reduce((s, r) => s.add(r.total), new Decimal(0)).toFixed(2)).toBe(registerTotal);
    const byItem = (await owner.get(`/purchase/reports/by-item?from=${today()}&to=${today()}`).expect(200)).body as { item: { code: string }; quantity: string; taxableAmount: string; averageRate: string }[];
    expect(byItem.map((r) => [r.item.code, new Decimal(r.quantity).toString(), r.taxableAmount, r.averageRate])).toEqual([
      [unloading.code, '1', '500.00', '500.00'],
      [rice.code, '4', '400.00', '100.00'],
    ]);
    // Only one supplier asked for: the register narrows too.
    expect((await owner.get(`/purchase/reports/register?supplierId=${kav.id}`).expect(200)).body).toHaveLength(1);

    const notBilled = (await owner.get('/purchase/reports/received-not-billed').expect(200)).body as { item: { code: string }; notBilled: string; value: string }[];
    expect(notBilled.map((r) => [r.item.code, new Decimal(r.notBilled).toString(), r.value])).toEqual([[soap.code, '5', '250.00']]);
    const followUp = (await owner.get('/purchase/reports/order-follow-up').expect(200)).body as { orderId: string; ordered: string; received: string; pending: string; daysLate: number; orderedAmount: string }[];
    expect(followUp.map((r) => [r.orderId, new Decimal(r.ordered).toString(), new Decimal(r.received).toString(), new Decimal(r.pending).toString(), r.daysLate, r.orderedAmount])).toEqual([[order.id, '10', '4', '6', 0, '1000.00']]);

    const dash = (await owner.get('/dashboards/purchasing').expect(200)).body;
    const tile = (key: string) => dash.tiles.find((t: { key: string }) => t.key === key)?.value;
    // Still to come: 6 of 10 rice at ₹100 before GST.
    expect([tile('open_orders'), tile('late_orders')]).toEqual(['600.00', '0']);
    expect(dash.charts.purchasesBySupplier30Days).toEqual([
      { label: 'Kaveri Agencies', value: '500.00' },
      { label: 'Sri Murugan Traders', value: '400.00' },
    ]);
  });

  it('the till: by hour and by cashier add up to the day; returns are minus amounts; sales by group are net of returns', async () => {
    const shift = await openShift();
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '2' }], [{ paymentMethodId: pm.CASH, amount: '210' }])).expect(201)).body.sale;
    await T(owner.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '118' }])).expect(201);
    await T(owner.post('/pos/bills'))
      .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), buyer: { name: 'Walk-in customer' }, ret: { number: num(), returnOfId: first.id, reason: 'Damaged bag', lines: [{ lineNo: 1, itemId: rice.id, quantity: '1', returnOfLineId: first.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-105' }] })
      .expect(201);
    // The day: ₹210 + ₹118 − ₹105 = ₹223 from 2 sales and 1 return.
    const q = `from=${today()}&to=${today()}`;
    const hourly = (await owner.get(`/pos/reports/hourly?${q}`).expect(200)).body as { hour: number; bills: number; total: string }[];
    expect(hourly.reduce((s, h) => s.add(h.total), new Decimal(0)).toFixed(2)).toBe('223.00');
    expect(hourly.reduce((s, h) => s + h.bills, 0)).toBe(2);
    const byCashier = (await owner.get(`/pos/reports/by-cashier?${q}`).expect(200)).body;
    expect(byCashier).toEqual([expect.objectContaining({ name: 'Karthik R', bills: 2, returns: 1, total: '223.00' })]);

    const returns = (await owner.get(`/reports/returns?${q}`).expect(200)).body;
    expect(returns.rows).toEqual([expect.objectContaining({ what: 'Return', originalBill: first.number, value: '-105.00', reason: 'Damaged bag' })]);
    expect(returns.totals).toEqual({ returns: '-105.00', count: 1 });
    // Before GST: rice 2 × ₹100 + soap ₹100 − rice ₹100 back.
    const groups = (await owner.get(`/reports/sales-by-group?${q}`).expect(200)).body;
    expect(groups.rows).toHaveLength(1);
    expect(groups.rows[0].netSales).toBe('200.00');
    expect(new Decimal(groups.rows[0].quantity).toString()).toBe('2');

    await closeShift(shift.id, 1223);
    const shifts = (await owner.get(`/pos/reports/shifts?${q}`).expect(200)).body;
    expect(shifts).toEqual([expect.objectContaining({ id: shift.id, status: 'closed', salesTotal: '328.00', returnsTotal: '-105.00', difference: '0.00' })]);

    // The accounts dashboard: the ₹223 is in the cash in hand once the shift is closed; no till is open.
    const dash = (await owner.get('/dashboards/accounts').expect(200)).body;
    const tile = (key: string) => dash.tiles.find((t: { key: string }) => t.key === key)?.value;
    expect([tile('bank'), tile('cash_in_hand'), tile('cash_in_tills'), tile('customers_overdue')]).toEqual(['0.00', '223.00', '0.00', '0.00']);
  });
});

// ---- 8. Editing drafts ----

describe('audit 11b (8): drafts can be changed, posted documents cannot', () => {
  let smt: { id: string };

  beforeAll(async () => {
    await freshShop();
    smt = await supplier('Sri Murugan Traders');
  });

  it('a supplier bill: the quantity changed on the draft works the totals out again', async () => {
    const unloading = await item('Unloading charges', '1006', null, { isStockItem: false });
    const draft = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: smt.id, supplierBillNo: 'SMT/7', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: unloading.id, quantity: '1', rate: '500', gstRate: '18' }] }).expect(201)).body;
    expect([draft.taxableAmount, draft.taxAmount, draft.total]).toEqual(['500.00', '90.00', '590.00']);
    const changed = (await owner.patch(`/purchase/bills/${draft.id}`).send({ lines: [{ itemId: unloading.id, quantity: '3', rate: '500', gstRate: '18' }] }).expect(200)).body;
    expect([changed.status, new Decimal(changed.lines[0].quantity).toString(), changed.taxableAmount, changed.taxAmount, changed.total]).toEqual(['draft', '3', '1500.00', '270.00', '1770.00']);
    await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(200);
    expect(await bal('supplier_payable')).toBe('-1770.00');
    expect((await owner.patch(`/purchase/bills/${draft.id}`).send({ supplierBillNo: 'SMT/8' }).expect(400)).body.message).toBe('Only draft bills can be changed');
  });

  it('a goods receipt: changed while a draft, checked, then closed: it leaves "received, not billed"', async () => {
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, noOrderReason: 'Local purchase', lines: [{ itemId: soap.id, receivedQuantity: '5', rate: '50', gstRate: '18' }] }).expect(201)).body;
    const changed = (await owner.patch(`/purchase/receipts/${draft.id}`).send({ lines: [{ itemId: soap.id, receivedQuantity: '8', rate: '50', gstRate: '18' }], deliveryNoteNo: 'DN-77' }).expect(200)).body;
    expect([changed.status, changed.deliveryNoteNo, new Decimal(changed.lines[0].receivedQuantity).toString(), changed.taxableAmount, changed.total]).toEqual(['draft', 'DN-77', '8', '400.00', '472.00']);
    const posted = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    expect(posted.status).toBe('to_bill');
    await owner.patch(`/purchase/receipts/${draft.id}`).send({ deliveryNoteNo: 'DN-78' }).expect(400);
    expect(await stockOf(soap.id)).toEqual({ quantity: '28', value: '1800.00' });

    const checked = (await owner.post(`/purchase/receipts/${draft.id}/check`).send({ result: 'passed_with_remarks', remarks: 'Two cartons dented' }).expect(200)).body;
    expect(checked.check).toMatchObject({ result: 'passed_with_remarks', remarks: 'Two cartons dented' });
    const waiting = (await owner.get('/purchase/reports/received-not-billed').expect(200)).body as { receiptId: string; notBilled: string; value: string }[];
    expect(waiting.filter((r) => r.receiptId === draft.id).map((r) => [new Decimal(r.notBilled).toString(), r.value])).toEqual([['8', '400.00']]);

    const closed = (await owner.post(`/purchase/receipts/${draft.id}/close`).send({ reason: 'Supplier will not bill; free replacement' }).expect(200)).body;
    expect(closed.status).toBe('closed');
    expect(((await owner.get('/purchase/reports/received-not-billed').expect(200)).body as { receiptId: string }[]).filter((r) => r.receiptId === draft.id)).toEqual([]);
    expect((await owner.post(`/purchase/receipts/${draft.id}/close`).send({ reason: 'Again' }).expect(400)).body.message).toBe('A closed receipt cannot be closed');
  });

  it('a payment and a journal: changed while drafts; refused once posted', async () => {
    const cashIn = await acct(`cash_in_hand:${MAIN}`);
    const cashTill = await acct(`cash_in_till:${MAIN}`);
    const transfer = { kind: 'transfer', paymentDate: today(), storeId: MAIN, fromAccountId: cashIn, toAccountId: cashTill };
    const pay = (await owner.post('/payments').send({ ...transfer, amount: '300' }).expect(201)).body;
    const changed = (await owner.patch(`/payments/${pay.id}`).send({ ...transfer, amount: '450', remark: 'Float for the evening' }).expect(200)).body;
    expect([changed.status, changed.amount, changed.remark]).toEqual(['draft', '450.00', 'Float for the evening']);
    await owner.post(`/payments/${pay.id}/post`).expect(200);
    expect(await bal(`cash_in_till:${MAIN}`)).toBe('450.00');
    expect((await owner.patch(`/payments/${pay.id}`).send({ ...transfer, amount: '500' }).expect(400)).body.message).toMatch(/^A posted payment cannot be changed/);

    const income = await acct('other_income');
    const lines = (dr: string, cr: string) => [
      { accountId: cashIn, storeId: MAIN, debit: dr },
      { accountId: income, storeId: MAIN, credit: cr },
    ];
    const j = (await owner.post('/journals').send({ journalDate: today(), lines: lines('100', '100') }).expect(201)).body;
    expect([j.status, j.total]).toEqual(['draft', '100.00']);
    const edited = (await owner.patch(`/journals/${j.id}`).send({ journalDate: today(), remark: 'Scrap sold', lines: lines('250', '250') }).expect(200)).body;
    expect([edited.status, edited.total, edited.remark, edited.lines.map((l: { debit: string; credit: string }) => [l.debit, l.credit])]).toEqual(['draft', '250.00', 'Scrap sold', [['250.00', '0.00'], ['0.00', '250.00']]]);
    expect((await owner.patch(`/journals/${j.id}`).send({ journalDate: today(), lines: lines('250', '200') }).expect(400)).body.message).toMatch(/must be equal/);
    await owner.post(`/journals/${j.id}/post`).expect(200);
    expect(await bal('other_income')).toBe('-250.00');
    expect((await owner.patch(`/journals/${j.id}`).send({ journalDate: today(), lines: lines('300', '300') }).expect(400)).body.message).toMatch(/^A posted journal cannot be changed/);
  });

  it('a GST registration still used by a store, or the default one, cannot be switched off', async () => {
    const regs = (await owner.get('/company/gst-registrations').expect(200)).body as { id: string; isDefault: boolean }[];
    const home = regs.find((r) => r.isDefault)!;
    expect((await owner.patch(`/company/gst-registrations/${home.id}`).send({ active: false }).expect(400)).body.message).toBe('Make another registration the default before switching this one off');
    const ka = (await owner.post('/company/gst-registrations').send({ gstin: KA_GSTIN, city: 'Bengaluru' }).expect(201)).body;
    await owner.post('/stores').send({ code: 'BLR', name: 'Bengaluru', stateCode: '29', gstRegistrationId: ka.id }).expect(201);
    expect((await owner.patch(`/company/gst-registrations/${ka.id}`).send({ active: false }).expect(400)).body.message).toBe('1 active store(s) still use this registration');
    expect((await prisma.gstRegistration.findUniqueOrThrow({ where: { id: ka.id } })).active).toBe(true);
    // Other changes are fine.
    await owner.patch(`/company/gst-registrations/${ka.id}`).send({ city: 'Bengaluru Urban' }).expect(200);
  });
});
