// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 4".
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, SYSTEM_ROLES } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let loc: Record<string, string>;
let stores: Record<string, string>;
let pcs: string;
let groupId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

/** Fresh company with stores MAIN and ANNA and a catalogue group. */
async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  stores = { MAIN: await storeId(prisma, 'MAIN'), ANNA: await storeId(prisma, 'ANNA') };
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'RICE', name: 'Rice' }).expect(201)).body.id;
}

async function item(name: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, ...extra }).expect(201)).body as { id: string; code: string };
}

/** Creates and finalises a stock document; returns the finalised document. */
async function post(by: Agent, body: Record<string, unknown>, expectStatus = 200) {
  const draft = (await by.post('/stock/documents').send({ storeId: stores.MAIN, ...body }).expect(201)).body;
  const res = await by.post(`/stock/documents/${draft.id}/finalise`).expect(expectStatus);
  return { draft, res: res.body };
}

async function position(itemId: string, code: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc[code] } } });
  return { q: p?.quantity.toString() ?? '0', cost: p?.unitCost.toFixed(4) ?? '0.0000', value: p?.value.toFixed(2) ?? '0.00' };
}

async function expectConsistent() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
}

async function staff(firstName: string, email: string, role: string, store = 'MAIN') {
  await owner
    .post('/users')
    .send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [stores[store]] })
    .expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

describe('setup gives every store its locations', () => {
  beforeAll(freshCompany);
  it('MAIN and ANNA have floor, back room and rejected; the company has transit', () => {
    for (const code of ['MAIN', 'MAIN-FLOOR', 'MAIN-BACK', 'MAIN-REJECT', 'ANNA', 'ANNA-FLOOR', 'ANNA-BACK', 'ANNA-REJECT', 'TRANSIT']) expect(loc[code]).toBeTruthy();
  });
});

