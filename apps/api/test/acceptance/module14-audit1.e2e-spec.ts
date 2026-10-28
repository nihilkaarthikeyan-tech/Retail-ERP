// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 1 (28 October 2026): the problems found in who can see and do what, each
// proved fixed. A store manager of Anna Nagar must not reach Main store's money and stock;
// someone trusted with users must not hand out more than they hold; PINs tried all at once
// must still lock.
import type { INestApplication } from '@nestjs/common';
import { addDays, businessDate } from 'shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, SETUP_INPUT, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let meena: Agent;
let loc: Record<string, string>;

const today = () => businessDate();

async function staff(firstName: string, email: string, roleIds: string[], stores: string[]) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds, storeIds: stores, defaultStoreId: stores[0] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: `${firstName}-own-pass-9` }).expect(204);
  return a;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  meena = await staff('Meena', 'meena@audit1.test', [await roleId(prisma, 'store_manager')], [ANNA]);
});

afterAll(async () => {
  await app.close();
});

describe('audit 1: a store manager of one store', () => {
  it('cannot open the owner dashboard, which covers every store', async () => {
    await meena.get('/dashboards/owner').expect(403);
    await owner.get('/dashboards/owner').expect(200);
  });

  it("cannot read another store's day book or ageing", async () => {
    await meena.get(`/reports/day-book?from=${today()}&to=${today()}&storeId=${MAIN}`).expect(403);
    await meena.get(`/reports/day-book?from=${today()}&to=${today()}&storeId=${ANNA}`).expect(200);
    await meena.get(`/reports/ageing?asOf=${today()}&storeId=${MAIN}`).expect(403);
  });

  it("does not see, change or cancel another store's money transfer", async () => {
    const cashMain = (await prisma.account.findFirstOrThrow({ where: { systemKey: `cash_in_hand:${MAIN}` } })).id;
    const cashMain2 = (await prisma.account.findFirstOrThrow({ where: { systemKey: `cash_in_till:${MAIN}` } })).id;
    const draft = (await owner.post('/payments').send({ kind: 'transfer', paymentDate: today(), storeId: MAIN, fromAccountId: cashMain, toAccountId: cashMain2, amount: '500' }).expect(201)).body;
    await owner.post(`/payments/${draft.id}/post`).expect(200);
    const list = (await meena.get('/payments').expect(200)).body as { id: string }[];
    expect(list.map((p) => p.id)).not.toContain(draft.id);
    await meena.get(`/payments/${draft.id}`).expect(403);
    await meena.post(`/payments/${draft.id}/cancel`).send({ reason: 'Not mine' }).expect(403);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('posted');
  });

  it("can see a transfer coming to her store, but cannot send or cancel the sender's stock", async () => {
    const units = (await owner.get('/catalogue/units').expect(200)).body as { id: string; code: string }[];
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'GEN', name: 'General' }).expect(201)).body;
    const item = (await owner.post('/items').send({ name: 'Steel bottle', itemGroupId: group.id, baseUnitId: units.find((u) => u.code === 'PCS')!.id })).body;
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: item.id, countedQuantity: '10', unitCost: '100' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    const send = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: ANNA, lines: [{ itemId: item.id, quantity: '2' }] }).expect(201)).body;
    await meena.get(`/stock/documents/${send.id}`).expect(200);
    await meena.post(`/stock/documents/${send.id}/finalise`).expect(403);
    await owner.post(`/stock/documents/${send.id}/finalise`).expect(200);
    await meena.post(`/stock/documents/${send.id}/cancel`).send({ reason: 'Not mine' }).expect(403);
  });

  it('cannot clear the Owner’s PIN', async () => {
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } })).id;
    await meena.delete(`/pos/pins/${ownerId}`).expect(403);
  });
});

