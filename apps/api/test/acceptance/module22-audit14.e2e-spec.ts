// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 14 (tests), 30 October 2026: the paths of the chart of accounts, roles, manager PINs,
// catalogue and stock masters and the start-up catch-up that no acceptance test ran yet. Mostly the
// refusals: who may do what, in which store, and what the chart, the roles and the PINs protect.
// The catch-up is driven as after a night the API missed, with every rupee it posts checked.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, Decimal } from 'shared';
import { CatchUpService } from '../../src/accounting/catch-up.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { runForCompany } from '../../src/prisma/tenancy.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let loc: Record<string, string>;
let pcs: string;
let groc: string;
let rice: { id: string };

/** The people of the shared shop (one store manager per store, a cashier, an accountant, a receiver). */
const people: Record<string, { agent: Agent; id: string; password: string }> = {};

const today = () => businessDate();
const NO_RIGHT = (key: string) => `You do not have the right "${key}"`;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function staff(firstName: string, email: string, role: string, stores: string[]) {
  const id = (
    await owner
      .post('/users')
      .send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: stores, defaultStoreId: stores[0] })
      .expect(201)
  ).body.id as string;
  const agent = await login(app, email, 'Temp-pass-1234');
  const password = `${firstName}-own-pass-9`;
  await agent.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: password }).expect(204);
  return { agent, id, password };
}

/** One shop for the refusal tests: MAIN and ANNA, rice with 10 × ₹100 on MAIN's floor. */
async function sharedShop() {
  owner = await setUpCompany(app, prisma);
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groc = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  rice = (await owner.post('/items').send({ name: 'Ponni Rice 1 kg', itemGroupId: groc, baseUnitId: pcs }).expect(201)).body;
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: rice.id, countedQuantity: '10', unitCost: '100' }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  people.priya = await staff('Priya', 'priya@audit14.test', 'store_manager', [MAIN]);
  people.meena = await staff('Meena', 'meena@audit14.test', 'store_manager', [ANNA]);
  people.kavya = await staff('Kavya', 'kavya@audit14.test', 'cashier', [MAIN]);
  people.ravi = await staff('Ravi', 'ravi@audit14.test', 'accountant', [MAIN]);
  people.sunil = await staff('Sunil', 'sunil@audit14.test', 'stock_receiving', [MAIN]);
}

const account = async (systemKey: string) => (await prisma.account.findFirstOrThrow({ where: { systemKey } })).id;