describe('4.1–4.5 and 4.7: one item through its life', () => {
  let rice: { id: string; code: string };

  beforeAll(async () => {
    await freshCompany();
    rice = await item('Basmati Rice 1 kg');
  });
  afterAll(expectConsistent);

  it('4.1 opening stock of 100 at ₹90', async () => {
    const count = (
      await owner
        .post('/stock/counts')
        .send({ countType: 'opening', storeId: stores.MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, countedQuantity: '100', unitCost: '90' }] })
        .expect(201)
    ).body;
    expect(count.number).toMatch(/^CNT-MAIN-2026-27-\d{5}$/);
    const done = (await owner.post(`/stock/documents/${count.id}/finalise`).expect(200)).body;
    expect(done.status).toBe('finalised');
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '100', cost: '90.0000', value: '9000.00' });
    const [entry] = (await owner.get(`/stock/ledger?itemId=${rice.id}`).expect(200)).body;
    expect(entry).toMatchObject({ quantityChange: '100', valueChange: '9000.00', accountRole: 'temporary_opening' });
  });

  it('4.2 a stock-in of 50 at ₹96 averages to ₹92', async () => {
    await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '50', unitCost: '96' }] });
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '150', cost: '92.0000', value: '13800.00' });
  });

  it('4.3 a write-off of 3 leaves at ₹92 to the write-off role', async () => {
    const { res } = await post(owner, { kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '3' }] });
    expect(res.totalValueOut).toBe('276.00');
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '147', cost: '92.0000', value: '13524.00' });
    const [latest] = (await owner.get(`/stock/ledger?itemId=${rice.id}`).expect(200)).body;
    expect(latest).toMatchObject({ valueChange: '-276.00', accountRole: 'write_off' });
  });

  it('4.4 a transfer goes through transit at the sending cost; total value never changes', async () => {
    const total = async () => (await owner.get('/stock/balance').expect(200)).body.totals.value;
    const { res: send } = await post(owner, { kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: stores.ANNA, lines: [{ itemId: rice.id, quantity: '20' }] });
    expect(send.toLocationId).toBe(loc.TRANSIT);
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '127', cost: '92.0000', value: '11684.00' });
    expect(await position(rice.id, 'TRANSIT')).toEqual({ q: '20', cost: '92.0000', value: '1840.00' });
    expect(await total()).toBe('13524.00');

    const inTransit = (await owner.get('/stock/transfers/in-transit').expect(200)).body;
    expect(inTransit.map((d: { id: string }) => d.id)).toContain(send.id);

    const first = (await owner.post(`/stock/transfers/${send.id}/receive`).send({ lines: [{ sendLineId: send.lines[0].id, quantity: '15' }] }).expect(201)).body;
    expect(first.kind).toBe('transfer_receive');
    expect(first.toLocationId).toBe(loc['ANNA-FLOOR']);
    expect(await position(rice.id, 'TRANSIT')).toEqual({ q: '5', cost: '92.0000', value: '460.00' });
    expect(await position(rice.id, 'ANNA-FLOOR')).toEqual({ q: '15', cost: '92.0000', value: '1380.00' });
    expect((await owner.get(`/stock/documents/${send.id}`).expect(200)).body.lines[0].receivedQuantity).toBe('15');
    expect(await total()).toBe('13524.00');

    await owner.post(`/stock/transfers/${send.id}/receive`).send({ lines: [{ sendLineId: send.lines[0].id, quantity: '6' }] }).expect(400);
    await owner.post(`/stock/transfers/${send.id}/receive`).send({}).expect(201);
    expect(await position(rice.id, 'TRANSIT')).toEqual({ q: '0', cost: '92.0000', value: '0.00' });
    expect(await position(rice.id, 'ANNA-FLOOR')).toEqual({ q: '20', cost: '92.0000', value: '1840.00' });
    expect((await owner.get('/stock/transfers/in-transit').expect(200)).body.map((d: { id: string }) => d.id)).not.toContain(send.id);
    expect(await total()).toBe('13524.00');

    // Filtering by a parent group includes items in its sub-groups.
    const parent = (await owner.post('/catalogue/item-groups').send({ code: 'GROCERY', name: 'Grocery' }).expect(201)).body;
    const child = (await owner.post('/catalogue/item-groups').send({ code: 'STAPLES', name: 'Staples', parentId: parent.id }).expect(201)).body;
    await owner.patch(`/items/${rice.id}`).send({ itemGroupId: child.id }).expect(200);
    expect((await owner.get(`/stock/balance?groupId=${parent.id}`).expect(200)).body.totals.value).toBe('13524.00');
    expect((await owner.get(`/stock/balance?groupId=${groupId}`).expect(200)).body.rows).toEqual([]);

    // A transfer must go to another store; a send that was received cannot be cancelled.
    await owner.post('/stock/documents').send({ storeId: stores.MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: stores.MAIN, lines: [{ itemId: rice.id, quantity: '1' }] }).expect(400);
    await owner.post(`/stock/documents/${send.id}/cancel`).send({ reason: 'test' }).expect(400);
  });

  it('4.5 the back office cannot take stock below zero', async () => {
    const { res } = await post(owner, { kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '200' }] }, 400);
    expect(res.message).toMatch(/127 available, 73 more needed/);
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '127', cost: '92.0000', value: '11684.00' });
  });

  it('4.7 a count posts the difference; a blind count hides the expected figure from the counter', async () => {
    const counter = await staff('Ravi', 'ravi@rademics.test', SYSTEM_ROLES.STOCK_RECEIVING);
    const draft = (
      await counter
        .post('/stock/counts')
        .send({ countType: 'normal', blind: true, storeId: stores.MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, countedQuantity: '125' }] })
        .expect(201)
    ).body;
    expect(draft.lines[0].expectedQuantity).toBeNull(); // hidden from the counter
    expect((await owner.get(`/stock/documents/${draft.id}`).expect(200)).body.lines[0].expectedQuantity).toBe('127');
    await counter.post(`/stock/documents/${draft.id}/finalise`).expect(403); // staff draft, manager finalises
    const done = (await owner.post(`/stock/documents/${draft.id}/finalise`).expect(200)).body;
    expect(done.totalValueOut).toBe('184.00');
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '125', cost: '92.0000', value: '11500.00' });
    const [latest] = (await owner.get(`/stock/ledger?itemId=${rice.id}&locationId=${loc['MAIN-FLOOR']}`).expect(200)).body;
    expect(latest).toMatchObject({ quantityChange: '-2', valueChange: '-184.00', accountRole: 'stock_adjustment' });

    // A count that changes nothing is refused.
    const same = (await owner.post('/stock/counts').send({ countType: 'normal', storeId: stores.MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, countedQuantity: '125' }] }).expect(201)).body;
    const nothing = await owner.post(`/stock/documents/${same.id}/finalise`).expect(400);
    expect(nothing.body.message).toMatch(/Nothing to change/);
  });

  it('cashiers see quantities but never values (decision 70)', async () => {
    const priya = await staff('Priya', 'priya@rademics.test', SYSTEM_ROLES.CASHIER);
    const lookup = (await priya.get(`/stock/lookup/${rice.code}`).expect(200)).body;
    expect(lookup.locations.find((l: { location: { id: string } }) => l.location.id === loc['MAIN-FLOOR']).quantity).toBe('125');
    expect(lookup.locations[0]).not.toHaveProperty('value');
    const balance = (await priya.get('/stock/balance').expect(200)).body;
    expect(balance.rows[0]).not.toHaveProperty('value');
    expect(balance.totals).toEqual({});
    await priya.post('/stock/documents').send({ storeId: stores.MAIN, kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '1', unitCost: '1' }] }).expect(403);
  });
});