describe('audit 1: someone trusted with users', () => {
  let ravi: Agent;
  beforeAll(async () => {
    // A custom role: manage users and run the billing counter, in Main store only.
    const role = (await owner.post('/roles').send({ code: 'staff_desk', name: 'Staff desk', permissions: ['users.view', 'users.manage', 'pos.sell'] }).expect(201)).body;
    ravi = await staff('Ravi', 'ravi@audit1.test', [role.id], [MAIN]);
  });

  it('cannot give stores they do not work in, or "all stores", to anyone or to themselves', async () => {
    const cashier = await roleId(prisma, 'cashier');
    await ravi.post('/users').send({ firstName: 'Kavi', email: 'kavi@audit1.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], storeIds: [ANNA] }).expect(403);
    await ravi.post('/users').send({ firstName: 'Kavi', email: 'kavi@audit1.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], allStores: true }).expect(403);
    const raviId = (await prisma.user.findFirstOrThrow({ where: { email: 'ravi@audit1.test' } })).id;
    await ravi.patch(`/users/${raviId}`).send({ allStores: true }).expect(403);
    await ravi.patch(`/users/${raviId}`).send({ storeIds: [MAIN, ANNA] }).expect(403);
    // Their own store is fine.
    await ravi.post('/users').send({ firstName: 'Kavi', email: 'kavi@audit1.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], storeIds: [MAIN] }).expect(201);
    void cashier;
  });

  it('cannot reset the password, or change the email, of someone with more rights or other stores', async () => {
    const accountant = await staff('Anu', 'anu@audit1.test', [await roleId(prisma, 'accountant')], [MAIN]);
    void accountant;
    const anuId = (await prisma.user.findFirstOrThrow({ where: { email: 'anu@audit1.test' } })).id;
    await ravi.post(`/users/${anuId}/reset-password`).send({ temporaryPassword: 'Taken-over-1234' }).expect(403);
    await ravi.patch(`/users/${anuId}`).send({ email: 'ravi.second@audit1.test' }).expect(403);
    const meenaId = (await prisma.user.findFirstOrThrow({ where: { email: 'meena@audit1.test' } })).id;
    await ravi.post(`/users/${meenaId}/reset-password`).send({ temporaryPassword: 'Taken-over-1234' }).expect(403);
    // Someone with fewer rights in their own store: allowed.
    const kaviId = (await prisma.user.findFirstOrThrow({ where: { email: 'kavi@audit1.test' } })).id;
    await ravi.post(`/users/${kaviId}/reset-password`).send({ temporaryPassword: 'New-temp-1234' }).expect(204);
  });

  it('an email already used in another shop gets a plain message, not a server error', async () => {
    const other = { ...SETUP_INPUT, admin: { firstName: 'Ravi', lastName: 'K', email: 'owner@other-audit.test', password: 'Shop-two-pass-2026' }, company: { legalName: 'Ravi Textiles', stateCode: '29', city: 'Bengaluru' }, gstRegistration: { gstin: '29AAACR1234A1ZZ' } };
    await request(app.getHttpServer()).post('/setup').send(other).expect(201);
    const res = await owner.post('/users').send({ firstName: 'Dup', email: 'owner@other-audit.test', temporaryPassword: 'Temp-pass-1234', roleIds: [], storeIds: [MAIN] }).expect(409);
    expect(res.body.message).toMatch(/already exists/);
  });
});

describe('audit 1: manager PINs tried all at once', () => {
  it('twenty guesses sent together get five tries between them, then the PIN is locked', async () => {
    const sellList = (await owner.get('/catalogue/settings').expect(200)).body.defaultSellingPriceListId;
    const pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    const till = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: sellList, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body;
    await owner.post('/pos/pin').send({ pin: '4826', currentPassword: OWNER.password }).expect(200);
    const managerId = (await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } })).id;
    const guess = (pin: string) => owner.post('/pos/approvals').send({ tillId: till.id, managerId, pin, action: 'price_change' });
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => guess(String(1000 + i))));
    const codes = answers.map((r) => r.status);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.filter((c) => c === 403)).toHaveLength(15);
    // Locked: even the right PIN is refused now.
    await guess('4826').expect(403);
    // After the lock time it works again, and a right PIN gives the tries back.
    await prisma.userPin.update({ where: { userId: managerId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await guess('4826').expect(200);
    expect((await prisma.userPin.findUniqueOrThrow({ where: { userId: managerId } })).failedCount).toBe(0);
    void addDays;
  });
});
