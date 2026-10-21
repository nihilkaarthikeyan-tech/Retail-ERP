// Copyright (c) 2026, Rademics. All rights reserved.
// Automated version of docs/acceptance-tests.md scenario 11.24 (Tally export, plan 11 part 2 §4).
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

const today = () => businessDate();

interface ParsedVoucher {
  id: string;
  type: string;
  date: string;
  number: string;
  narration: string;
  lines: { ledger: string; deemedPositive: boolean; amount: Decimal }[];
}

const unescape = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name.replace('.', '\\.')}>([\\s\\S]*?)</${name.replace('.', '\\.')}>`).exec(xml);
  return m ? unescape(m[1]) : '';
};

/** Reads the vouchers back out of the export file. */
function parseVouchers(xml: string): ParsedVoucher[] {
  const out: ParsedVoucher[] = [];
  for (const m of xml.matchAll(/<VOUCHER REMOTEID="([^"]+)" VCHTYPE="([^"]+)" ACTION="Create">([\s\S]*?)<\/VOUCHER>/g)) {
    const body = m[3];
    const lines = [...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map((l) => ({
      ledger: tag(l[1], 'LEDGERNAME'),
      deemedPositive: tag(l[1], 'ISDEEMEDPOSITIVE') === 'Yes',
      amount: new Decimal(tag(l[1], 'AMOUNT')),
    }));
    out.push({ id: m[1], type: unescape(m[2]), date: tag(body, 'DATE'), number: tag(body, 'VOUCHERNUMBER'), narration: tag(body, 'NARRATION'), lines });
  }
  return out;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

describe('11.24 Tally export', () => {
  let tills: Record<string, { id: string; token: string; prefix: string; n: number }>;
  let pm: Record<string, string>;
  let supplier: { id: string; name: string };
  let expenseId: string;
  let firstFile: Buffer;
  const day = () => today().replaceAll('-', '');

  async function tillSale(code: 'MAIN' | 'ANNA', itemId: string, amount: string) {
    const t = tills[code];
    const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', t.token);
    const shift = (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId: t.id, cash: [{ paymentMethodId: pm.CASH, amount: '0' }] }).expect(201)).body;
    const number = `${t.prefix}${String(++t.n).padStart(6, '0')}`;
    await T(owner.post('/pos/bills'))
      .send({ clientId: randomUUID(), tillId: t.id, soldAt: new Date().toISOString(), sale: { number, lines: [{ lineNo: 1, itemId, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CARD, amount, reference: `C-${code}` }] })
      .expect(201);
    await T(owner.post(`/pos/shifts/${shift.id}/close`)).send({ denominations: {}, counted: [{ paymentMethodId: pm.CARD, amount }] }).expect(200);
    return shift.id as string;
  }

  async function exportFile(agent: Agent, query: string) {
    const res = await agent
      .get(`/tally/vouchers?${query}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    return { res, data: res.body as Buffer };
  }

  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
    await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
    MAIN = await storeId(prisma, 'MAIN');
    ANNA = await storeId(prisma, 'ANNA');
    const loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
    const pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
    const groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GIFT', name: 'Gifts' }).expect(201)).body.id;
    const listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
    await owner.post('/pos/gst-rates').send({ hsnCode: '9503', rate: '12', effectiveFrom: '2026-04-01' }).expect(201);
    pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    tills = {};
    for (const [code, store, location, tillCode] of [['MAIN', MAIN, 'MAIN-FLOOR', 'T1'], ['ANNA', ANNA, 'ANNA-FLOOR', 'T2']] as const) {
      const till = (
        await owner
          .post('/pos/tills')
          .send({ storeId: store, code: tillCode, name: `${code} counter`, locationId: loc[location], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD, isDefault: false }] })
          .expect(201)
      ).body;
      const token = (await owner.post(`/pos/tills/${till.id}/register`).send({ deviceName: `${code} PC` }).expect(201)).body.token;
      tills[code] = { id: till.id, token, prefix: `${till.numberPrefix}/2627/`, n: 0 };
    }
    const toy = (await owner.post('/items').send({ name: 'Wooden toy train', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '9503', isStockItem: false }).expect(201)).body;
    await owner.post('/prices').send({ priceListId: listId, itemId: toy.id, price: '560', startDate: '2026-04-01' }).expect(201);

    // The day: a till sale at each store, a supplier bill, a payment to the supplier and an expense.
    await tillSale('MAIN', toy.id, '560');
    await tillSale('ANNA', toy.id, '560');
    const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
    const groups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
    supplier = (await owner.post('/suppliers').send({ name: 'Sri Murugan Toys & Co', supplierGroupId: groups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body;
    const service = (await owner.post('/items').send({ name: 'Shop repairs', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '9503', isStockItem: false }).expect(201)).body;
    const bill = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId: supplier.id, supplierBillNo: 'SMT/77', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: service.id, quantity: '1', rate: '1500', gstRate: '0' }] }).expect(201)).body;
    await owner.post(`/purchase/bills/${bill.id}/finalise`).send({}).expect(200);
    const tree = (await owner.get('/accounts').expect(200)).body;
    const bankFolder = tree.accounts.find((a: { systemKey: string }) => a.systemKey === 'bank_group');
    const bank = (await owner.post('/accounts').send({ parentId: bankFolder.id, name: 'HDFC Current', kind: 'bank' }).expect(201)).body.id as string;
    const pay = (await owner.post('/payments').send({ kind: 'payment', paymentDate: today(), partyType: 'supplier', partyId: supplier.id, fromAccountId: bank, amount: '1500', reference: 'NEFT-9', referenceDate: today() }).expect(201)).body;
    await owner.post(`/payments/${pay.id}/post`).expect(200);
    const rent = (await prisma.account.findFirstOrThrow({ where: { systemKey: 'rent' } })).id;
    expenseId = (await owner.post('/expenses').send({ expenseDate: today(), storeId: ANNA, expenseAccountId: rent, paidFromAccountId: bank, amount: '12000', remark: 'October rent' }).expect(201)).body.id;
  });

  it('the ledger-name map lists every account pre-filled with our name; changes are saved and recorded in the history', async () => {
    const map = (await owner.get('/tally/ledger-map').expect(200)).body.rows as { accountId: string; name: string; tallyLedger: string; mapped: boolean; tallyGroup: string }[];
    const sales = map.find((r) => r.name === 'Sales')!;
    const card = map.find((r) => r.name === 'Card settlement')!;
    expect(sales).toMatchObject({ tallyLedger: 'Sales', mapped: false, tallyGroup: 'Sales Accounts' });
    expect(map.find((r) => r.name === 'HDFC Current')).toMatchObject({ tallyGroup: 'Bank Accounts' });
    expect(map.every((r) => r.tallyLedger === r.name)).toBe(true);

    await owner.put('/tally/ledger-map').send({ rows: [{ accountId: sales.accountId, tallyLedger: 'Sales <bad>' }] }).expect(400);
    const saved = (
      await owner
        .put('/tally/ledger-map')
        .send({ rows: [{ accountId: sales.accountId, tallyLedger: 'Sales Account' }, { accountId: card.accountId, tallyLedger: 'Card Machine - HDFC' }] })
        .expect(200)
    ).body.rows as typeof map;
    expect(saved.find((r) => r.accountId === sales.accountId)).toMatchObject({ tallyLedger: 'Sales Account', mapped: true });
    expect(await prisma.tallyLedgerMap.count()).toBe(2);
    // Saving the same names again changes nothing; blank goes back to our own name.
    await owner.put('/tally/ledger-map').send({ rows: [{ accountId: sales.accountId, tallyLedger: 'Sales Account' }] }).expect(200);
    const history = await prisma.auditLog.findMany({ where: { entityType: 'tally_ledger_map' } });
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.entityId === sales.accountId)?.changes).toMatchObject({ tallyLedger: { old: 'Sales', new: 'Sales Account' } });
  });

  it('one voucher for each entry of the day, every voucher balanced, using the mapped ledger names and the parties’ own names', async () => {
    const { res, data } = await exportFile(owner, `from=${today()}&to=${today()}`);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="tally-vouchers-${today()}-to-${today()}.xml"`);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    firstFile = data;
    const xml = data.toString('utf8');
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(xml).toContain('<SVCURRENTCOMPANY>Rademics Retail Pvt Ltd</SVCURRENTCOMPANY>');
    const vouchers = parseVouchers(xml);

    // Every ledger entry of the day is exactly one voucher.
    const entries = await prisma.ledgerEntry.findMany({ where: { isOpening: false } });
    expect(vouchers.map((v) => v.id).sort()).toEqual(entries.map((e) => e.id).sort());

    for (const v of vouchers) {
      expect(v.date).toBe(day());
      const total = v.lines.reduce((s, l) => s.add(l.amount), new Decimal(0));
      expect(total.toFixed(2), `${v.number} balances`).toBe('0.00');
      // Debits are negative with ISDEEMEDPOSITIVE Yes; credits positive with No.
      for (const l of v.lines) expect(l.deemedPositive).toBe(l.amount.lt(0));
      expect(v.lines.length).toBeGreaterThanOrEqual(2);
    }

    const sales = vouchers.filter((v) => v.type === 'Sales');
    expect(sales).toHaveLength(2);
    expect(sales.map((v) => v.narration.slice(0, 6)).sort()).toEqual(['[ANNA]', '[MAIN]']);
    for (const v of sales) {
      expect(v.number).toMatch(/^T[12] /);
      expect(v.lines.find((l) => l.ledger === 'Card Machine - HDFC')?.amount.toFixed(2)).toBe('-560.00');
      expect(v.lines.find((l) => l.ledger === 'Sales Account')?.amount.toFixed(2)).toBe('500.00');
      expect(v.lines.map((l) => l.ledger)).not.toContain('Sales');
    }

    const purchase = vouchers.filter((v) => v.type === 'Purchase');
    expect(purchase).toHaveLength(1);
    expect(purchase[0].lines.find((l) => l.ledger === 'Sri Murugan Toys & Co')?.amount.toFixed(2)).toBe('1500.00');
    expect(xml).toContain('Sri Murugan Toys &amp; Co');

    const payment = vouchers.filter((v) => v.type === 'Payment');
    expect(payment).toHaveLength(1);
    expect(payment[0].number).toMatch(/^PAY-2026-27-/);
    expect(payment[0].lines.map((l) => [l.ledger, l.amount.toFixed(2)]).sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ['HDFC Current', '1500.00'],
      ['Sri Murugan Toys & Co', '-1500.00'],
    ]);
    // Party lines go to the party, never to the control account.
    expect(vouchers.flatMap((v) => v.lines.map((l) => l.ledger))).not.toContain('Supplier balances');

    const expense = vouchers.filter((v) => v.number.startsWith('EXP-'));
    expect(expense).toHaveLength(1);
    expect(expense[0]).toMatchObject({ type: 'Journal', narration: '[ANNA] October rent' });
    expect(expense[0].lines.map((l) => [l.ledger, l.amount.toFixed(2)])).toEqual([
      ['Rent', '-12000.00'],
      ['HDFC Current', '12000.00'],
    ]);
    expect(vouchers).toHaveLength(5);
  });

  it('exporting the same day again gives the identical file, and each export is recorded in the history', async () => {
    const again = (await exportFile(owner, `from=${today()}&to=${today()}`)).data;
    expect(again.equals(firstFile)).toBe(true);
    const logged = await prisma.auditLog.findMany({ where: { action: 'export', entityType: 'report' }, orderBy: { id: 'asc' } });
    const tally = logged.filter((l) => (l.changes as { report?: string }).report === 'Tally vouchers');
    expect(tally).toHaveLength(2);
    expect(tally[0].changes).toMatchObject({ filters: { from: today(), to: today(), store: null } });
  });

  it('one store only; a cancelled expense is exported with its cancellation, netting to zero', async () => {
    const anna = parseVouchers((await exportFile(owner, `from=${today()}&to=${today()}&storeId=${ANNA}`)).data.toString('utf8'));
    expect(anna.filter((v) => v.type === 'Sales')).toHaveLength(1);
    expect(anna.every((v) => v.narration.startsWith('[ANNA]'))).toBe(true);

    await owner.post(`/expenses/${expenseId}/cancel`).send({ reason: 'Paid twice by mistake' }).expect(200);
    const after = parseVouchers((await exportFile(owner, `from=${today()}&to=${today()}`)).data.toString('utf8'));
    const exp = after.filter((v) => v.number.startsWith('EXP-'));
    expect(exp).toHaveLength(2);
    expect(exp[1].number).toBe(`${exp[0].number}/2`);
    expect(exp[1].narration).toContain(`Cancels voucher ${exp[0].number}.`);
    const rent = exp.flatMap((v) => v.lines.filter((l) => l.ledger === 'Rent')).reduce((s, l) => s.add(l.amount), new Decimal(0));
    expect(rent.toFixed(2)).toBe('0.00');
    // The books themselves are untouched by exporting.
    expect(await prisma.tallyLedgerMap.count()).toBe(2);
  });

  it('the ledger list gives every ledger with its Tally group, parties under Sundry Debtors or Sundry Creditors', async () => {
    const res = await owner
      .get('/tally/ledgers')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="tally-ledgers.xml"');
    const xml = (res.body as Buffer).toString('utf8');
    expect(xml).toContain('<REPORTNAME>All Masters</REPORTNAME>');
    expect(xml).toMatch(/<LEDGER NAME="Sales Account" ACTION="Create">[\s\S]*?<PARENT>Sales Accounts<\/PARENT>/);
    expect(xml).toMatch(/<LEDGER NAME="Sri Murugan Toys &amp; Co" ACTION="Create">[\s\S]*?<PARENT>Sundry Creditors<\/PARENT>/);
    expect(xml).toMatch(/<LEDGER NAME="HDFC Current" ACTION="Create">[\s\S]*?<PARENT>Bank Accounts<\/PARENT>/);
  });

  it('a wrong period is refused; only those with the Tally right may export; the accountant may', async () => {
    expect((await owner.get('/tally/vouchers?from=2026-10-20&to=2026-10-01').expect(400)).body.message).toMatch(/start date is after the end date/);
    await owner.post('/users').send({ firstName: 'Divya', email: 'divya@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'store_manager')], storeIds: [MAIN] }).expect(201);
    const manager = await login(app, 'divya@rademics.test', 'Temp-pass-1234');
    await manager.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await manager.get(`/tally/vouchers?from=${today()}&to=${today()}`).expect(403);
    await manager.get('/tally/ledgers').expect(403);
    await manager.put('/tally/ledger-map').send({ rows: [] }).expect(403);
    await owner.post('/users').send({ firstName: 'Arun', email: 'arun@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'accountant')], storeIds: [MAIN] }).expect(201);
    const accountant = await login(app, 'arun@rademics.test', 'Temp-pass-1234');
    await accountant.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await exportFile(accountant, `from=${today()}&to=${today()}`);
  });
});