describe('4.6 two people take the last units at once (rule 7)', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('of 20 simultaneous write-offs of 1 when 5 remain, exactly 5 succeed', async () => {
    const thing = await item('Last units item');
    await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '5', unitCost: '10' }] });
    const drafts = [];
    for (let i = 0; i < 20; i++) {
      drafts.push((await owner.post('/stock/documents').send({ storeId: stores.MAIN, kind: 'stock_out', reason: 'theft_loss', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '1' }] }).expect(201)).body);
    }
    const results = await Promise.all(drafts.map((d) => owner.post(`/stock/documents/${d.id}/finalise`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(15);
    expect(await position(thing.id, 'MAIN-FLOOR')).toEqual({ q: '0', cost: '10.0000', value: '0.00' });
    const ledger = (await owner.get(`/stock/ledger?itemId=${thing.id}`).expect(200)).body as { quantityAfter: string }[];
    expect(ledger.every((e) => !e.quantityAfter.startsWith('-'))).toBe(true);
  });
});

describe('4.8 expired batches (decision 13)', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('an expired batch can only leave as a write-off for expiry', async () => {
    const milk = await item('Milk 500 ml', { trackBatches: true });
    const yesterday = addDays(businessDate(), -1);
    // Received yesterday, expiring yesterday: fine on its own day.
    const { res: received } = await post(owner, {
      kind: 'stock_in',
      reason: 'found',
      postingDate: yesterday,
      toLocationId: loc['MAIN-FLOOR'],
      lines: [{ itemId: milk.id, quantity: '10', unitCost: '25', batchNumber: 'B-001', expiryDate: yesterday }],
    });
    const batchId = received.lines[0].batch.id;
    expect(received.lines[0].batch.batchNumber).toBe('B-001');

    const refused = [
      { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: milk.id, quantity: '1', unitCost: '25', batchId }] },
      { kind: 'move', fromLocationId: loc['MAIN-FLOOR'], toLocationId: loc['MAIN-BACK'], lines: [{ itemId: milk.id, quantity: '1', batchId }] },
      { kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: stores.ANNA, lines: [{ itemId: milk.id, quantity: '1', batchId }] },
      { kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: milk.id, quantity: '1', batchId }] },
    ];
    for (const body of refused) {
      const { res } = await post(owner, body, 400);
      expect(res.message).toMatch(/expired on .*only be written off with reason "expiry"/);
    }
    await post(owner, { kind: 'stock_out', reason: 'expiry', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: milk.id, quantity: '10', batchId }] });
    expect(await position(milk.id, 'MAIN-FLOOR')).toMatchObject({ q: '0' });
    const batches = (await owner.get(`/stock/batches?itemId=${milk.id}`).expect(200)).body;
    expect(batches).toEqual([]); // nothing left of it anywhere

    // A batch item needs its batch; an untracked item refuses one.
    await owner.post('/stock/documents').send({ storeId: stores.MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: milk.id, quantity: '1' }] }).expect(400);
  });
});

