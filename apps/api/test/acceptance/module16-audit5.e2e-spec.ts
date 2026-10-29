// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 5 (the billing counter), 29 October 2026: offline bills are kept as sold and flagged,
// never refused, when the office changed things meanwhile; the till's figures are checked against the
// limits; the same bill identity with other content is refused; refused bills can be posted by the
// office; approvals are tied to the figure approved; drawer openings are recorded; the owner's
// decisions C1–C8 reach the till's saved copy.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, shortFinancialYear } from 'shared';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, OWNER, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let ownerId: string;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftClientId: string;
let counter = 0;

const FY = shortFinancialYear('2026-27');
const num = () => `MAT1/${FY}/${String(++counter).padStart(6, '0')}`;
const T = <R extends { set: (k: string, v: string) => R }>(r: R, token = tillToken) => r.set('x-till-token', token);
const now = () => new Date().toISOString();

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'BAGS', name: 'Bags' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '4202', rate: '18', effectiveFrom: '2025-09-22' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, allowPriceChange: true, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] })
      .expect(201)
  ).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
  shiftClientId = randomUUID();
  // Opened half an hour ago, so offline bills can carry times of sale before "now".
  await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, openedAt: new Date(Date.now() - 30 * 60_000).toISOString(), cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
});

afterAll(async () => {
  await app.close();
});

async function item(name: string, price: string, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '4202', maxDiscountPercent: '30', ...extra }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2025-04-01' }).expect(201);
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: i.id, countedQuantity: '50', unitCost: '500' }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  return i;
}

/** A line as an offline till sends it: what was charged, worked out the till's way. */
function charged(itemId: string, price: string, discount = '0', extra: Record<string, unknown> = {}) {
  const total = (Number(price) - Number(discount)).toFixed(2);
  return { itemId, quantity: '1', ...extra, charged: { listPrice: Number(price).toFixed(2), price: Number(price).toFixed(2), discountAmount: Number(discount).toFixed(2), offerDiscount: '0.00', gstRate: '18', lineTotal: total } };
}

function offline(lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const total = lines.reduce((s, l) => s + Number((l.charged as { lineTotal: string }).lineTotal), 0);
  return { clientId: randomUUID(), tillId, shiftClientId, offline: true, soldAt: now(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount: Math.round(total).toFixed(2) }], ...extra };
}