describe('audit 14: shared shop', () => {
  beforeAll(sharedShop);

  // ---------------------------------------------------------------- Roles
  describe('roles and permissions', () => {
    it('system roles cannot be switched off, and the Owner / Admin role keeps every right', async () => {
      const cashierRole = await roleId(prisma, 'cashier');
      const ownerRole = await roleId(prisma, 'owner_admin');
      const ownerRights = await prisma.rolePermission.count({ where: { roleId: ownerRole } });
      expect((await owner.patch(`/roles/${cashierRole}`).send({ active: false }).expect(400)).body.message).toBe('System roles cannot be switched off');
      expect((await owner.patch(`/roles/${ownerRole}`).send({ permissions: ['users.view'] }).expect(400)).body.message).toBe('The Owner/Admin role always has every right');
      expect((await prisma.role.findUniqueOrThrow({ where: { id: cashierRole } })).active).toBe(true);
      expect(await prisma.rolePermission.count({ where: { roleId: ownerRole } })).toBe(ownerRights);
    });

    it('a role code already used is refused; an unknown role is "not found"', async () => {
      const res = await owner.post('/roles').send({ code: 'cashier', name: 'Till staff', permissions: ['pos.sell'] }).expect(409);
      expect(res.body.message).toBe('There is already a role called "Till staff" (or one very like it). Choose another name.');
      expect((await owner.get(`/roles/${randomUUID()}`).expect(404)).body.message).toBe('Role not found');
      expect((await owner.patch(`/roles/${randomUUID()}`).send({ name: 'X' }).expect(404)).body.message).toBe('Role not found');
    });

    it('people without "roles.manage" cannot see the rights list or make roles', async () => {
      const { agent: kavya } = people.kavya;
      expect((await kavya.get('/permissions').expect(403)).body.message).toBe(NO_RIGHT('roles.manage'));
      expect((await kavya.post('/roles').send({ code: 'tiller', name: 'Tiller', permissions: ['pos.sell'] }).expect(403)).body.message).toBe(NO_RIGHT('roles.manage'));
      const list = (await owner.get('/permissions').expect(200)).body as { key: string }[];
      expect(list.map((p) => p.key)).toContain('roles.manage');
    });

    it('a role manager keeps rights already on a role but cannot add ones they lack; the change is in the history', async () => {
      const helper = (await owner.post('/roles').send({ code: 'stock_helper', name: 'Stock helper', permissions: ['stock.view', 'stock.count', 'stock.adjust_finalise'] }).expect(201)).body as { id: string };
      const hrRole = (await owner.post('/roles').send({ code: 'role_keeper', name: 'Role keeper', permissions: ['roles.manage', 'stock.view'] }).expect(201)).body as { id: string };
      const hemaId = (await owner.post('/users').send({ firstName: 'Hema', email: 'hema@audit14.test', temporaryPassword: 'Temp-pass-1234', roleIds: [hrRole.id], storeIds: [MAIN], defaultStoreId: MAIN }).expect(201)).body.id as string;
      const hema = { id: hemaId, agent: await login(app, 'hema@audit14.test', 'Temp-pass-1234') };
      await hema.agent.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Hema-own-pass-9' }).expect(204);

      // Taking "stock.count" away, keeping "stock.adjust_finalise" (which she does not hold herself): allowed.
      const kept = (await hema.agent.patch(`/roles/${helper.id}`).send({ permissions: ['stock.view', 'stock.adjust_finalise'] }).expect(200)).body;
      expect(kept.permissions).toEqual(['stock.adjust_finalise', 'stock.view']);
      // Putting "stock.count" back is giving a right she does not hold.
      const res = await hema.agent.patch(`/roles/${helper.id}`).send({ permissions: ['stock.view', 'stock.adjust_finalise', 'stock.count'] }).expect(403);
      expect(res.body.message).toBe('Only an Owner / Admin can give rights you do not have yourself');
      expect((await prisma.rolePermission.findMany({ where: { roleId: helper.id }, orderBy: { permissionKey: 'asc' } })).map((p) => p.permissionKey)).toEqual(['stock.adjust_finalise', 'stock.view']);

      const history = await prisma.auditLog.findMany({ where: { entityType: 'role_permissions', entityId: helper.id } });
      expect(history).toHaveLength(1);
      expect(history[0].userId).toBe(hema.id);
      expect(history[0].changes).toEqual({ permissions: { old: ['stock.adjust_finalise', 'stock.count', 'stock.view'], new: ['stock.adjust_finalise', 'stock.view'] } });
    });
  });

  // ---------------------------------------------------------------- Manager PINs
  describe('manager PINs and cashier switching', () => {
    let tillId: string;
    let ownerId: string;
    const approve = (by: Agent, managerId: string, pin: string) => by.post('/pos/approvals').send({ tillId, managerId, pin, action: 'price_change' });
    const switchTo = (by: Agent, userId: string, pin: string) => by.post('/pos/switch-cashier').send({ tillId, userId, pin });

    beforeAll(async () => {
      const sellList = (await owner.get('/catalogue/settings').expect(200)).body.defaultSellingPriceListId;
      const pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
      tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: sellList, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
      ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
    });

    it('a PIN needs the right password and must not be a repeated or running number', async () => {
      const { agent: kavya, password } = people.kavya;
      expect((await kavya.get('/pos/pin').expect(200)).body).toEqual({ hasPin: false });
      expect((await kavya.post('/pos/pin').send({ pin: '4826', currentPassword: 'Not-my-password-1' }).expect(401)).body.message).toBe('The password is not correct');
      for (const pin of ['1111', '1234', '98765']) {
        expect((await kavya.post('/pos/pin').send({ pin, currentPassword: password }).expect(400)).body.message).toBe('Choose a PIN that is not a repeated or running number');
      }
      expect((await kavya.post('/pos/pin').send({ pin: '4826', currentPassword: password }).expect(200)).body).toEqual({ ok: true });
      expect((await kavya.get('/pos/pin').expect(200)).body).toEqual({ hasPin: true });
      // Stored only as a hash.
      expect((await prisma.userPin.findUniqueOrThrow({ where: { userId: people.kavya.id } })).pinHash).not.toContain('4826');
      await people.priya.agent.post('/pos/pin').send({ pin: '7391', currentPassword: people.priya.password }).expect(200);
      await people.meena.agent.post('/pos/pin').send({ pin: '5937', currentPassword: people.meena.password }).expect(200);
      // Stock receiving neither sells nor approves, so has no PIN to set.
      expect((await people.sunil.agent.post('/pos/pin').send({ pin: '4826', currentPassword: people.sunil.password }).expect(403)).body.message).toBe(NO_RIGHT('pos.sell" or "pos.approve'));
    });

    it('an approval needs someone with the right, in this store, with a PIN, typing it right', async () => {
      const { agent: kavya } = people.kavya;
      expect((await approve(kavya, ownerId, '4826').expect(400)).body.message).toBe('That person has not set a PIN yet');
      // A cashier cannot approve; nor can the manager of another store.
      expect((await approve(kavya, people.kavya.id, '4826').expect(403)).body.message).toBe('That person cannot do this at this till');
      expect((await approve(kavya, people.meena.id, '5937').expect(403)).body.message).toBe('That person cannot do this at this till');
      // The manager of another store cannot ask at this store's till either.
      expect((await approve(people.meena.agent, people.priya.id, '7391').expect(403)).body.message).toBe('You are not allowed to work in this store');
      expect((await approve(kavya, people.priya.id, '1397').expect(401)).body.message).toBe('Wrong PIN');
      const ok = (await approve(kavya, people.priya.id, '7391').expect(200)).body;
      expect(ok.manager).toEqual({ id: people.priya.id, name: 'Priya' });
      expect(typeof ok.token).toBe('string');
      // The till's PIN pad lists only people of this store who have a PIN.
      expect((await kavya.get(`/pos/tills/${tillId}/people`).expect(200)).body).toEqual({
        managers: [{ id: people.priya.id, name: 'Priya' }],
        cashiers: [
          { id: people.kavya.id, name: 'Kavya' },
          { id: people.priya.id, name: 'Priya' },
        ],
      });
    });

    it('a right PIN gives the tries back; the fifth wrong one locks even the right PIN; changing the PIN unlocks and retires the old one', async () => {
      const { agent: kavya } = people.kavya;
      const priyaId = people.priya.id;
      for (const pin of ['1000', '1001', '1002', '1003']) await approve(kavya, priyaId, pin).expect(401);
      await approve(kavya, priyaId, '7391').expect(200);
      expect((await prisma.userPin.findUniqueOrThrow({ where: { userId: priyaId } })).failedCount).toBe(0);

      for (const pin of ['1000', '1001', '1002', '1003', '1004']) expect((await approve(kavya, priyaId, pin).expect(401)).body.message).toBe('Wrong PIN');
      const locked = await prisma.userPin.findUniqueOrThrow({ where: { userId: priyaId } });
      expect(locked.failedCount).toBe(5);
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
      expect((await approve(kavya, priyaId, '7391').expect(403)).body.message).toBe('Too many wrong PINs; try again later');

      // Priya sets a new PIN with her password: the lock goes, and only the new PIN works.
      await people.priya.agent.post('/pos/pin').send({ pin: '2864', currentPassword: people.priya.password }).expect(200);
      expect((await approve(kavya, priyaId, '7391').expect(401)).body.message).toBe('Wrong PIN');
      await approve(kavya, priyaId, '2864').expect(200);
      expect(await prisma.userPin.findUniqueOrThrow({ where: { userId: priyaId } })).toMatchObject({ failedCount: 0, lockedUntil: null });
    });

    it('switching cashier: only someone who may sell here, still active, with their own PIN', async () => {
      const { agent: priya } = people.priya;
      const res = (await switchTo(priya, people.kavya.id, '4826').expect(200)).body;
      expect(res.cashier).toEqual({ id: people.kavya.id, name: 'Kavya' });
      expect(typeof res.token).toBe('string');
      expect((await switchTo(priya, people.kavya.id, '4827').expect(401)).body.message).toBe('Wrong PIN');
      expect((await switchTo(priya, people.sunil.id, '4826').expect(403)).body.message).toBe('That person cannot do this at this till');
      expect((await switchTo(priya, people.meena.id, '5937').expect(403)).body.message).toBe('That person cannot do this at this till');
      const mani = await staff('Mani', 'mani@audit14.test', 'cashier', [MAIN]);
      await mani.agent.post('/pos/pin').send({ pin: '3816', currentPassword: mani.password }).expect(200);
      await prisma.user.update({ where: { id: mani.id }, data: { active: false } });
      expect((await switchTo(priya, mani.id, '3816').expect(403)).body.message).toBe('That person cannot do this');
    });

    it('a forgotten PIN is cleared by a manager of the same store, never by a cashier or another store', async () => {
      const kavyaId = people.kavya.id;
      expect((await people.kavya.agent.delete(`/pos/pins/${people.priya.id}`).expect(403)).body.message).toBe(NO_RIGHT('pos.shift.manage'));
      expect((await people.meena.agent.delete(`/pos/pins/${kavyaId}`).expect(403)).body.message).toBe('Only an Owner / Admin can change someone who works in stores you do not work in');
      expect((await people.priya.agent.delete(`/pos/pins/${ownerId}`).expect(403)).body.message).toBe('Only an Owner / Admin can change an Owner / Admin');
      expect(await prisma.userPin.count({ where: { userId: kavyaId } })).toBe(1);

      expect((await people.priya.agent.delete(`/pos/pins/${kavyaId}`).expect(200)).body).toEqual({ ok: true });
      expect((await people.kavya.agent.get('/pos/pin').expect(200)).body).toEqual({ hasPin: false });
      expect((await switchTo(people.priya.agent, kavyaId, '4826').expect(400)).body.message).toBe('That person has not set a PIN yet');
      const history = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user_pin', entityId: kavyaId }, orderBy: { id: 'desc' } });
      expect(history).toMatchObject({ userId: people.priya.id, changes: { pin: 'cleared' } });
      // She sets a new one herself.
      await people.kavya.agent.post('/pos/pin').send({ pin: '5172', currentPassword: people.kavya.password }).expect(200);
      await switchTo(people.priya.agent, kavyaId, '5172').expect(200);
    });
  });

  // ---------------------------------------------------------------- Chart of accounts
  describe('chart of accounts', () => {
    let electricity: string;
    let indirect: string;
    let utilities: string;
    let water: string;
    let stock: string;

    beforeAll(async () => {
      await owner.get('/accounts').expect(200);
      electricity = await account('electricity');
      indirect = await account('indirect_expenses');
      stock = await account('stock');
    });

    it('accounts go under a folder; a folder has no kind, an account has one; account numbers are unique', async () => {
      const add = (body: Record<string, unknown>) => owner.post('/accounts').send(body);
      expect((await add({ parentId: electricity, name: 'Meter deposit', kind: 'expense' }).expect(400)).body.message).toBe('Accounts can only be added under a folder');
      expect((await add({ parentId: indirect, name: 'Utilities', isGroup: true, kind: 'expense' }).expect(400)).body.message).toBe('A folder has no kind');
      expect((await add({ parentId: indirect, name: 'Water' }).expect(400)).body.message).toBe('Choose what kind of account it is');
      expect((await add({ parentId: indirect, name: 'Water', kind: 'expense', number: '5230' }).expect(400)).body.message).toBe('Account number 5230 is already used by Electricity');
      utilities = (await add({ parentId: indirect, name: 'Utilities', isGroup: true, number: '5400' }).expect(201)).body.id;
      const w = (await add({ parentId: utilities, name: 'Water', kind: 'expense', number: '5410' }).expect(201)).body;
      expect(w).toMatchObject({ family: 'expense', kind: 'expense', isGroup: false, number: '5410', locked: false, active: true });
      water = w.id;
      expect((await owner.patch(`/accounts/${water}`).send({ number: '5230' }).expect(400)).body.message).toBe('Account number 5230 is already used by Electricity');
      // Its own number again is no clash.
      await owner.patch(`/accounts/${water}`).send({ number: '5410', name: 'Water charges' }).expect(200);
      expect((await prisma.account.findUniqueOrThrow({ where: { id: water } })).name).toBe('Water charges');
    });

    it('the shape of the chart is protected: top-level folders, families, loops, folders in use, defaults and used stock accounts', async () => {
      const patch = (id: string, body: Record<string, unknown>) => owner.patch(`/accounts/${id}`).send(body);
      const assets = await account('assets');
      expect((await patch(assets, { active: false }).expect(400)).body.message).toBe('Top-level folders cannot be moved, changed or switched off');
      expect((await patch(assets, { parentId: indirect }).expect(400)).body.message).toBe('Top-level folders cannot be moved, changed or switched off');
      expect((await patch(water, { parentId: await account('current_assets') }).expect(400)).body.message).toBe('An account cannot move to another family (assets, liabilities, capital, income, expenses)');
      expect((await patch(water, { parentId: electricity }).expect(400)).body.message).toBe('The new parent must be a folder');
      expect((await patch(indirect, { parentId: utilities }).expect(400)).body.message).toBe('An account cannot sit under itself');
      expect((await patch(utilities, { kind: 'expense' }).expect(400)).body.message).toBe('A folder has no kind');
      expect((await patch(utilities, { active: false }).expect(400)).body.message).toBe('Switch off the accounts in this folder first');
      expect((await patch(stock, { active: false }).expect(400)).body.message).toBe('This account is a default account; choose another default first');
      // The opening stock (10 × ₹100) is on the stock account, so it stays a stock account.
      expect((await patch(stock, { kind: 'other' }).expect(400)).body.message).toBe('Customer, supplier and stock accounts cannot change kind once used');
      // There is no way to delete an account at all (it is switched off instead).
      expect((await owner.delete(`/accounts/${stock}`).expect(404)).body.message).toBe(`Cannot DELETE /accounts/${stock}`);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: stock } })).toMatchObject({ kind: 'stock', active: true, parentId: await account('current_assets') });
      // Emptied first, the folder can be switched off.
      await patch(water, { active: false }).expect(200);
      expect((await patch(utilities, { active: false }).expect(200)).body.active).toBe(false);
    });

    it('only the Accountant may lock an account, and only the Accountant may post to a locked one', async () => {
      const { agent: priya } = people.priya;
      const { agent: ravi } = people.ravi;
      const pettyCash = async () => ({
        kind: 'cash',
        journalDate: today(),
        remark: 'Electricity bill paid in cash',
        lines: [
          { accountId: electricity, storeId: MAIN, debit: '450' },
          { accountId: await account(`cash_in_hand:${MAIN}`), storeId: MAIN, credit: '450' },
        ],
      });
      expect((await priya.post(`/accounts/${electricity}/lock`).send({ locked: true }).expect(403)).body.message).toBe(NO_RIGHT('books.lock'));
      expect((await ravi.post(`/accounts/${electricity}/lock`).send({ locked: true }).expect(200)).body).toMatchObject({ id: electricity, locked: true });
      const history = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'account', entityId: electricity }, orderBy: { id: 'desc' } });
      expect(history.changes).toEqual({ locked: { old: false, new: true }, name: 'Electricity' });

      const mine = (await priya.post('/journals').send(await pettyCash()).expect(201)).body;
      expect((await priya.post(`/journals/${mine.id}/post`).expect(400)).body.message).toBe('Electricity is locked; only the Accountant can post to it');
      const his = (await ravi.post('/journals').send(await pettyCash()).expect(201)).body;
      await ravi.post(`/journals/${his.id}/post`).expect(200);
      const balance = async () => ((await owner.get('/accounts').expect(200)).body.accounts as { id: string; balance: string }[]).find((a) => a.id === electricity)!.balance;
      expect(await balance()).toBe('450.00');

      await ravi.post(`/accounts/${electricity}/lock`).send({ locked: false }).expect(200);
      await priya.post(`/journals/${mine.id}/post`).expect(200);
      expect(await balance()).toBe('900.00');
    });

    it('default accounts must be accounts in use of the right kind', async () => {
      const put = (role: string, accountId: string) => owner.put('/accounting/defaults').send({ defaults: [{ role, accountId }] });
      expect((await put('stock', electricity).expect(400)).body.message).toBe('Stock must post to a stock account');
      expect((await put('customer_receivable', electricity).expect(400)).body.message).toBe('Customer balances must post to a customer balances account');
      expect((await put('supplier_payable', electricity).expect(400)).body.message).toBe('Supplier balances must post to a supplier balances account');
      expect((await put('stock', indirect).expect(400)).body.message).toBe('Indirect expenses: choose an account in use, not a folder');
      expect((await put('rounding', water).expect(400)).body.message).toBe('Water charges: choose an account in use, not a folder');
      expect((await people.priya.agent.put('/accounting/defaults').send({ defaults: [{ role: 'stock', accountId: stock }] }).expect(403)).body.message).toBe(NO_RIGHT('accounts.manage'));
      const defaults = (await owner.get('/accounting/defaults').expect(200)).body as { role: string; account: { id: string } | null }[];
      expect(defaults.find((d) => d.role === 'stock')!.account!.id).toBe(stock);
    });

    it('bank details go on one bank account in the chart, once; only the last four digits show', async () => {
      expect((await owner.post('/bank-accounts').send({ accountId: electricity, bankName: 'HDFC Bank', accountNumber: '50100012343456' }).expect(400)).body.message).toBe('Link the bank details to a bank account in the chart');
      const hdfc = (await owner.post('/accounts').send({ parentId: await account('bank_group'), name: 'HDFC Current', kind: 'bank' }).expect(201)).body.id;
      const b = (await owner.post('/bank-accounts').send({ accountId: hdfc, bankName: 'HDFC Bank', accountNumber: '50100012343456', ifsc: 'HDFC0001234', isDefault: true }).expect(201)).body;
      expect(b).toMatchObject({ bankName: 'HDFC Bank', maskedNumber: '••••••••3456', ifsc: 'HDFC0001234', isDefault: true });
      expect((await owner.post('/bank-accounts').send({ accountId: hdfc, bankName: 'HDFC Bank', accountNumber: '50100099998888' }).expect(400)).body.message).toBe('That ledger account already has bank details');
      expect((await owner.patch(`/bank-accounts/${randomUUID()}`).send({ bankName: 'X' }).expect(400)).body.message).toBe('Bank account not found');
      const history = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'bank_account', entityId: b.id } });
      expect(history.changes).toEqual({ bank: 'HDFC Bank', account: '••••••••3456' });
    });

    it("a store manager's chart shows only their own store's balances; a cashier sees no chart", async () => {
      const stockBalance = async (a: Agent) => ((await a.get('/accounts').expect(200)).body.accounts as { id: string; balance: string }[]).find((x) => x.id === stock)!.balance;
      expect(await stockBalance(owner)).toBe('1000.00');
      expect(await stockBalance(people.priya.agent)).toBe('1000.00');
      expect(await stockBalance(people.meena.agent)).toBe('0.00');
      expect((await people.kavya.agent.get('/accounts').expect(403)).body.message).toBe(NO_RIGHT('accounts.view" or "journals.post" or "payments.post" or "cash.deposit'));
    });
  });

  // ---------------------------------------------------------------- Catalogue masters
  describe('catalogue masters: groups, brands, HSN codes, sizes and colours', () => {
    let colour: string;
    let style: { id: string };

    it('a code already used is refused for groups, brands, HSN codes and attributes', async () => {
      expect((await owner.post('/catalogue/item-groups').send({ code: 'groc', name: 'Groceries' }).expect(409)).body.message).toBe('Item group GROC already exists');
      await owner.post('/catalogue/brands').send({ code: 'ACME', name: 'Acme' }).expect(201);
      expect((await owner.post('/catalogue/brands').send({ code: 'ACME', name: 'Acme two' }).expect(409)).body.message).toBe('Brand ACME already exists');
      await owner.post('/catalogue/hsn-codes').send({ code: '330499', description: 'Beauty preparations' }).expect(201);
      expect((await owner.post('/catalogue/hsn-codes').send({ code: '330499', description: 'Again' }).expect(409)).body.message).toBe('HSN code 330499 already exists');
      colour = (await owner.post('/catalogue/attributes').send({ code: 'COLOUR', name: 'Colour', kind: 'list', values: [{ value: 'Red', shortCode: 'RED' }, { value: 'Blue', shortCode: 'BLU' }] }).expect(201)).body.id;
      expect((await owner.post('/catalogue/attributes').send({ code: 'COLOUR', name: 'Colour', kind: 'list', values: [{ value: 'Red', shortCode: 'RED' }] }).expect(409)).body.message).toBe('Attribute COLOUR already exists');
      expect((await people.kavya.agent.post('/catalogue/brands').send({ code: 'NOPE', name: 'Nope' }).expect(403)).body.message).toBe(NO_RIGHT('catalogue.manage'));
    });

    it('a group with items cannot become a folder; items go only into an active lowest-level group', async () => {
      expect((await owner.post('/catalogue/item-groups').send({ code: 'RICE', name: 'Rice', parentId: groc }).expect(400)).body.message).toBe('Grocery already has items; it cannot become a folder');
      const apparel = (await owner.post('/catalogue/item-groups').send({ code: 'APPAREL', name: 'Apparel' }).expect(201)).body;
      const mens = (await owner.post('/catalogue/item-groups').send({ code: 'MENS', name: 'Mens wear', parentId: apparel.id }).expect(201)).body;
      expect(mens).toMatchObject({ depth: 1, path: `${apparel.path}${mens.id}/` });
      expect((await owner.post('/items').send({ name: 'Plain shirt', itemGroupId: apparel.id, baseUnitId: pcs }).expect(400)).body.message).toBe('Apparel has sub-groups; choose one of them');
      await owner.patch(`/catalogue/item-groups/${mens.id}`).send({ active: false }).expect(200);
      expect((await owner.post('/items').send({ name: 'Plain shirt', itemGroupId: mens.id, baseUnitId: pcs }).expect(400)).body.message).toBe('Item group Mens wear is switched off');
      await owner.patch(`/catalogue/item-groups/${mens.id}`).send({ active: true }).expect(200);
      style = (await owner.post('/items').send({ code: 'TEE', name: 'Tee', itemGroupId: mens.id, baseUnitId: pcs, variantAttributeIds: [colour] }).expect(201)).body;
      await owner.post(`/items/${style.id}/variants`).send({ values: { [colour]: ['Red'] } }).expect(201);
    });

    it('attribute values: no repeats, a sensible number range, and a value in use stays', async () => {
      const attr = (body: Record<string, unknown>) => owner.post('/catalogue/attributes').send(body);
      expect((await attr({ code: 'SHADE', name: 'Shade', kind: 'list', values: [{ value: 'Red', shortCode: 'R' }, { value: 'red', shortCode: 'R2' }] }).expect(400)).body.message).toBe('Value "red" is listed twice');
      expect((await attr({ code: 'SHADE', name: 'Shade', kind: 'list', values: [{ value: 'Red', shortCode: 'R' }, { value: 'Rose', shortCode: 'R' }] }).expect(400)).body.message).toBe('Short code "R" is listed twice');
      expect((await attr({ code: 'WAIST', name: 'Waist', kind: 'numeric', rangeStart: 40, rangeEnd: 28, rangeStep: 2 }).expect(400)).body.message).toBe('Range start must be below its end');
      expect((await attr({ code: 'WAIST', name: 'Waist', kind: 'numeric', rangeStart: 28, rangeEnd: 40, rangeStep: 0 }).expect(400)).body.message).toBe('Step must be above zero');
      expect(await prisma.variantAttribute.count({ where: { code: { in: ['SHADE', 'WAIST'] } } })).toBe(0);

      // TEE-RED uses "Red".
      expect((await owner.patch(`/catalogue/attributes/${colour}`).send({ values: [{ value: 'Blue', shortCode: 'BLU' }] }).expect(400)).body.message).toBe('Values in use by variants cannot be removed: Red');
      const after = (await owner.patch(`/catalogue/attributes/${colour}`).send({ values: [{ value: 'Red', shortCode: 'RED' }, { value: 'Blue', shortCode: 'BLU' }, { value: 'Green', shortCode: 'GRN' }] }).expect(200)).body;
      expect(after.values.map((v: { value: string }) => v.value)).toEqual(['Red', 'Blue', 'Green']);
    });

    it('changing a master that does not exist is "not found"', async () => {
      const id = randomUUID();
      expect((await owner.patch(`/catalogue/item-groups/${id}`).send({ name: 'X' }).expect(404)).body.message).toBe('Item group not found');
      expect((await owner.patch(`/catalogue/brands/${id}`).send({ name: 'X' }).expect(404)).body.message).toBe('Brand not found');
      expect((await owner.patch(`/catalogue/hsn-codes/${id}`).send({ description: 'X' }).expect(404)).body.message).toBe('HSN code not found');
      expect((await owner.patch(`/catalogue/attributes/${id}`).send({ name: 'X' }).expect(404)).body.message).toBe('Attribute not found');
    });

    // ---------------------------------------------------------------- Stock masters
    describe('stock locations, reorder levels and the stock lock', () => {
      it("locations: only in one's own store, unique codes, a folder of the same store as parent", async () => {
        const { agent: priya } = people.priya;
        const add = (a: Agent, body: Record<string, unknown>) => a.post('/stock/locations').send({ storeId: MAIN, kind: 'shelf', ...body });
        expect((await add(people.meena.agent, { code: 'MAIN-ATTIC', name: 'Attic' }).expect(403)).body.message).toBe('You are not allowed to work in this store');
        expect((await add(priya, { code: 'MAIN-FLOOR', name: 'Floor again' }).expect(409)).body.message).toBe('Location MAIN-FLOOR already exists');
        expect((await add(priya, { code: 'MAIN-ATTIC', name: 'Attic', parentId: loc['MAIN-FLOOR'] }).expect(400)).body.message).toBe('The parent must be a folder of the same store');
        expect((await add(priya, { code: 'MAIN-ATTIC', name: 'Attic', parentId: loc.ANNA }).expect(400)).body.message).toBe('The parent must be a folder of the same store');
        const back = (await add(priya, { code: 'MAIN-ATTIC', name: 'Attic' }).expect(201)).body;
        // With no parent given it goes under the store's own folder.
        expect(back).toMatchObject({ storeId: MAIN, parentId: loc.MAIN, kind: 'shelf' });
        loc['MAIN-ATTIC'] = back.id;
        expect((await people.meena.agent.patch(`/stock/locations/${back.id}`).send({ name: 'Mine now' }).expect(403)).body.message).toBe('You are not allowed to work in this store');
        expect((await people.kavya.agent.post('/stock/locations').send({ storeId: MAIN, kind: 'shelf', code: 'MAIN-X', name: 'X' }).expect(403)).body.message).toBe(NO_RIGHT('stock.locations.manage'));
      });

      it('switching off: never the transit location, never a location still holding stock', async () => {
        const { agent: priya } = people.priya;
        const transit = await prisma.stockLocation.findFirstOrThrow({ where: { kind: 'transit' } });
        expect((await owner.patch(`/stock/locations/${transit.id}`).send({ active: false }).expect(400)).body.message).toBe('The transit location cannot be switched off');
        expect((await priya.patch(`/stock/locations/${loc['MAIN-FLOOR']}`).send({ active: false }).expect(400)).body.message).toBe('This location still holds stock; move it out first');
        expect((await priya.patch(`/stock/locations/${loc['MAIN-ATTIC']}`).send({ active: false }).expect(200)).body.active).toBe(false);
        expect(await prisma.stockLocation.findUniqueOrThrow({ where: { id: loc['MAIN-FLOOR'] } })).toMatchObject({ active: true });
        const annaSees = ((await people.meena.agent.get('/stock/locations').expect(200)).body as { code: string }[]).map((l) => l.code);
        expect(annaSees).toContain('ANNA-FLOOR');
        expect(annaSees).toContain(transit.code);
        expect(annaSees).not.toContain('MAIN-FLOOR');
        expect(annaSees).not.toContain('MAIN-ATTIC');
      });

      it("reorder levels: stock items only, in one's own store; setting again changes the same row", async () => {
        const { agent: priya } = people.priya;
        const { agent: meena } = people.meena;
        expect((await meena.post('/stock/reorder-levels').send({ itemId: rice.id, storeId: MAIN, level: '5', quantity: '20' }).expect(403)).body.message).toBe('You are not allowed to work in this store');
        expect((await meena.get(`/stock/reorder-levels?storeId=${MAIN}`).expect(403)).body.message).toBe('You are not allowed to work in this store');
        expect((await priya.post('/stock/reorder-levels').send({ itemId: style.id, storeId: MAIN, level: '5', quantity: '20' }).expect(400)).body.message).toBe('Reorder levels are for stock items (variants, not styles)');
        const first = (await priya.post('/stock/reorder-levels').send({ itemId: rice.id, storeId: MAIN, level: '5', quantity: '20' }).expect(201)).body;
        expect(first).toMatchObject({ itemId: rice.id, storeId: MAIN, level: '5', quantity: '20', requestType: 'buy', active: true });
        const second = (await priya.post('/stock/reorder-levels').send({ itemId: rice.id, storeId: MAIN, level: '8', quantity: '24' }).expect(201)).body;
        expect(second).toMatchObject({ id: first.id, level: '8', quantity: '24' });
        expect(await prisma.reorderLevel.count({ where: { itemId: rice.id } })).toBe(1);
        expect(await meena.get('/stock/reorder-levels').expect(200).then((r) => r.body)).toEqual([]);
        expect((await priya.get('/stock/reorder-levels').expect(200)).body.map((r: { id: string }) => r.id)).toEqual([first.id]);
        expect(await prisma.auditLog.count({ where: { entityType: 'reorder_level', entityId: first.id } })).toBe(2);
      });

      it('the month-end stock lock is set by those with "stock.lock" only, and can be lifted again', async () => {
        const { agent: ravi } = people.ravi;
        expect((await people.priya.agent.patch('/stock/settings').send({ stockLockDate: '2026-09-30' }).expect(403)).body.message).toBe(NO_RIGHT('stock.lock'));
        expect((await ravi.patch('/stock/settings').send({ stockLockDate: '2026-09-30', batchPickOrder: 'oldest_first' }).expect(200)).body).toMatchObject({ stockLockDate: '2026-09-30', batchPickOrder: 'oldest_first' });
        expect((await people.priya.agent.get('/stock/settings').expect(200)).body).toMatchObject({ stockLockDate: '2026-09-30', batchPickOrder: 'oldest_first' });
        expect((await ravi.patch('/stock/settings').send({ stockLockDate: null }).expect(200)).body.stockLockDate).toBeNull();
        const history = await prisma.auditLog.findMany({ where: { entityType: 'inventory_settings' }, orderBy: { id: 'asc' } });
        expect(history).toHaveLength(2);
        expect(history.every((h) => h.userId === people.ravi.id)).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- Start-up catch-up
// Rice (HSN 1006, 5%) sells at ₹105 = ₹100 + ₹2.50 CGST + ₹2.50 SGST and costs ₹60; 50 on the shelf (₹3,000).
describe('audit 14: the catch-up after a night the API missed', () => {
  let floor: string;
  let pm: Record<string, string>;
  let tillId: string;
  let tillToken: string;
  let companyId: string;
  let n = 0;
  const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
  const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
  const catchUp = () => runForCompany(companyId, () => app.get(CatchUpService).run());

  async function bal(key: string): Promise<string> {
    const systemKey = key.startsWith('cash_in_') ? `${key}:${MAIN}` : key;
    const a = await prisma.account.findFirstOrThrow({ where: { systemKey } });
    const s = await prisma.ledgerLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
    return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
  }

  async function sellTwoRice() {
    const shift = (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201)).body as { id: string };
    const bill = (
      await T(owner.post('/pos/bills'))
        .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: [{ lineNo: 1, itemId: rice.id, quantity: '2' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '210' }] })
        .expect(201)
    ).body.sale as { id: string };
    return { shift, bill };
  }

  beforeEach(async () => {
    owner = await setUpCompany(app, prisma);
    n = 0;
    companyId = (await prisma.company.findFirstOrThrow()).id;
    MAIN = await storeId(prisma, 'MAIN');
    floor = (await prisma.stockLocation.findFirstOrThrow({ where: { code: 'MAIN-FLOOR' } })).id;
    const unit = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
    const list = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
    await owner.post('/pos/gst-rates').send({ hsnCode: '1006', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
    rice = (await owner.post('/items').send({ name: 'Ponni Rice 1 kg', itemGroupId: group, baseUnitId: unit, hsnCode: '1006' }).expect(201)).body;
    await owner.post('/prices').send({ priceListId: list, itemId: rice.id, price: '105', startDate: '2026-04-01' }).expect(201);
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: floor, lines: [{ itemId: rice.id, countedQuantity: '50', unitCost: '60' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
    pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    tillId = (
      await owner
        .post('/pos/tills')
        .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: floor, priceListId: list, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] })
        .expect(201)
    ).body.id;
    tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
  });

  it('with everything already posted it posts nothing', async () => {
    expect(await catchUp()).toBe(0);
    expect(await bal('stock')).toBe('3000.00');
  });

  it("posts a shift closed but never posted and a stock movement never posted, once each, to the paisa; a second run posts nothing", async () => {
    const { shift } = await sellTwoRice();
    // As if the API stopped after the shift was marked closed, before its day-end entry was written.
    await prisma.shift.update({ where: { id: shift.id }, data: { status: 'closed', closedAt: new Date() } });
    // ₹500 of rice found on the shelf (5 × ₹100) whose value never reached the accounts.
    const documentId = randomUUID();
    const day = new Date(`${today()}T00:00:00Z`);
    await prisma.stockLedgerEntry.create({
      data: {
        companyId, itemId: rice.id, locationId: floor, documentId, documentLineId: randomUUID(), postingDate: day, postingAt: new Date(),
        kind: 'in', intentQuantity: '5', incomingCost: '100', quantityChange: '5', valueChange: '500', unitCost: '100', quantityAfter: '53', unitCostAfter: '66.04', valueAfter: '3500', accountRole: 'stock_adjustment', postedValue: '0',
      },
    });
    expect(await bal('sales')).toBe('0.00');
    expect(await bal('stock')).toBe('3000.00');

    expect(await catchUp()).toBe(2);

    // The shift: 2 rice for ₹210 cash; the ₹1,000 float moved from cash in hand into the till; nothing was counted.
    expect(await bal('sales')).toBe('-200.00');
    expect(await bal('gst_output_cgst')).toBe('-5.00');
    expect(await bal('gst_output_sgst')).toBe('-5.00');
    expect(await bal('cost_of_goods_sold')).toBe('120.00');
    expect(await bal('cash_in_till')).toBe('1210.00');
    expect(await bal('cash_in_hand')).toBe('-1000.00');
    // The movement: stock up ₹500 against stock adjustment. 3,000 − 120 + 500.
    expect(await bal('stock_adjustment')).toBe('-500.00');
    expect(await bal('stock')).toBe('3380.00');
    const entry = (await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).ledgerEntryId;
    expect(entry).not.toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { documentType: 'stock_document', documentId } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { documentId, postedValue: '500' } })).toBe(1);
    // Every entry balances.
    const totals = await prisma.ledgerLine.aggregate({ _sum: { debit: true, credit: true } });
    expect(totals._sum.debit!.toFixed(2)).toBe(totals._sum.credit!.toFixed(2));

    const entries = await prisma.ledgerEntry.count();
    expect(await catchUp()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(entries);
    expect(await bal('stock')).toBe('3380.00');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).ledgerEntryId).toBe(entry);
  });

  it("leaves an open shift's sales for its close (held, not posted), and the close then posts them exactly once", async () => {
    const { shift, bill } = await sellTwoRice();
    expect(await catchUp()).toBe(0);
    const moves = await prisma.stockLedgerEntry.findMany({ where: { documentType: 'pos_bill', documentId: bill.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0].ledgerHeld).toBe(true);
    expect(moves[0].postedValue.toFixed(2)).toBe('0.00');
    expect(await prisma.ledgerEntry.count({ where: { documentType: 'pos_shift' } })).toBe(0);
    expect(await bal('stock')).toBe('3000.00');
    expect(await bal('cost_of_goods_sold')).toBe('0.00');

    // Closed with ₹1,210 counted (₹1,000 float + ₹210).
    await T(owner.post(`/pos/shifts/${shift.id}/close`)).send({ denominations: { '500': 2, '100': 2, '10': 1 } }).expect(200);
    expect(await bal('sales')).toBe('-200.00');
    expect(await bal('gst_output_cgst')).toBe('-5.00');
    expect(await bal('gst_output_sgst')).toBe('-5.00');
    expect(await bal('cost_of_goods_sold')).toBe('120.00');
    expect(await bal('stock')).toBe('2880.00');
    expect(await bal('cash_in_hand')).toBe('210.00');
    expect(await bal('cash_in_till')).toBe('0.00');
    const after = await prisma.stockLedgerEntry.findUniqueOrThrow({ where: { id: moves[0].id } });
    expect(after).toMatchObject({ ledgerHeld: false });
    expect(after.postedValue.toFixed(2)).toBe('-120.00');

    // Run again: nothing more.
    expect(await catchUp()).toBe(0);
    expect(await bal('stock')).toBe('2880.00');
    expect(await bal('cost_of_goods_sold')).toBe('120.00');
    const health = (await owner.get('/reports/book-health').expect(200)).body;
    expect(health.problems).toEqual([]);
  });
});