describe('4.9 back-dating (decision 35)', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('only the Accountant, only this month, and later issues are re-costed', async () => {
    const thing = await item('Back-dated item');
    const day = `${businessDate().slice(0, 7)}-01`;
    await post(owner, { kind: 'stock_in', reason: 'found', postingDate: day, postingTime: '10:00', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '10', unitCost: '100' }] });
    const { res: writeOff } = await post(owner, { kind: 'stock_out', reason: 'damage', postingDate: day, postingTime: '12:00', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '5' }] });
    expect(writeOff.totalValueOut).toBe('500.00');

    const manager = await staff('Arun', 'arun@rademics.test', SYSTEM_ROLES.STORE_MANAGER);
    const backdated = { kind: 'stock_in', reason: 'found', postingDate: day, postingTime: '11:00', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '10', unitCost: '120' }] };
    const { res: refused } = await post(manager, backdated, 403);
    expect(refused.message).toMatch(/only the Accountant/);

    const accountant = await staff('Meena', 'meena@rademics.test', SYSTEM_ROLES.ACCOUNTANT);
    // The Accountant may not draft stock-ins, so the manager drafts and the Accountant finalises.
    const draft = (await manager.post('/stock/documents').send({ storeId: stores.MAIN, ...backdated }).expect(201)).body;
    const done = (await accountant.post(`/stock/documents/${draft.id}/finalise`).expect(200)).body;
    expect(done.isBackDated).toBe(true);

    // The write-off at 12:00 now leaves at the new average (10×100 + 10×120) ÷ 20 = 110.
    const ledger = (await owner.get(`/stock/ledger?itemId=${thing.id}`).expect(200)).body as { document: { id: string }; valueChange: string }[];
    expect(ledger.find((e) => e.document.id === writeOff.id)?.valueChange).toBe('-550.00');
    expect(await position(thing.id, 'MAIN-FLOOR')).toEqual({ q: '15', cost: '110.0000', value: '1650.00' });

    // Last month is refused even for the Accountant.
    const lastMonth = addDays(day, -1);
    const old = (await manager.post('/stock/documents').send({ storeId: stores.MAIN, ...backdated, postingDate: lastMonth }).expect(201)).body;
    const res = await accountant.post(`/stock/documents/${old.id}/finalise`).expect(403);
    expect(res.body.message).toMatch(/current month/);
  });
});

describe('4.9b re-costing follows a transfer to the other store', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('a back-dated receipt at the sender changes the cost in transit and at the receiver', async () => {
    const thing = await item('Re-cost through transfer');
    const day = `${businessDate().slice(0, 7)}-01`;
    await post(owner, { kind: 'stock_in', reason: 'found', postingDate: day, postingTime: '10:00', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '10', unitCost: '100' }] });
    const { res: send } = await post(owner, { kind: 'transfer_send', postingDate: day, postingTime: '12:00', fromLocationId: loc['MAIN-FLOOR'], toStoreId: stores.ANNA, lines: [{ itemId: thing.id, quantity: '5' }] });
    await owner.post(`/stock/transfers/${send.id}/receive`).send({ postingDate: day, postingTime: '12:30' }).expect(201);
    expect(await position(thing.id, 'ANNA-FLOOR')).toEqual({ q: '5', cost: '100.0000', value: '500.00' });

    // Owner holds every right, including back-dating.
    await post(owner, { kind: 'stock_in', reason: 'found', postingDate: day, postingTime: '11:00', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '10', unitCost: '120' }] });
    expect(await position(thing.id, 'MAIN-FLOOR')).toEqual({ q: '15', cost: '110.0000', value: '1650.00' });
    expect(await position(thing.id, 'TRANSIT')).toEqual({ q: '0', cost: '110.0000', value: '0.00' });
    expect(await position(thing.id, 'ANNA-FLOOR')).toEqual({ q: '5', cost: '110.0000', value: '550.00' });
    expect((await owner.get('/stock/balance').expect(200)).body.totals.value).toBe('2200.00'); // 10×100 + 10×120
  });
});