/** A till bill that must be saved: on a refusal the test shows the reason. */
async function made(r: PromiseLike<{ status: number; body: { sale: { checkFlags: string[] } } & Record<string, unknown> }>) {
  const res = await r;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function approve(action: string, extra: Record<string, unknown> = {}, till = tillId) {
  return (await owner.post('/pos/approvals').send({ tillId: till, managerId: ownerId, pin: '7391', action, ...extra }).expect(200)).body.token as string;
}

describe('audit 5: offline bills are kept as sold and flagged (plan §5)', () => {
  let bag: { id: string; code: string };

  beforeAll(async () => {
    bag = await item('Leather Bag', '1000');
  });

  it('a coupon used up or ended meanwhile is kept and flagged coupon_used_up, and still counted', async () => {
    const offer = (await owner.post('/pos/offers').send({ code: 'WELCOME5', name: '₹5 off with coupon', kind: 'amount', value: '5', appliesTo: 'bill', couponOnly: true, startDate: '2026-04-01' }).expect(201)).body;
    await owner.post('/pos/coupons').send({ code: 'HELLO-2026', offerId: offer.id, startDate: '2026-04-01', maxUses: 1 }).expect(201);
    await prisma.coupon.updateMany({ where: { code: 'HELLO-2026' }, data: { usedCount: 1 } });
    const bill = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000')], { couponCode: 'HELLO-2026' })));
    expect(bill.sale.checkFlags).toContain('coupon_used_up');
    expect((await prisma.coupon.findFirstOrThrow({ where: { code: 'HELLO-2026' } })).usedCount).toBe(2);
    // Online the same coupon is still refused.
    const online = { clientId: randomUUID(), tillId, soldAt: now(), couponCode: 'HELLO-2026', sale: { number: num(), lines: [{ lineNo: 1, itemId: bag.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '1000' }] };
    expect((await T(owner.post('/pos/bills')).send(online).expect(400)).body.message).toMatch(/used up/);
    counter--;
  });

  it('an item switched off, or a unit removed from it, is kept and flagged item_off', async () => {
    const old = await item('Old Bag', '1000');
    await prisma.item.update({ where: { id: old.id }, data: { active: false } });
    const off = await made(T(owner.post('/pos/bills')).send(offline([charged(old.id, '1000')])));
    expect(off.sale.checkFlags).toContain('item_off');
    // A box of 6 the till still had, though the box was taken off the item since.
    const box = (await prisma.unit.findFirstOrThrow({ where: { code: 'BOX' } })).id;
    const boxed = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '6000', '0', { unitId: box, factor: '6' })])));
    expect(boxed.sale.checkFlags).toContain('item_off');
    expect((boxed.sale as unknown as { lines: { basicQuantity: string }[] }).lines[0].basicQuantity).toBe('6');
  });

  it('a discount above the cashier’s or the item’s limit, worked out from what was charged, is flagged with the limits', async () => {
    // 20% off: above the cashier's 5%; the till's own discountPercent says 0, but the charged rupees count.
    const over = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000', '200')])));
    expect(over.sale.checkFlags).toContain('discount_over_limit');
    const line = await prisma.posBillLine.findFirstOrThrow({ where: { billId: (over.sale as unknown as { id: string }).id } });
    expect(line.serverFigures).toMatchObject({ discountPercent: '20.00', maxDiscountPercent: '30.00', cashierLimitPercent: '5.00' });
    // 40%: above the item's maximum even with an approval.
    const token = await approve('discount');
    const beyond = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000', '400', { discountPercent: '40', approvalToken: token })])));
    expect(beyond.sale.checkFlags).toContain('discount_over_limit');
    // 20% with a manager's approval obtained before the connection dropped: no flag.
    const given = await approve('discount');
    const ok = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000', '200', { discountPercent: '20', approvalToken: given })])));
    expect(ok.sale.checkFlags).not.toContain('discount_over_limit');
    // A bill discount of 10% (above the cashier's 5%) without an approval.
    const bd = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000', '100')], { billDiscount: { percent: '10' } })));
    expect(bd.sale.checkFlags).toContain('discount_over_limit');
  });

  it('a manager approval is checked against the time of sale: alive then, no flag; expired before the sale, approval_late', async () => {
    const early = await approve('discount');
    const late = await approve('discount');
    const expired = new Date(Date.now() - 60_000);
    await prisma.posApproval.updateMany({ where: { usedAt: null, action: 'discount', expiresAt: { gt: new Date() } }, data: { expiresAt: expired } });
    const before = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000', '200', { discountPercent: '20', approvalToken: early })], { soldAt: new Date(Date.now() - 5 * 60_000).toISOString() })));
    expect(before.sale.checkFlags).not.toContain('approval_late');
    expect(before.sale.checkFlags).not.toContain('discount_over_limit');
    const after = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000', '200', { discountPercent: '20', approvalToken: late })])));
    expect(after.sale.checkFlags).toContain('approval_late');
  });

  it('a payment method taken off the till meanwhile is kept and flagged method_off', async () => {
    await owner.patch(`/pos/tills/${tillId}`).send({ paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(200);
    const bill = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000')], { payments: [{ paymentMethodId: pm.CARD, amount: '1000', reference: 'APPR42' }] })));
    expect(bill.sale.checkFlags).toContain('method_off');
    await owner.patch(`/pos/tills/${tillId}`).send({ paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] }).expect(200);
  });

  it('a bill numbered with the till’s earlier invoice prefix is kept and flagged number_prefix_old', async () => {
    await owner.patch(`/pos/tills/${tillId}`).send({ numberPrefix: 'NEW1' }).expect(200);
    const bill = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000')])));
    expect(bill.sale.checkFlags).toContain('number_prefix_old');
    // A number in no series of the till is still refused.
    const stray = offline([charged(bag.id, '1000')], {});
    stray.sale.number = `ZZZ9/${FY}/000001`;
    await T(owner.post('/pos/bills')).send(stray).expect(400);
    await owner.patch(`/pos/tills/${tillId}`).send({ numberPrefix: 'MAT1' }).expect(200);
  });

  it('below cost on what was charged is flagged with the cost; a time of sale in the future is flagged sold_time_odd', async () => {
    await owner.patch('/catalogue/settings').send({ blockSellingBelowCost: true }).expect(200);
    const cheap = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '300')])));
    expect(cheap.sale.checkFlags).toEqual(expect.arrayContaining(['below_cost', 'price_changed']));
    const line = await prisma.posBillLine.findFirstOrThrow({ where: { billId: (cheap.sale as unknown as { id: string }).id } });
    expect(line.serverFigures).toMatchObject({ costFloor: '500.00', listPrice: '1000.00' });
    await owner.patch('/catalogue/settings').send({ blockSellingBelowCost: false }).expect(200);
    const future = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000')], { soldAt: new Date(Date.now() + 30 * 60_000).toISOString() })));
    expect(future.sale.checkFlags).toContain('sold_time_odd');
    const beforeShift = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000')], { soldAt: new Date(Date.now() - 2 * 3600_000).toISOString() })));
    expect(beforeShift.sale.checkFlags).toContain('sold_time_odd');
  });

  it('"Offline bills to check" shows what was charged and what the price list said', async () => {
    const rows = (await owner.get('/pos/reports/offline-check').expect(200)).body as { flags: string[]; lines: { charged: { price: string }; server: Record<string, string> }[] }[];
    const changed = rows.find((r) => r.flags.includes('below_cost'))!;
    expect(changed.lines[0]).toMatchObject({ charged: { price: '300.00' }, server: { listPrice: '1000.00', costFloor: '500.00' } });
  });
});

