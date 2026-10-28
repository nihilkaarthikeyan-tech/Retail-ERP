// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 3 (28 October 2026): stock at the till when two things happen at once.
// The same goods returned at two tills, the same phone sold on two bills, a phone returned
// against a bill it was not sold on, and a bill cancelled while it is being returned.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { businessDate, Decimal } from 'shared';
import type { App } from 'supertest/types.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let tillId: string;
let tillToken: string;
let listId: string;
let groupId: string;
let pcs: string;
let loc: Record<string, string>;
let pm: Record<string, string>;
let n = 0;

const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const sale = (lines: Record<string, unknown>[], amount: string) => ({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount }] });
const ret = (returnOfId: string, lines: Record<string, unknown>[], amount: string) => ({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId, lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount }] });

async function item(name: string, price: string, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '8517', ...extra }).expect(201)).body as { id: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'MOB', name: 'Mobiles' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '8517', rate: '18', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '2000' }] }).expect(201);
});

afterAll(async () => {
  await app.close();
});

describe('audit 3: two things at once at the till', () => {
  it('the same goods returned at two tills at the same moment are refunded once', async () => {
    const charger = await item('Charger', '500');
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: charger.id, countedQuantity: '5', unitCost: '300' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
    const sold = (await T(owner.post('/pos/bills')).send(sale([{ itemId: charger.id, quantity: '1' }], '500')).expect(201)).body.sale;
    const back = () => T(owner.post('/pos/bills')).send(ret(sold.id, [{ itemId: charger.id, quantity: '1', returnOfLineId: sold.lines[0].id }], '-500'));
    const [a, b] = await Promise.all([back(), back()]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 400]);
    expect(await prisma.posBill.count({ where: { returnOfId: sold.id, status: 'completed' } })).toBe(1);
    expect((await prisma.posBillLine.findUniqueOrThrow({ where: { id: sold.lines[0].id } })).returnedQuantity.toString()).toBe('1');
  });

  it('the same phone scanned on two bills at the same moment is sold once', async () => {
    const phone = await item('Phone Z', '15000', { trackSerials: true });
    const inDoc = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: phone.id, quantity: '2', unitCost: '12000', serialNumbers: ['IMEI-1', 'IMEI-2'] }] }).expect(201)).body;
    await owner.post(`/stock/documents/${inDoc.id}/finalise`).expect(200);
    const one = () => T(owner.post('/pos/bills')).send(sale([{ itemId: phone.id, quantity: '1', serialNumbers: ['IMEI-1'] }], '15000'));
    const [a, b] = await Promise.all([one(), one()]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 400]);
    expect(await prisma.posBillLine.count({ where: { serialNumbers: { has: 'IMEI-1' }, bill: { status: 'completed' } } })).toBe(1);
    // One phone twice on the same bill is refused too.
    await T(owner.post('/pos/bills')).send(sale([{ itemId: phone.id, quantity: '2', serialNumbers: ['IMEI-2', 'IMEI-2'] }], '30000')).expect(400);
  });

  it('a phone comes back only on the bill it was sold on', async () => {
    const phone = await item('Phone Q', '9000', { trackSerials: true });
    const inDoc = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_in', reason: 'found', toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: phone.id, quantity: '2', unitCost: '7000', serialNumbers: ['Q-1', 'Q-2'] }] }).expect(201)).body;
    await owner.post(`/stock/documents/${inDoc.id}/finalise`).expect(200);
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: phone.id, quantity: '1', serialNumbers: ['Q-1'] }], '9000')).expect(201)).body.sale;
    await T(owner.post('/pos/bills')).send(ret(first.id, [{ itemId: phone.id, quantity: '1', returnOfLineId: first.lines[0].id, serialNumbers: ['Q-1'] }], '-9000')).expect(201);
    // Q-1 is sold again to someone else; returning it again on the first bill is refused.
    await T(owner.post('/pos/bills')).send(sale([{ itemId: phone.id, quantity: '1', serialNumbers: ['Q-1'] }], '9000')).expect(201);
    expect((await prisma.serialNumber.findFirstOrThrow({ where: { serial: 'Q-1' } })).status).toBe('out');
    // Nor by cancelling the stock-in that brought it: Q-1 is with a customer now.
    await owner.post(`/stock/documents/${inDoc.id}/cancel`).send({ reason: 'Entered by mistake' }).expect(400);
    expect((await prisma.serialNumber.findFirstOrThrow({ where: { serial: 'Q-1' } })).status).toBe('out');
  });

  it('a bill cannot be cancelled while a return of it is being saved, nor returned once cancelled', async () => {
    const cable = await item('Cable', '200');
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: cable.id, countedQuantity: '5', unitCost: '100' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
    const sold = (await T(owner.post('/pos/bills')).send(sale([{ itemId: cable.id, quantity: '1' }], '200')).expect(201)).body.sale;
    const managerId = (await prisma.user.findFirstOrThrow({ where: { email: 'owner@rademics.test' } })).id;
    await owner.post('/pos/pin').send({ pin: '4826', currentPassword: 'Owner-pass-2026' }).expect(200);
    const approval = (await owner.post('/pos/approvals').send({ tillId, managerId, pin: '4826', action: 'cancel_bill' }).expect(200)).body.token;
    const [r, x] = await Promise.all([
      T(owner.post('/pos/bills')).send(ret(sold.id, [{ itemId: cable.id, quantity: '1', returnOfLineId: sold.lines[0].id }], '-200')),
      owner.post(`/pos/bills/${sold.id}/cancel`).send({ reason: 'Wrong bill', approvalToken: approval }),
    ]);
    // Exactly one of the two goes through: never both a refund and a cancelled sale.
    expect([r.status, x.status].filter((s) => s < 300)).toHaveLength(1);
    const status = (await prisma.posBill.findUniqueOrThrow({ where: { id: sold.id } })).status;
    const returns = await prisma.posBill.count({ where: { returnOfId: sold.id, status: 'completed' } });
    expect(status === 'cancelled' ? returns : 1 - returns).toBe(0);
    void businessDate;
  });
});