describe('4.11b cancelling a receipt and a move', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('a cancelled receipt puts the goods back in transit; a cancelled move puts them back on the shelf', async () => {
    const thing = await item('Cancel move item');
    await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '10', unitCost: '50' }] });
    const { res: move } = await post(owner, { kind: 'move', fromLocationId: loc['MAIN-FLOOR'], toLocationId: loc['MAIN-BACK'], lines: [{ itemId: thing.id, quantity: '4' }] });
    expect(await position(thing.id, 'MAIN-BACK')).toEqual({ q: '4', cost: '50.0000', value: '200.00' });
    await owner.post(`/stock/documents/${move.id}/cancel`).send({ reason: 'Wrong shelf' }).expect(200);
    expect(await position(thing.id, 'MAIN-BACK')).toEqual({ q: '0', cost: '50.0000', value: '0.00' });
    expect(await position(thing.id, 'MAIN-FLOOR')).toEqual({ q: '10', cost: '50.0000', value: '500.00' });

    const { res: send } = await post(owner, { kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: stores.ANNA, lines: [{ itemId: thing.id, quantity: '6' }] });
    const receipt = (await owner.post(`/stock/transfers/${send.id}/receive`).send({}).expect(201)).body;
    await owner.post(`/stock/documents/${receipt.id}/cancel`).send({ reason: 'Counted wrong' }).expect(200);
    expect(await position(thing.id, 'TRANSIT')).toEqual({ q: '6', cost: '50.0000', value: '300.00' });
    expect(await position(thing.id, 'ANNA-FLOOR')).toEqual({ q: '0', cost: '50.0000', value: '0.00' });
    expect((await owner.get(`/stock/documents/${send.id}`).expect(200)).body.lines[0].receivedQuantity).toBe('0');
    // Received again later, correctly.
    await owner.post(`/stock/transfers/${send.id}/receive`).send({}).expect(201);
    expect(await position(thing.id, 'ANNA-FLOOR')).toEqual({ q: '6', cost: '50.0000', value: '300.00' });
  });
});

describe('4.10 month-end stock lock (decision 36)', () => {
  beforeAll(freshCompany);

  it('nothing can be posted on or before the lock date', async () => {
    const thing = await item('Locked item');
    const endOfLastMonth = addDays(`${businessDate().slice(0, 7)}-01`, -1);
    await owner.patch('/stock/settings').send({ stockLockDate: endOfLastMonth }).expect(200);
    const { res } = await post(owner, { kind: 'stock_in', reason: 'found', postingDate: endOfLastMonth, toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '1', unitCost: '1' }] }, 400);
    expect(res.message).toMatch(/Stock is locked up to/);
    await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '1', unitCost: '1' }] });
    const cashier = await staff('Priya', 'priya@rademics.test', SYSTEM_ROLES.CASHIER);
    await cashier.patch('/stock/settings').send({ stockLockDate: null }).expect(403);
  });
});