describe('audit 5: the cashier switch and the till computer', () => {
  let bag: { id: string };
  beforeAll(async () => {
    bag = await item('Sling Bag', '1000');
  });

  it('an expired cashier switch on an offline bill keeps the bill under the signed-in user, flagged; online it is a 403, never a 401', async () => {
    const bill = await made(T(owner.post('/pos/bills')).send(offline([charged(bag.id, '1000')], { cashierToken: 'expired-switch-token' })));
    expect(bill.sale.checkFlags).toContain('cashier_switch_expired');
    expect((bill.sale as unknown as { cashierId: string }).cashierId).toBe(ownerId);
    const online = { clientId: randomUUID(), tillId, soldAt: now(), cashierToken: 'expired-switch-token', sale: { number: num(), lines: [{ lineNo: 1, itemId: bag.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '1000' }] };
    const res = await T(owner.post('/pos/bills')).send(online).expect(403);
    expect(res.body.code).toBe('CASHIER_SWITCH_EXPIRED');
    counter--;
  });

  it('an unknown or revoked till computer answers 403 TILL_NOT_REGISTERED, not 401', async () => {
    const res = await T(owner.post('/pos/bills'), 'not-a-till-token').send(offline([charged(bag.id, '1000')])).expect(403);
    expect(res.body.code).toBe('TILL_NOT_REGISTERED');
    const none = await owner.get(`/pos/till/${tillId}/snapshot`).expect(403);
    expect(none.body.code).toBe('TILL_NOT_REGISTERED');
    counter--;
  });
});

describe('audit 5: the same bill identity with other content', () => {
  let bag: { id: string };
  beforeAll(async () => {
    bag = await item('Tote Bag', '1000');
  });

  it('the same content again returns the saved bill; other content is refused with 409 BILL_ALREADY_SAVED; the till can ask by its identity', async () => {
    const tx = offline([charged(bag.id, '1000')]);
    const first = await made(T(owner.post('/pos/bills')).send(tx));
    const again = await T(owner.post('/pos/bills')).send(tx).expect(201);
    expect(again.body).toMatchObject({ repeated: true, sale: { id: (first.sale as unknown as { id: string }).id } });
    const other = { ...tx, sale: { ...tx.sale, lines: [{ lineNo: 1, ...charged(bag.id, '1000'), quantity: '2', charged: { ...charged(bag.id, '1000').charged, lineTotal: '2000.00' } }] }, payments: [{ paymentMethodId: pm.CASH, amount: '2000.00' }] };
    const refused = await T(owner.post('/pos/bills')).send(other).expect(409);
    expect(refused.body).toMatchObject({ code: 'BILL_ALREADY_SAVED', transaction: { sale: { number: tx.sale.number } } });
    expect((await T(owner.get(`/pos/bills/by-client/${tx.clientId}`)).expect(200)).body).toMatchObject({ saved: true, transaction: { sale: { number: tx.sale.number } } });
    expect((await T(owner.get(`/pos/bills/by-client/${randomUUID()}`)).expect(200)).body).toMatchObject({ saved: false, problem: null });
  });
});

describe('audit 5: bills the server refused (C3)', () => {
  let bag: { id: string };
  beforeAll(async () => {
    bag = await item('Clutch', '1000');
  });

  it('every 4xx refusal of an offline bill is kept with the bill; the office posts it into the till’s open shift, flagged posted_by_office', async () => {
    // A bill sent with a shift the server does not know (a 400), and one with an item that does not exist (a 404).
    const lost = offline([charged(bag.id, '1000')], { shiftClientId: randomUUID() });
    await T(owner.post('/pos/bills')).send(lost).expect(400);
    const ghost = offline([charged(randomUUID(), '1000')]);
    await T(owner.post('/pos/bills')).send(ghost).expect(404);
    const problems = (await owner.get('/pos/reports/sync-problems').expect(200)).body as { id: string; clientId: string; error: string }[];
    const lostProblem = problems.find((p) => p.clientId === lost.clientId)!;
    const ghostProblem = problems.find((p) => p.clientId === ghost.clientId)!;
    expect(lostProblem.error).toMatch(/Open a shift/);
    expect(ghostProblem).toBeTruthy();
    expect((await T(owner.get(`/pos/bills/by-client/${lost.clientId}`)).expect(200)).body).toMatchObject({ saved: false, problem: { resolvedAt: null } });

    const posted = (await owner.post(`/pos/sync-problems/${lostProblem.id}/post`).expect(200)).body;
    expect(posted.sale.checkFlags).toContain('posted_by_office');
    expect(posted.sale.number).toBe(lost.sale.number);
    const shift = await prisma.shift.findFirstOrThrow({ where: { tillId, status: 'open' } });
    expect(posted.sale.shiftId).toBe(shift.id);
    const after = (await owner.get('/pos/reports/sync-problems?all=true').expect(200)).body as { id: string; resolvedAt: string | null; resolution: string }[];
    expect(after.find((p) => p.id === lostProblem.id)).toMatchObject({ resolution: expect.stringMatching(/Posted into the shift/) });
    // Posting it again is refused (resolved); the till's own resend now finds the saved bill.
    await owner.post(`/pos/sync-problems/${lostProblem.id}/post`).expect(400);
    expect((await T(owner.post('/pos/bills')).send({ ...lost, shiftClientId }).expect(201)).body.repeated).toBe(true);
    // A bill that still cannot be saved stays open, with the reason.
    await owner.post(`/pos/sync-problems/${ghostProblem.id}/post`).expect(404);
    expect(((await owner.get('/pos/reports/sync-problems').expect(200)).body as { id: string }[]).some((p) => p.id === ghostProblem.id)).toBe(true);
  });
});

describe('audit 5: approvals tied to the figure, shifts and the drawer (C4, C5, C7, C8)', () => {
  let t2: string;
  let t2Token: string;
  let bag: { id: string };

  beforeAll(async () => {
    bag = await item('Wallet', '1000');
    t2 = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T2', name: 'Counter 2', locationId: loc['MAIN-FLOOR'], priceListId: listId, allowPriceChange: true, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
    t2Token = (await owner.post(`/pos/tills/${t2}/register`).send({ deviceName: 'PC 2' }).expect(201)).body.token;
  });

  const open2 = async (extra: Record<string, unknown> = {}) => (await T(owner.post('/pos/shifts'), t2Token).send({ clientId: randomUUID(), tillId: t2, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }], ...extra }).expect(201)).body as { id: string; businessDate: string };

  it('a bill discount approval is for the discount the manager saw', async () => {
    const bill = (amount: string, approvalToken: string) => ({ clientId: randomUUID(), tillId, soldAt: now(), billDiscount: { amount, approvalToken }, sale: { number: num(), lines: [{ lineNo: 1, itemId: bag.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: (1000 - Number(amount)).toFixed(2) }] });
    const small = await approve('bill_discount', { amount: '50' });
    expect((await T(owner.post('/pos/bills')).send(bill('100', small)).expect(403)).body.message).toMatch(/approved a bill discount of ₹50.00/);
    counter--;
    const right = await approve('bill_discount', { amount: '100' });
    await made(T(owner.post('/pos/bills')).send(bill('100', right)));
  });

  it('closing: a cash difference approval is for the difference counted; the drawer entry is dated on the shift’s business date', async () => {
    const shift = await open2();
    // Opened yesterday (a shift closed after midnight, C2).
    const yesterday = addDays(businessDate(), -1);
    await prisma.shift.update({ where: { id: shift.id }, data: { businessDate: new Date(`${yesterday}T00:00:00Z`) } });
    const close = (approvalToken: string) => T(owner.post(`/pos/shifts/${shift.id}/close`), t2Token).send({ denominations: { '500': 1, '100': 3 }, remarks: 'Short', approvalToken });
    const wrong = await approve('cash_difference', { amount: '150' }, t2);
    expect((await close(wrong).expect(403)).body.message).toMatch(/approved a difference of ₹150.00/);
    const right = await approve('cash_difference', { amount: '200' }, t2);
    await close(right).expect(200);
    const drawer = await prisma.ledgerEntry.findFirstOrThrow({ where: { documentType: 'pos_shift', documentId: shift.id, remark: { contains: 'drawer' } } });
    expect(drawer.entryDate.toISOString().slice(0, 10)).toBe(yesterday);
  });

  it('the till’s saved copy carries receipt copies, the last counted cash, the cash-out limit, blind count and the offline limits', async () => {
    await owner.patch('/pos/settings').send({ cashOutApprovalAbove: '1500', blindCount: true, printReceiptCopies: 2 }).expect(200);
    const snap = (await T(owner.get(`/pos/till/${t2}/snapshot`), t2Token).expect(200)).body.till;
    expect(snap).toMatchObject({ receiptCopies: 2, lastCloseCash: [{ paymentMethodId: pm.CASH, amount: '800.00' }], cashOutApprovalAbove: '1500.00', blindCount: true, offlineWarnHours: 24, offlineStopHours: 48 });
    // The till allows price changes, the company does not (the default): the till is told it may not.
    expect(snap.allowPriceChange).toBe(false);
    await owner.patch('/pos/settings').send({ cashOutApprovalAbove: '2000', blindCount: false, printReceiptCopies: 1 }).expect(200);
    expect((await owner.get('/pos/settings').expect(200)).body).toMatchObject({ cashOutApprovalAbove: '2000.00', blindCount: false });
  });

  it('a cash out above the set amount needs a manager’s approval for that amount (C5)', async () => {
    const shift = await open2();
    const out = (amount: string, approvalToken?: string) => T(owner.post(`/pos/shifts/${shift.id}/cash-movements`), t2Token).send({ clientId: randomUUID(), direction: 'out', amount, reason: 'Paid the tailor', ...(approvalToken ? { approvalToken } : {}) });
    await out('500').expect(201);
    expect((await out('2500').expect(403)).body.message).toMatch(/needs a manager/);
    expect((await out('2500', await approve('cash_out', { amount: '1000' }, t2)).expect(403)).body.message).toMatch(/approved a cash out of ₹1000.00/);
    await out('2500', await approve('cash_out', { amount: '2500' }, t2)).expect(201);
  });

  it('every drawer opening is recorded once; a No-sale needs a manager (C4), and shows on the shift', async () => {
    const shift = await prisma.shift.findFirstOrThrow({ where: { tillId: t2, status: 'open' } });
    const sale = { clientId: randomUUID(), tillId: t2, kind: 'sale', at: now(), billClientId: randomUUID() };
    const first = (await T(owner.post('/pos/drawer-openings'), t2Token).send(sale).expect(201)).body;
    const again = (await T(owner.post('/pos/drawer-openings'), t2Token).send(sale).expect(201)).body;
    expect(again.id).toBe(first.id);
    await T(owner.post('/pos/drawer-openings'), t2Token).send({ clientId: randomUUID(), tillId: t2, kind: 'no_sale', at: now() }).expect(400);
    const manager = await approve('open_drawer', {}, t2);
    const noSale = (await T(owner.post('/pos/drawer-openings'), t2Token).send({ clientId: randomUUID(), tillId: t2, kind: 'no_sale', at: now(), approvalToken: manager }).expect(201)).body;
    expect(noSale).toMatchObject({ kind: 'no_sale', approvedById: ownerId, shiftId: shift.id });
    const logged = await prisma.auditLog.findMany({ where: { entityType: 'cash_drawer' } });
    expect(logged).toHaveLength(2);
    expect(logged.find((l) => l.entityId === noSale.id)!.changes).toMatchObject({ till: 'T2', kind: 'no_sale', shiftId: shift.id, byId: ownerId });
    const detail = (await owner.get(`/pos/shifts/${shift.id}`).expect(200)).body;
    expect(detail.drawerOpenings.map((d: { kind: string }) => d.kind)).toEqual(['sale', 'no_sale']);
  });

  it('the office cancels only an empty shift opened online more than 12 hours ago; the database keeps one open shift per till', async () => {
    const shift = await prisma.shift.findFirstOrThrow({ where: { tillId: t2, status: 'open' } });
    expect((await owner.post(`/pos/shifts/${shift.id}/cancel`).send({ reason: 'Left open' }).expect(403)).body.message).toMatch(/Close the shift on the till/);
    // Opened from the till's queue (it reached the server long after it was opened): never.
    const longAgo = new Date(Date.now() - 13 * 3600_000);
    await prisma.shift.update({ where: { id: shift.id }, data: { openedAt: longAgo } });
    expect((await owner.post(`/pos/shifts/${shift.id}/cancel`).send({ reason: 'Left open' }).expect(403)).body.message).toMatch(/opened while the till was offline/);
    await prisma.shift.update({ where: { id: shift.id }, data: { createdAt: longAgo } });
    await owner.post(`/pos/shifts/${shift.id}/cancel`).send({ reason: 'Left open' }).expect(200);

    const open = await open2();
    await expect(prisma.shift.create({ data: { companyId: (await prisma.company.findFirstOrThrow()).id, tillId: t2, clientId: randomUUID(), businessDate: new Date(), openedById: ownerId, openedAt: new Date() } })).rejects.toThrow();
    expect(open.id).toBeTruthy();
  });
});
