// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 11":
// 11.18 expense entry and cash book (C8), 11.19 customer purchases and birthdays (C9, C10).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, Decimal } from 'shared';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let n = 0;

const today = () => businessDate();
const FY_START = '2026-04-01';

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  n = 0;
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
}

async function staff(firstName: string, email: string, role: string, stores: string[]) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: stores }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

async function acct(key: string): Promise<string> {
  return (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
}

/** Debit minus credit of an account (optionally for one store), as "12.34". */
async function bal(key: string, store?: string): Promise<string> {
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: await acct(key), ...(store ? { storeId: store } : {}) }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

async function expectBooks() {
  const health = (await owner.get('/reports/book-health').expect(200)).body;
  expect(health.problems).toEqual([]);
  const tb = (await owner.get(`/reports/trial-balance?from=${FY_START}&to=${today()}`).expect(200)).body;
  expect(tb.balanced).toBe(true);
}

interface CashBookDto {
  book: 'cash' | 'bank';
  opening: string;
  moneyIn: string;
  moneyOut: string;
  closing: string;
  ledgerClosing: string;
  matchesLedger: boolean;
  days: { date: string; opening: string; moneyIn: string; moneyOut: string; closing: string }[];
  rows: { date: string; documentNumber: string | null; against: string; moneyIn: string; moneyOut: string; balance: string; cancelled: boolean }[];
  total: number;
  pageOpening: string;
}

describe('11.18 expense entry and cash book (C8)', () => {
  let cashMain: string;
  let rent: string;
  let expenseId: string;
  let manager: Agent;
  beforeAll(async () => {
    await freshCompany();
    // The chart and each store's cash accounts are made when the accounts are first used.
    await owner.get('/expenses/options').expect(200);
    cashMain = await acct(`cash_in_hand:${MAIN}`);
    rent = await acct('rent');
    manager = await staff('Divya', 'divya@rademics.test', 'store_manager', [ANNA]);
  });
  afterAll(expectBooks);

  it('offers expense heads, the store’s cash in hand and the banks; system expense accounts are not heads', async () => {
    const o = (await owner.get('/expenses/options').expect(200)).body;
    const heads = o.heads.map((h: { name: string }) => h.name);
    expect(heads).toEqual(expect.arrayContaining(['Rent', 'Salaries and wages', 'Electricity']));
    expect(heads).not.toContain('Stock written off');
    expect(heads).not.toContain('Cost of goods sold');
    expect(heads).not.toContain('Cash short or over');
    expect(o.cashInHand.find((c: { storeId: string }) => c.storeId === MAIN).account.id).toBe(cashMain);
    // A store manager sees only their own store.
    const m = (await manager.get('/expenses/options').expect(200)).body;
    expect(m.stores.map((s: { code: string }) => s.code)).toEqual(['ANNA']);
  });

  it('cash in hand must stay debit: an expense larger than the cash is refused with a plain message', async () => {
    await owner.patch(`/accounts/${cashMain}`).send({ balanceMustBe: 'debit' }).expect(200);
    const res = await owner.post('/expenses').send({ expenseDate: today(), storeId: MAIN, expenseAccountId: rent, paidFromAccountId: cashMain, amount: '30000' }).expect(400);
    expect(res.body.message).toMatch(/Cash in hand — MAIN must always have a debit balance; this would make it ₹30,?000\.00 credit/);
    expect(await prisma.journal.count({ where: { kind: 'expense' } })).toBe(0);
  });

  it('₹30,000 rent in cash at MAIN: rent debited, MAIN’s cash in hand credited, MAIN as the store', async () => {
    // ₹50,000 put into MAIN's cash in hand first (an opening journal).
    const j = (
      await owner
        .post('/journals')
        .send({ kind: 'opening', journalDate: FY_START, lines: [{ accountId: cashMain, storeId: MAIN, debit: '50000' }, { accountId: await acct('temporary_opening'), credit: '50000' }] })
        .expect(201)
    ).body;
    await owner.post(`/journals/${j.id}/post`).expect(200);

    const e = (await owner.post('/expenses').send({ expenseDate: today(), storeId: MAIN, expenseAccountId: rent, paidFromAccountId: cashMain, amount: '30000.00', reference: 'Oct rent', remark: 'October rent' }).expect(201)).body;
    expenseId = e.id;
    expect(e.number).toBe('EXP-2026-27-00001');
    expect(e.status).toBe('posted');
    expect(e.amount).toBe('30000.00');
    expect(e.store.code).toBe('MAIN');
    expect(e.expenseAccount.name).toBe('Rent');
    expect(e.paidFromKind).toBe('cash');

    expect(await bal('rent', MAIN)).toBe('30000.00');
    expect(await bal(`cash_in_hand:${MAIN}`)).toBe('20000.00');
    const lines = await prisma.ledgerLine.findMany({ where: { entry: { documentType: 'journal', documentId: e.id } } });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.storeId === MAIN)).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'expense', entityId: e.id } });
    expect(audit).not.toBeNull();

    const list = (await owner.get('/expenses').expect(200)).body;
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual([e.id]);
    expect(list.postedTotal).toBe('30000.00');
  });

  it('the cash book shows it under money out on that day, and the closing balance matches the ledger', async () => {
    const book = (await owner.get(`/reports/cash-book?storeId=${MAIN}&from=${FY_START}&to=${today()}`).expect(200)).body as CashBookDto;
    expect(book.book).toBe('cash');
    expect(book.opening).toBe('0.00');
    const day = book.days.find((d) => d.date === today())!;
    expect(day.moneyOut).toBe('30000.00');
    const row = book.rows.find((r) => r.documentNumber === 'EXP-2026-27-00001')!;
    expect(row.moneyOut).toBe('30000.00');
    expect(row.against).toBe('Rent');
    expect(book.moneyIn).toBe('50000.00');
    expect(book.moneyOut).toBe('30000.00');
    expect(book.closing).toBe('20000.00');
    expect(book.closing).toBe(book.ledgerClosing);
    expect(book.closing).toBe(await bal(`cash_in_hand:${MAIN}`));
    expect(book.matchesLedger).toBe(true);
    // The same book by the account, a page at a time: the second page carries on from the first.
    const page2 = (await owner.get(`/reports/cash-book?accountId=${cashMain}&from=${FY_START}&to=${today()}&pageSize=1&page=2`).expect(200)).body as CashBookDto;
    expect(page2.total).toBe(2);
    expect(page2.pageOpening).toBe('50000.00');
    expect(page2.rows[0].balance).toBe('20000.00');
    expect(page2.closing).toBe('20000.00');
    // A day before the expense: the opening carries the earlier days.
    if (today() > FY_START) {
      const later = (await owner.get(`/reports/cash-book?storeId=${MAIN}&from=${today()}&to=${today()}`).expect(200)).body as CashBookDto;
      expect(later.opening).toBe('50000.00');
      expect(later.closing).toBe('20000.00');
    }
  });

  it('a bank book; only cash and bank accounts have a book', async () => {
    const tree = (await owner.get('/accounts').expect(200)).body;
    const folder = tree.accounts.find((a: { systemKey: string }) => a.systemKey === 'bank_group');
    const bank = (await owner.post('/accounts').send({ parentId: folder.id, name: 'HDFC Current', kind: 'bank' }).expect(201)).body.id as string;
    await owner.post('/expenses').send({ expenseDate: today(), storeId: ANNA, expenseAccountId: await acct('electricity'), paidFromAccountId: bank, amount: '1200.50' }).expect(201);
    const book = (await owner.get(`/reports/cash-book?accountId=${bank}&from=${FY_START}&to=${today()}`).expect(200)).body as CashBookDto;
    expect(book.book).toBe('bank');
    expect(book.moneyOut).toBe('1200.50');
    expect(book.closing).toBe('-1200.50');
    expect(book.matchesLedger).toBe(true);
    expect(book.rows[0].against).toBe('Electricity');
    expect((await owner.get(`/reports/cash-book?accountId=${rent}&from=${FY_START}&to=${today()}`).expect(400)).body.message).toMatch(/not a cash or bank account/);
    expect(await bal('electricity', ANNA)).toBe('1200.50');
  });

  it('refuses a wrong head, paying from another store’s cash, three-decimal amounts and dates outside a financial year', async () => {
    const base = { expenseDate: today(), storeId: MAIN, expenseAccountId: rent, paidFromAccountId: cashMain, amount: '100' };
    expect((await owner.post('/expenses').send({ ...base, expenseAccountId: await acct('sales') }).expect(400)).body.message).toMatch(/not an expense head/);
    expect((await owner.post('/expenses').send({ ...base, expenseAccountId: await acct('write_off') }).expect(400)).body.message).toMatch(/not an expense head/);
    expect((await owner.post('/expenses').send({ ...base, storeId: ANNA }).expect(400)).body.message).toMatch(/ANNA's cash in hand or from a bank account/);
    await owner.post('/expenses').send({ ...base, amount: '10.005' }).expect(400);
    expect((await owner.post('/expenses').send({ ...base, expenseDate: '2025-05-01' }).expect(400)).body.message).toMatch(/No financial year covers 2025-05-01/);
    // Expenses are not made on the journal form.
    await owner
      .post('/journals')
      .send({ kind: 'expense', journalDate: today(), lines: [{ accountId: rent, storeId: MAIN, debit: '1' }, { accountId: cashMain, storeId: MAIN, credit: '1' }] })
      .expect(400);
  });

  it('store managers: own store only, and not in locked books', async () => {
    const annaCash = await acct(`cash_in_hand:${ANNA}`);
    await manager.post('/expenses').send({ expenseDate: today(), storeId: MAIN, expenseAccountId: rent, paidFromAccountId: cashMain, amount: '100' }).expect(403);
    await manager.get(`/reports/cash-book?storeId=${MAIN}&from=${FY_START}&to=${today()}`).expect(403);
    await manager.post(`/expenses/${expenseId}/cancel`).send({ reason: 'Not mine' }).expect(403);
    // The manager's list leaves MAIN's expense out.
    expect((await manager.get('/expenses').expect(200)).body.rows.filter((r: { store: { code: string } }) => r.store.code === 'MAIN')).toEqual([]);

    await owner.patch('/accounting/lock-date').send({ lockDate: today(), reason: 'Checking' }).expect(200);
    const locked = await manager.post('/expenses').send({ expenseDate: today(), storeId: ANNA, expenseAccountId: rent, paidFromAccountId: annaCash, amount: '100' }).expect(400);
    expect(locked.body.message).toMatch(/The books are locked up to/);
    await owner.patch('/accounting/lock-date').send({ lockDate: null, reason: 'Done' }).expect(200);
    const ok = (await manager.post('/expenses').send({ expenseDate: today(), storeId: ANNA, expenseAccountId: rent, paidFromAccountId: annaCash, amount: '100' }).expect(201)).body;
    expect(ok.store.code).toBe('ANNA');
  });

  it('cancelling the expense reverses it on the same date, with a reason, once', async () => {
    await owner.post(`/expenses/${expenseId}/cancel`).send({}).expect(400);
    const c = (await owner.post(`/expenses/${expenseId}/cancel`).send({ reason: 'Paid twice by mistake' }).expect(200)).body;
    expect(c.status).toBe('cancelled');
    expect(c.cancelReason).toBe('Paid twice by mistake');
    const entries = await prisma.ledgerEntry.findMany({ where: { documentType: 'journal', documentId: expenseId }, orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(2);
    expect(entries[1].cancelsId).toBe(entries[0].id);
    expect(entries[1].entryDate.toISOString().slice(0, 10)).toBe(entries[0].entryDate.toISOString().slice(0, 10));
    expect(await bal('rent', MAIN)).toBe('0.00');
    expect(await bal(`cash_in_hand:${MAIN}`)).toBe('50000.00');
    await owner.post(`/expenses/${expenseId}/cancel`).send({ reason: 'Again' }).expect(400);
    expect(await prisma.auditLog.count({ where: { entityType: 'expense', entityId: expenseId } })).toBe(2);

    // The cash book leaves the pair out unless asked, and still ends on the ledger.
    const book = (await owner.get(`/reports/cash-book?storeId=${MAIN}&from=${FY_START}&to=${today()}`).expect(200)).body as CashBookDto;
    expect(book.rows.some((r) => r.documentNumber === 'EXP-2026-27-00001')).toBe(false);
    expect(book.closing).toBe('50000.00');
    const all = (await owner.get(`/reports/cash-book?storeId=${MAIN}&from=${FY_START}&to=${today()}&includeCancelled=true`).expect(200)).body as CashBookDto;
    const pair = all.rows.filter((r) => r.documentNumber === 'EXP-2026-27-00001');
    expect(pair.map((r) => [r.moneyIn, r.moneyOut])).toEqual([
      ['0.00', '30000.00'],
      ['30000.00', '0.00'],
    ]);
    expect(all.closing).toBe(all.ledgerClosing);
    const list = (await owner.get('/expenses?status=cancelled').expect(200)).body;
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual([expenseId]);
  });
});

describe('11.19 customer purchases and birthdays (C9, C10)', () => {
  let shirt: { id: string };
  let priya: { id: string };
  let meena: { id: string };
  let tillId: string;
  let tillToken: string;
  let pm: Record<string, string>;
  const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
  const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
  const sale = (customerId: string, quantity: string, amount: string) => ({
    clientId: randomUUID(),
    tillId,
    soldAt: new Date().toISOString(),
    customerId,
    sale: { number: num(), lines: [{ lineNo: 1, itemId: shirt.id, quantity }] },
    payments: [{ paymentMethodId: pm.CASH, amount }],
  });

  beforeAll(async () => {
    await freshCompany();
    const loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
    const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
    const groupId = (await owner.post('/catalogue/item-groups').send({ code: 'MENS', name: 'Menswear' }).expect(201)).body.id;
    const listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
    await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
    pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    tillId = (
      await owner
        .post('/pos/tills')
        .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] })
        .expect(201)
    ).body.id;
    tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
    shirt = (await owner.post('/items').send({ name: 'Linen shirt', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6205' }).expect(201)).body;
    await owner.post('/prices').send({ priceListId: listId, itemId: shirt.id, price: '1050', startDate: '2026-04-01' }).expect(201);
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: shirt.id, countedQuantity: '50', unitCost: '600' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
    await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '2000' }] }).expect(201);
  });

  it('birthdays and anniversaries are real days and months; the year is optional and must fit', async () => {
    await owner.post('/customers').send({ name: 'Bad Date', birthday: '02-30' }).expect(400);
    await owner.post('/customers').send({ name: 'Bad Year', birthYear: 1990 }).expect(400);
    expect((await owner.post('/customers').send({ name: 'Leap', birthday: '02-29', birthYear: 2023 }).expect(400)).body.message).toBeTruthy();
    const ok = (await owner.post('/customers').send({ name: 'Leap Baby', birthday: '02-29', birthYear: 2024, anniversary: '11-20' }).expect(201)).body;
    expect(ok.birthday).toBe('02-29');
    expect(ok.birthYear).toBe(2024);
    expect(ok.anniversaryYear).toBeNull();
    // A year sent alone is checked against the saved day and month.
    expect((await owner.patch(`/customers/${ok.id}`).send({ birthYear: 2023 }).expect(400)).body.message).toMatch(/Birthday: 2023 had no 29 February/);
    // Clearing the day and month clears the year.
    const cleared = (await owner.patch(`/customers/${ok.id}`).send({ birthday: null }).expect(200)).body;
    expect(cleared.birthday).toBeNull();
    expect(cleared.birthYear).toBeNull();
    // The till's quick add may carry a birthday too.
    const quick = (await owner.post('/customers/quick-add').send({ name: 'Kavya M', mobile: '9840011299', birthday: '03-15' }).expect(201)).body;
    expect(quick.birthday).toBe('03-15');
    await owner.post('/customers/quick-add').send({ name: 'Kavya N', mobile: '9840011298', anniversary: '04-31' }).expect(400);
  });

  it('the purchases tab lists bills and returns, newest first, and this year’s total equals the sales report for the customer', async () => {
    priya = (await owner.post('/customers').send({ name: 'Priya S', mobile: '9840011223', birthday: addDays(today(), 2).slice(5), birthYear: 1996 }).expect(201)).body;
    const other = (await owner.post('/customers').send({ name: 'Arun K', mobile: '9840011224', anniversary: addDays(today(), 10).slice(5) }).expect(201)).body;
    const first = (await T(owner.post('/pos/bills')).send(sale(priya.id, '2', '2100')).expect(201)).body.sale;
    await T(owner.post('/pos/bills')).send(sale(priya.id, '1', '1050')).expect(201);
    await T(owner.post('/pos/bills')).send(sale(other.id, '3', '3150')).expect(201);
    await T(owner.post('/pos/bills'))
      .send({
        clientId: randomUUID(),
        tillId,
        soldAt: new Date().toISOString(),
        customerId: priya.id,
        buyer: { name: 'Walk-in customer' }, ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1', returnOfLineId: first.lines[0].id }] },
        payments: [{ paymentMethodId: pm.CASH, amount: '-1050' }],
      })
      .expect(201);

    const p = (await owner.get(`/customers/${priya.id}/purchases`).expect(200)).body;
    expect(p.total).toBe(3);
    expect(p.rows.map((r: { kind: string }) => r.kind)).toEqual(['return', 'sale', 'sale']);
    expect(p.rows[0].amount).toBe('-1050.00');
    expect(p.rows[0].quantity).toBe('-1');
    expect(p.rows[2].quantity).toBe('2');
    expect(p.rows[2].store.code).toBe('MAIN');
    expect(p.thisYear.name).toBe('2026-27');
    expect(p.thisYear.bills).toBe(2);
    expect(p.thisYear.returns).toBe(1);
    expect(p.thisYear.total).toBe('2100.00');
    expect(p.thisYear.quantity).toBe('2');
    expect(p.lastYear).toBeNull();

    const report = (await owner.get(`/reports/item-sales?customerId=${priya.id}&from=${p.thisYear.from}&to=${today()}`).expect(200)).body;
    expect(p.thisYear.netSales).toBe(report.totals.netSales);
    expect(p.thisYear.netSales).toBe('2000.00');

    const page = (await owner.get(`/customers/${priya.id}/purchases?pageSize=2&page=2`).expect(200)).body;
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].kind).toBe('sale');

    // A store manager of another store sees none of MAIN's bills.
    const manager = await staff('Divya', 'divya2@rademics.test', 'store_manager', [ANNA]);
    const limited = (await manager.get(`/customers/${priya.id}/purchases`).expect(200)).body;
    expect(limited.total).toBe(0);
    expect(limited.thisYear.netSales).toBe('0.00');
    await owner.get(`/customers/${randomUUID()}/purchases`).expect(404);
  });

  it('“birthdays this week” lists the next 7 days, marks no-promotions, and leaves out switched-off customers', async () => {
    meena = (await owner.post('/customers').send({ name: 'Meena R', mobile: '9840011225', anniversary: today().slice(5), anniversaryYear: 2010 }).expect(201)).body;
    const contact = (await owner.get(`/customers/${meena.id}/contacts`).expect(200)).body[0];
    await owner.patch(`/customers/${meena.id}/contacts/${contact.id}`).send({ noPromotions: true }).expect(200);
    const off = (await owner.post('/customers').send({ name: 'Gone Away', birthday: addDays(today(), 1).slice(5) }).expect(201)).body;
    await owner.patch(`/customers/${off.id}/credit`).send({ status: 'off', reason: 'Closed' }).expect(200);

    const list = (await owner.get('/customers/birthdays').expect(200)).body;
    expect(list.from).toBe(today());
    const names = list.rows.map((r: { name: string }) => r.name);
    expect(names).toContain('Priya S');
    expect(names).toContain('Meena R');
    expect(names).not.toContain('Arun K');
    expect(names).not.toContain('Gone Away');
    const p = list.rows.find((r: { name: string }) => r.name === 'Priya S');
    expect(p).toMatchObject({ kind: 'birthday', on: addDays(today(), 2), daysAway: 2, years: Number(addDays(today(), 2).slice(0, 4)) - 1996, noPromotions: false });
    const m = list.rows.find((r: { name: string }) => r.name === 'Meena R');
    expect(m).toMatchObject({ kind: 'anniversary', on: today(), daysAway: 0, noPromotions: true });
    // Soonest first.
    expect(list.rows[0].name).toBe('Meena R');
    // A cashier can see customers, so can see the list too.
    const cashier = await staff('Ravi', 'ravi@rademics.test', 'cashier', [MAIN]);
    await cashier.get('/customers/birthdays?days=14').expect(200);
  });
});