describe('4.11 cancelling', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('cancelling a stock-in restores the earlier quantity and cost exactly', async () => {
    const rice = await item('Cancel test rice');
    await post(owner, { kind: 'stock_in', reason: 'opening', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '100', unitCost: '90' }] });
    const { res: second } = await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '50', unitCost: '96' }] });
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '150', cost: '92.0000', value: '13800.00' });

    const cancelled = (await owner.post(`/stock/documents/${second.id}/cancel`).send({ reason: 'Entered twice' }).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Entered twice' });
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '100', cost: '90.0000', value: '9000.00' });
    const ledger = (await owner.get(`/stock/ledger?itemId=${rice.id}`).expect(200)).body as { isCancellation: boolean }[];
    expect(ledger).toHaveLength(3);
    expect(ledger.filter((e) => e.isCancellation)).toHaveLength(1);
    await owner.post(`/stock/documents/${second.id}/cancel`).send({ reason: 'again' }).expect(400);
    await owner.patch(`/stock/documents/${second.id}`).send({ remarks: 'x' }).expect(400); // never edited after finalising

    // Cancelling the opening stock would leave nothing to cover later issues → refused.
    await post(owner, { kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, quantity: '60' }] });
    const first = (await owner.get('/stock/documents?kind=stock_in&status=finalised').expect(200)).body.rows[0];
    const res = await owner.post(`/stock/documents/${first.id}/cancel`).send({ reason: 'test' }).expect(400);
    expect(res.body.message).toMatch(/more needed/);
  });

  it('the ledger cannot be edited or deleted directly', async () => {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "StockLedgerEntry"`)).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "StockLedgerEntry" SET "valueAfter" = 0`)).rejects.toThrow(/except by re-costing/);
  });
});

describe('4.13 serial numbers', () => {
  beforeAll(freshCompany);
  afterAll(expectConsistent);

  it('each piece is tracked through a transfer', async () => {
    const phone = await item('Phone X', { trackSerials: true });
    await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: phone.id, quantity: '3', unitCost: '15000', serialNumbers: ['S1', 'S2', 'S3'] }] });
    const { res: send } = await post(owner, { kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: stores.ANNA, lines: [{ itemId: phone.id, quantity: '1', serialNumbers: ['S2'] }] });
    const status = async () =>
      Object.fromEntries((await prisma.serialNumber.findMany({ where: { itemId: phone.id } })).map((s) => [s.serial, `${s.status}@${Object.keys(loc).find((k) => loc[k] === s.locationId)}`]));
    expect(await status()).toEqual({ S1: 'in_stock@MAIN-FLOOR', S2: 'in_transit@TRANSIT', S3: 'in_stock@MAIN-FLOOR' });
    await owner.post(`/stock/transfers/${send.id}/receive`).send({}).expect(201);
    expect((await status()).S2).toBe('in_stock@ANNA-FLOOR');

    const { res: dup } = await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: phone.id, quantity: '1', unitCost: '15000', serialNumbers: ['S1'] }] }, 400);
    expect(dup.message).toMatch(/S1 is already in stock/);
    await owner.post('/stock/documents').send({ storeId: stores.MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: phone.id, quantity: '2', serialNumbers: ['S1'] }] }).expect(400);
    const { res: wrongPlace } = await post(owner, { kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: phone.id, quantity: '1', serialNumbers: ['S2'] }] }, 400);
    expect(wrongPlace.message).toMatch(/S2 is not in stock at this location/);
  });
});

describe('store limits apply to stock', () => {
  beforeAll(freshCompany);

  it('a user limited to ANNA cannot post or see MAIN stock documents', async () => {
    const thing = await item('Store limit item');
    const { res: mainDoc } = await post(owner, { kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '1', unitCost: '1' }] });
    const annaManager = await staff('Anu', 'anu@rademics.test', SYSTEM_ROLES.STORE_MANAGER, 'ANNA');
    await annaManager.get(`/stock/documents/${mainDoc.id}`).expect(403);
    await annaManager.post('/stock/documents').send({ storeId: stores.MAIN, kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '1', unitCost: '1' }] }).expect(403);
    await annaManager.post('/stock/documents').send({ storeId: stores.ANNA, kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: thing.id, quantity: '1', unitCost: '1' }] }).expect(400);
    const visible = (await annaManager.get('/stock/locations').expect(200)).body.map((l: { code: string }) => l.code);
    expect(visible).toContain('ANNA-FLOOR');
    expect(visible).not.toContain('MAIN-FLOOR');
  });
});