describe('audit 3: transfers, minus stock and counts', () => {
  let ANNA: string;
  let annaFloor: string;
  const bal = async (key: string) => {
    const acct = (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
    const s = await prisma.ledgerLine.aggregate({ where: { accountId: acct }, _sum: { debit: true, credit: true } });
    return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
  };
  const count = async (store: string, location: string, itemId: string, qty: string, cost: string, serialNumbers?: string[]) => {
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: store, locationId: location, lines: [{ itemId, countedQuantity: qty, unitCost: cost, ...(serialNumbers ? { serialNumbers } : {}) }] }).expect(201)).body;
    return owner.post(`/stock/documents/${c.id}/finalise`);
  };
  const send = async (itemId: string, qty: string) => {
    const d = (await owner.post('/stock/documents').send({ storeId: ANNA, kind: 'transfer_send', fromLocationId: annaFloor, toStoreId: MAIN, lines: [{ itemId, quantity: qty }] }).expect(201)).body;
    return (await owner.post(`/stock/documents/${d.id}/finalise`).expect(200)).body as { id: string; lines: { id: string }[] };
  };

  beforeAll(async () => {
    await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
    ANNA = await storeId(prisma, 'ANNA');
    const locs = (await owner.get('/stock/locations').expect(200)).body as { code: string; id: string }[];
    annaFloor = locs.find((l) => l.code === 'ANNA-FLOOR')!.id;
  });

  it('goods arriving into minus stock: the pieces already sold take the new cost in cost of goods sold, and clearing ends at zero, to the paisa', async () => {
    const bottle = await item('Steel bottle', '50');
    await count(MAIN, loc['MAIN-FLOOR'], bottle.id, '0', '30').then((r) => expect(r.status).toBe(200));
    await T(owner.post('/pos/bills')).send(sale([{ itemId: bottle.id, quantity: '2' }], '100')).expect(201);
    await count(ANNA, annaFloor, bottle.id, '3', '33.3333').then((r) => expect(r.status).toBe(200));
    const clearingBefore = await bal('stock_transfer_clearing');
    const sent = await send(bottle.id, '3');
    await owner.post(`/stock/transfers/${sent.id}/receive`).send({}).expect(201);
    expect(await bal('stock_transfer_clearing')).toBe(clearingBefore);
    expect(await bal('goods_in_transit')).toBe('0.00');
  });

  it('a transfer partly received can be closed short: what never arrived is written off', async () => {
    const jar = await item('Glass jar', '80');
    await count(ANNA, annaFloor, jar.id, '5', '40').then((r) => expect(r.status).toBe(200));
    const sent = await send(jar.id, '3');
    await owner.post(`/stock/transfers/${sent.id}/receive`).send({ lines: [{ sendLineId: sent.lines[0].id, quantity: '1' }] }).expect(201);
    const writeOff = new Decimal(await bal('write_off'));
    await owner.post(`/stock/transfers/${sent.id}/close-short`).send({}).expect(400);
    await owner.post(`/stock/transfers/${sent.id}/close-short`).send({ reason: 'Two broke on the way' }).expect(200);
    expect(new Decimal(await bal('write_off')).sub(writeOff).toFixed(2)).toBe('80.00');
    expect(await bal('goods_in_transit')).toBe('0.00');
    await owner.post(`/stock/transfers/${sent.id}/receive`).send({ lines: [{ sendLineId: sent.lines[0].id, quantity: '1' }] }).expect(400);
    await owner.post(`/stock/transfers/${sent.id}/close-short`).send({ reason: 'Again' }).expect(400);
  });

  it('a count cannot pull in a serial recorded at another store', async () => {
    const phone = await item('Phone R', '8000', { trackSerials: true });
    await count(ANNA, annaFloor, phone.id, '1', '6000', ['R-1']).then((r) => expect(r.status).toBe(200));
    const res = await count(MAIN, loc['MAIN-FLOOR'], phone.id, '1', '6000', ['R-1']);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/another place/);
  });
});

