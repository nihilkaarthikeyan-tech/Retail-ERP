// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 12" (plan 12):
// 12.1 a fancy shop sees only what it needs, 12.2 switching a module off and on
// keeps the data, 12.3 warnings and dependencies, 12.4 existing companies,
// 12.5 shop types fill in settings.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MODULE_KEYS, type ModuleKey, SHOP_TYPES, type ShopTypeKey } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
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
let shiftClientId: string;
let n = 0;

const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = <R extends { set: (k: string, v: string) => R }>(r: R) => r.set('x-till-token', tillToken);
const OFF = (label: string) => `${label} is switched off in Settings → My modules`;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

/** A fresh company with a till (CASH, UPI and On account) and an open shift; optionally a shop type applied. */
async function freshCompany(before?: () => Promise<void>, shopType?: ShopTypeKey) {
  owner = await setUpCompany(app, prisma);
  // The database was emptied under the running API: forget the previous company's switches.
  invalidateModuleCache();
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GOODS', name: 'Goods' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: ['CASH', 'UPI', 'ACCOUNT'].map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  shiftClientId = randomUUID();
  await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
  if (before) await before();
  if (shopType) await owner.post('/modules/shop-type').send({ type: shopType, confirm: true }).expect(200);
}

async function item(name: string, price: string, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6205', ...extra }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function stockIn(itemId: string, qty: string) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId, countedQuantity: qty, unitCost: '200' }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

async function position(itemId: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc['MAIN-FLOOR'] } } });
  return p?.quantity.toString() ?? '0';
}

function sale(lines: Record<string, unknown>[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
}

const cash = (amount: string) => [{ paymentMethodId: pm.CASH, amount }];

async function modules(agent: Agent = owner) {
  return (await agent.get('/modules').expect(200)).body as { shopType: string | null; modules: Record<ModuleKey, boolean> };
}

/** A refused request: 403, the plain message, and the module named. */
async function refused(req: PromiseLike<{ status: number; body: { message: string; code?: string; module?: string } }>, key: ModuleKey, label: string) {
  const res = await req;
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ message: OFF(label), code: 'MODULE_OFF', module: key });
}

async function supplier() {
  const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  const groups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  return (await owner.post('/suppliers').send({ name: 'Sivakasi Gifts', supplierGroupId: groups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body as { id: string };
}

describe('12.4 existing companies', () => {
  beforeAll(() => freshCompany());

  it('after the update, an existing company has every optional module on and nothing disappears', async () => {
    const state = await modules();
    expect(state.shopType).toBeNull();
    expect(MODULE_KEYS.filter((k) => !state.modules[k])).toEqual([]);
    expect(await prisma.companyModule.count()).toBe(0);
    // The screens of every optional module still answer.
    for (const path of [
      '/seasons',
      '/catalogue/attributes',
      '/stock/batches',
      '/stock/transfers/in-transit',
      '/markdowns',
      '/purchase/orders',
      '/purchase/consignment/stock',
      '/orders',
      '/alterations',
      '/pos/offers',
      '/pos/deliveries',
      '/sales-staff',
      '/expenses',
      '/gst/e-invoices',
      '/gst/e-way-bills',
      '/tally/ledger-map',
    ]) {
      const res = await owner.get(path);
      expect([path, res.status]).toEqual([path, 200]);
    }
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(MODULE_KEYS.every((k) => snap.modules[k] === true)).toBe(true);
  });
});

describe('12.1 a fancy shop sees only what it needs', () => {
  let necklace: { id: string; code: string };
  let staffId: string;

  beforeAll(async () => {
    // A salesperson set up before the shop type, to show an offline bill that names one is kept.
    await freshCompany(async () => {
      staffId = (await owner.post('/sales-staff').send({ storeId: MAIN, code: 'S1', name: 'Selvi' }).expect(201)).body.id;
    }, 'fancy');
    necklace = await item('Pearl necklace', '499');
    await stockIn(necklace.id, '10');
  });
  afterAll(async () => {
    expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  });

  it('"Fancy and gift" leaves sizes and colours, batches, serial numbers, seasons, alterations and sale-or-return off', async () => {
    const state = await modules();
    expect(state.shopType).toBe('fancy');
    expect([state.modules.variants, state.modules.batches, state.modules.serials, state.modules.seasons, state.modules.alterations, state.modules.consignment]).toEqual([false, false, false, false, false, false]);
    expect([state.modules.offers, state.modules.delivery]).toEqual([true, true]);
    // The starting item groups are there.
    const groups = (await prisma.itemGroup.findMany()).map((g) => g.name);
    expect(groups).toEqual(expect.arrayContaining([...SHOP_TYPES.fancy.itemGroups]));
    expect(await prisma.variantAttribute.count()).toBe(0);
  });

  it('the API refuses those modules’ actions with a plain “switched off” message', async () => {
    await refused(owner.get('/catalogue/attributes'), 'variants', 'Sizes and colours');
    await refused(owner.post('/catalogue/attributes').send({ code: 'SIZE', name: 'Size', kind: 'list', values: [{ value: 'S', shortCode: 'S' }] }), 'variants', 'Sizes and colours');
    await refused(owner.get(`/items/${necklace.id}/variants`), 'variants', 'Sizes and colours');
    await refused(owner.get('/stock/batches'), 'batches', 'Batches and expiry');
    await refused(owner.get('/seasons'), 'seasons', 'Seasons and markdowns');
    await refused(owner.get('/markdowns'), 'seasons', 'Seasons and markdowns');
    await refused(owner.get('/alterations'), 'alterations', 'Alterations');
    await refused(owner.get('/purchase/consignment/stock'), 'consignment', 'Supplier sale-or-return');
    await refused(owner.get('/sales-staff'), 'salesperson', 'Salesperson');
    await refused(owner.get('/reports/season-sell-through'), 'seasons', 'Seasons and markdowns');
    await refused(owner.get('/reports/item-sales?groupBy=style'), 'variants', 'Sizes and colours');
    await refused(owner.get('/reports/item-sales?groupBy=season'), 'seasons', 'Seasons and markdowns');
    // Logged out, the login check still comes first.
    await request(app.getHttpServer()).get('/stock/batches').expect(401);
  });

  it('on a new item only the switched-off part is refused; the item itself is made as usual', async () => {
    const base = { name: 'Bangle set', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6205' };
    await refused(owner.post('/items').send({ ...base, variantAttributeIds: [randomUUID()] }), 'variants', 'Sizes and colours');
    await refused(owner.post('/items').send({ ...base, trackBatches: true }), 'batches', 'Batches and expiry');
    await refused(owner.post('/items').send({ ...base, trackSerials: true }), 'serials', 'Serial numbers and warranty');
    await refused(owner.post('/items').send({ ...base, seasonId: randomUUID() }), 'seasons', 'Seasons and markdowns');
    const made = (await owner.post('/items').send(base).expect(201)).body;
    // The item form sends unchanged values back: that is not refused.
    await owner.patch(`/items/${made.id}`).send({ name: 'Bangle set (6)', trackBatches: false, trackSerials: false, seasonId: null }).expect(200);
    await refused(owner.patch(`/items/${made.id}`).send({ trackBatches: true }), 'batches', 'Batches and expiry');
  });

  it('a sale-or-return receipt is refused; an ordinary receipt is not', async () => {
    const s = await supplier();
    const line = { itemId: necklace.id, receivedQuantity: '2', rate: '200' };
    await refused(owner.post('/purchase/receipts').send({ supplierId: s.id, storeId: MAIN, isConsignment: true, lines: [line] }), 'consignment', 'Supplier sale-or-return');
    await owner.post('/purchase/receipts').send({ supplierId: s.id, storeId: MAIN, noOrderReason: 'Walk-in supplier', lines: [line] }).expect(201);
  });

  it('the till gets the map and none of the hidden parts; a bill using them is refused online, and kept and flagged offline', async () => {
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.modules).toMatchObject({ variants: false, salesperson: false, alterations: false, customer_orders: false, credit_sales: false, offers: true, delivery: true });
    expect(snap.salesStaff).toEqual([]);

    const line = [{ itemId: necklace.id, quantity: '1' }];
    await refused(T(owner.post('/pos/bills')).send(sale(line, cash('499'), { salesStaffId: staffId })), 'salesperson', 'Salesperson');
    n--;
    await refused(T(owner.post('/pos/bills')).send(sale([{ ...line[0], salesStaffId: staffId }], cash('499'))), 'salesperson', 'Salesperson');
    n--;
    await refused(T(owner.post('/pos/bills')).send(sale(line, cash('499'), { alteration: { jobId: randomUUID() } })), 'alterations', 'Alterations');
    n--;
    await refused(T(owner.post('/pos/bills')).send(sale(line, cash('499'), { orderId: randomUUID() })), 'customer_orders', 'Customer orders');
    n--;
    await refused(T(owner.post('/pos/bills')).send(sale(line, [{ paymentMethodId: pm.ACCOUNT, amount: '499' }])), 'credit_sales', 'Credit sales');
    n--;
    // Without the hidden parts the same sale goes through; home delivery is on for a fancy shop (no charge set).
    const ok = (await T(owner.post('/pos/bills')).send(sale(line, cash('499'), { delivery: { address: '12 Gandhi Street, Chennai' } })).expect(201)).body;
    expect(ok.sale.total).toBe('499.00');
    // Sold while the till was offline: kept as sold and flagged for checking.
    const charged = { listPrice: '499', price: '499', discountAmount: '0', gstRate: '5', lineTotal: '499' };
    const kept = (
      await T(owner.post('/pos/bills'))
        .send(sale([{ ...line[0], charged }], cash('499'), { offline: true, shiftClientId, salesStaffId: staffId }))
        .expect(201)
    ).body;
    expect(kept.sale.checkFlags).toContain('module_off');
    expect(await position(necklace.id)).toBe('8');
  });
});

describe('12.2 switching a module on and off keeps the data', () => {
  const styles: { id: string; code: string }[] = [];
  let sizeId: string;
  let colourId: string;
  type Variant = { id: string; code: string; variantKey: string | null };
  let before: Variant[][];

  async function variantsOf(styleId: string): Promise<Variant[]> {
    return prisma.item.findMany({ where: { parentItemId: styleId }, select: { id: true, code: true, variantKey: true }, orderBy: { code: 'asc' } });
  }

  async function attributeValues() {
    return (await prisma.variantAttributeValue.findMany({ orderBy: [{ attributeId: 'asc' }, { sortOrder: 'asc' }] })).map((v) => `${v.attributeId}:${v.value}:${v.shortCode}`);
  }

  beforeAll(async () => {
    await freshCompany(undefined, 'clothing');
    const attrs = (await owner.get('/catalogue/attributes').expect(200)).body as { id: string; code: string }[];
    sizeId = attrs.find((a) => a.code === 'SIZE')!.id;
    colourId = attrs.find((a) => a.code === 'COLOUR')!.id;
    for (const name of ['Cotton shirt', 'Linen kurta', 'Denim jeans']) {
      const style = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6205', variantAttributeIds: [sizeId, colourId] }).expect(201)).body;
      await owner.post(`/items/${style.id}/variants`).send({ values: { [sizeId]: ['M', 'L'], [colourId]: ['Black'] } }).expect(201);
      styles.push(style);
    }
    before = await Promise.all(styles.map((s) => variantsOf(s.id)));
    for (const v of before.flat()) await owner.post('/prices').send({ priceListId: listId, itemId: v.id, price: '799', startDate: '2026-04-01' }).expect(201);
    await stockIn(before[0][0].id, '5');
  });
  afterAll(async () => {
    expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  });

  it('switching “Sizes and colours” off warns about the 3 styles first, and goes ahead when confirmed', async () => {
    expect(before.map((v) => v.length)).toEqual([2, 2, 2]);
    const ask = (await owner.patch('/modules/variants').send({ enabled: false }).expect(200)).body;
    expect(ask).toMatchObject({ done: false, needsConfirm: true, switchedOff: ['variants'], warnings: ['3 styles have sizes and colours (their variants still sell as ordinary items)'] });
    expect((await modules()).modules.variants).toBe(true);
    const done = (await owner.patch('/modules/variants').send({ enabled: false, confirm: true }).expect(200)).body;
    expect(done).toMatchObject({ done: true, switchedOff: ['variants'] });
    expect(done.modules.variants).toBe(false);
  });

  it('while off, a variant still sells at the till as an ordinary item and its stock stays correct', async () => {
    const shirtM = before[0][0];
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.modules.variants).toBe(false);
    expect(snap.items.some((i: { id: string }) => i.id === shirtM.id)).toBe(true);
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirtM.id, quantity: '2' }], cash('1598'), { expectedTotal: '1598.00' })).expect(201)).body;
    expect(res.sale.total).toBe('1598.00');
    expect(await position(shirtM.id)).toBe('3');
    await owner.get(`/items/${shirtM.id}`).expect(200);
    // The size and colour screens are refused meanwhile.
    await refused(owner.get(`/items/${styles[0].id}/variants`), 'variants', 'Sizes and colours');
    await refused(owner.post(`/items/${styles[0].id}/variants`).send({ values: { [sizeId]: ['XL'], [colourId]: ['Black'] } }), 'variants', 'Sizes and colours');
    await refused(owner.get(`/stock/style-grid?itemId=${styles[0].id}`), 'variants', 'Sizes and colours');
  });

  it('when back on, the styles, sizes and colours are exactly as before; nothing was deleted', async () => {
    const valuesBefore = await attributeValues();
    const on = (await owner.patch('/modules/variants').send({ enabled: true }).expect(200)).body;
    expect(on).toMatchObject({ done: true, switchedOn: ['variants'] });
    expect(await Promise.all(styles.map((s) => variantsOf(s.id)))).toEqual(before);
    expect(await attributeValues()).toEqual(valuesBefore);
    const listed = (await owner.get(`/items/${styles[0].id}/variants`).expect(200)).body as { id: string }[];
    expect(listed.map((v) => v.id).sort()).toEqual(before[0].map((v) => v.id).sort());
    expect(await prisma.item.count({ where: { isParentStyle: true } })).toBe(3);
  });
});

describe('12.3 warnings and dependencies', () => {
  let manager: Agent;
  let ownerId: string;

  beforeAll(async () => {
    await freshCompany();
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
    const groups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
    const priya = (await owner.post('/customers').send({ name: 'Priya', customerGroupId: groups.RETAIL, mobile: '9840012345' }).expect(201)).body;
    const kurta = await item('Silk kurta', '2499');
    for (let i = 0; i < 3; i++) await owner.post('/orders').send({ storeId: MAIN, customerId: priya.id, lines: [{ itemId: kurta.id, quantity: '1', price: '2499' }] }).expect(201);
    await owner.post('/users').send({ firstName: 'Meena', email: 'meena@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'store_manager')], storeIds: [MAIN] }).expect(201);
    manager = await login(app, 'meena@rademics.test', 'Temp-pass-1234');
    await manager.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  });

  it('switching off “Customer orders” with 3 open orders warns “3 customer orders are still open” before going ahead', async () => {
    const ask = (await owner.patch('/modules/customer_orders').send({ enabled: false }).expect(200)).body;
    expect(ask).toMatchObject({ done: false, needsConfirm: true, warnings: ['3 customer orders are still open'] });
    expect(ask.message).toMatch(/nothing is deleted/);
    await owner.get('/orders').expect(200);
    const done = (await owner.patch('/modules/customer_orders').send({ enabled: false, confirm: true }).expect(200)).body;
    expect(done).toMatchObject({ done: true, switchedOff: ['customer_orders'], warnings: ['3 customer orders are still open'] });
    await refused(owner.get('/orders'), 'customer_orders', 'Customer orders');
    // Hidden, not deleted: switched back on, the 3 open orders are there as they were.
    expect(await prisma.customerOrder.count({ where: { status: 'open' } })).toBe(3);
    await owner.patch('/modules/customer_orders').send({ enabled: true }).expect(200);
    expect((await owner.get('/orders').expect(200)).body.total).toBe(3);
  });

  it('switching on “Alterations” also switches on “Salesperson”, and says so', async () => {
    // A module with nothing in use goes off at once.
    expect((await owner.patch('/modules/alterations').send({ enabled: false }).expect(200)).body).toMatchObject({ done: true, switchedOff: ['alterations'], warnings: [] });
    expect((await owner.patch('/modules/salesperson').send({ enabled: false }).expect(200)).body).toMatchObject({ done: true, switchedOff: ['salesperson'] });
    const on = (await owner.patch('/modules/alterations').send({ enabled: true }).expect(200)).body;
    expect(on).toMatchObject({ done: true, switchedOn: ['alterations', 'salesperson'] });
    expect(on.message).toBe('Alterations is switched on. Salesperson is switched on too, because Alterations needs it.');
    expect([on.modules.alterations, on.modules.salesperson]).toEqual([true, true]);
    // Switching off what another module needs asks first and takes that module with it.
    const ask = (await owner.patch('/modules/salesperson').send({ enabled: false }).expect(200)).body;
    expect(ask).toMatchObject({ done: false, needsConfirm: true, switchedOff: ['salesperson', 'alterations'], warnings: ['Alterations needs Salesperson; it will be switched off too'] });
    const off = (await owner.patch('/modules/salesperson').send({ enabled: false, confirm: true }).expect(200)).body;
    expect([off.modules.salesperson, off.modules.alterations]).toEqual([false, false]);
  });

  it('with purchase orders switched off, goods come in without an order and no reason is asked', async () => {
    await owner.patch('/modules/purchase_orders').send({ enabled: false }).expect(200);
    const s = await supplier();
    const kurta = await prisma.item.findFirstOrThrow({ where: { name: 'Silk kurta' } });
    await owner.post('/purchase/receipts').send({ supplierId: s.id, storeId: MAIN, lines: [{ itemId: kurta.id, receivedQuantity: '1', rate: '1500' }] }).expect(201);
    await refused(owner.get('/purchase/orders'), 'purchase_orders', 'Purchase orders');
    await owner.patch('/modules/purchase_orders').send({ enabled: true }).expect(200);
  });

  it('only the Owner can switch modules, and every change is in the history', async () => {
    expect((await modules(manager)).modules.customer_orders).toBe(true);
    expect((await manager.patch('/modules/offers').send({ enabled: false }).expect(403)).body.message).toBe('Only the Owner/Admin may do this');
    await manager.post('/modules/shop-type').send({ type: 'general', confirm: true }).expect(403);
    expect((await modules()).modules.offers).toBe(true);
    expect((await owner.patch('/modules/nothing').send({ enabled: true }).expect(404)).body.message).toBe('There is no module "nothing"');

    const rows = await prisma.auditLog.findMany({ where: { entityType: 'company_module' }, orderBy: { id: 'asc' } });
    const changes = rows.map((r) => {
      const c = r.changes as { module: string; enabled: { old: boolean; new: boolean } };
      return `${c.module}:${c.enabled.new ? 'on' : 'off'}${r.reason ? ` (${r.reason})` : ''}`;
    });
    expect(changes).toEqual([
      'customer_orders:off',
      'customer_orders:on',
      'alterations:off',
      'salesperson:off',
      'alterations:on',
      'salesperson:on (Alterations needs it)',
      'salesperson:off',
      'alterations:off (It needs Salesperson)',
      'purchase_orders:off',
      'purchase_orders:on',
    ]);
    expect(rows.every((r) => r.userId === ownerId && r.action === 'update')).toBe(true);
    // The owner sees them in the change history.
    const history = (await owner.get('/audit?entityType=company_module').expect(200)).body;
    expect(JSON.stringify(history)).toContain('customer_orders');
  });
});

describe('12.5 shop types fill in settings', () => {
  let shirt: { id: string };

  beforeAll(() => freshCompany());

  it('“Clothing” asks first, then switches on its modules and creates the starting size and colour lists and item groups', async () => {
    const groupsBefore = await prisma.itemGroup.count();
    const groupHistory = await prisma.auditLog.count({ where: { entityType: 'item_group', action: 'create' } });
    const ask = (await owner.post('/modules/shop-type').send({ type: 'clothing' }).expect(200)).body;
    expect(ask).toMatchObject({ done: false, needsConfirm: true, type: 'clothing', label: 'Clothing', itemGroups: [...SHOP_TYPES.clothing.itemGroups], attributes: ['Size', 'Colour'] });
    expect(ask.switchOff).toEqual(['batches', 'serials', 'consignment', 'credit_sales', 'expenses', 'einvoice', 'eway', 'tally', 'loyalty', 'gift_cards']);
    expect(ask.message).toMatch(/Nothing is deleted/);
    // Nothing changed yet.
    expect((await modules()).shopType).toBeNull();
    expect(await prisma.itemGroup.count()).toBe(groupsBefore);

    const done = (await owner.post('/modules/shop-type').send({ type: 'clothing', confirm: true }).expect(200)).body;
    expect(done).toMatchObject({ done: true, shopType: 'clothing', attributes: ['Size', 'Colour'] });
    const state = await modules();
    expect(state.shopType).toBe('clothing');
    for (const k of ['variants', 'seasons', 'salesperson', 'alterations', 'customer_orders', 'offers'] as const) expect([k, state.modules[k]]).toEqual([k, true]);
    expect([state.modules.batches, state.modules.serials]).toEqual([false, false]);
    const attrs = await prisma.variantAttribute.findMany({ include: { values: { orderBy: { sortOrder: 'asc' } } }, orderBy: { code: 'asc' } });
    expect(attrs.map((a) => [a.code, a.name])).toEqual([
      ['COLOUR', 'Colour'],
      ['SIZE', 'Size'],
    ]);
    // Decision L2: XS and Free size too.
    expect(attrs[1].values.map((v) => v.value)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free size']);
    expect(attrs[0].values.map((v) => v.value)).toEqual(expect.arrayContaining(['Black', 'White', 'Red', 'Blue']));
    expect((await prisma.itemGroup.findMany()).map((g) => g.name)).toEqual(expect.arrayContaining([...SHOP_TYPES.clothing.itemGroups]));
    // Each starting record is in the history.
    expect(await prisma.auditLog.count({ where: { entityType: 'item_group', action: 'create' } })).toBe(groupHistory + SHOP_TYPES.clothing.itemGroups.length);
    expect(await prisma.auditLog.count({ where: { entityType: 'company', changes: { path: ['shopType', 'new'], equals: 'clothing' } } })).toBe(1);
    // An item in a starting group, to show re-applying deletes nothing.
    const menShirts = (await prisma.itemGroup.findFirstOrThrow({ where: { name: 'Men shirts' } })).id;
    shirt = (await owner.post('/items').send({ name: 'Oxford shirt', itemGroupId: menShirts, baseUnitId: pcs, hsnCode: '6205', variantAttributeIds: [attrs[1].id, attrs[0].id] }).expect(201)).body;
  });

  it('“Cosmetics” switches on batches and expiry', async () => {
    const ask = (await owner.post('/modules/shop-type').send({ type: 'cosmetics' }).expect(200)).body;
    expect(ask.switchOn).toEqual(['batches']);
    expect(ask.switchOff).toEqual(expect.arrayContaining(['variants', 'seasons', 'alterations']));
    // What would go off and is in use is listed first.
    expect(ask.warnings).toContain('Sizes and colours: 1 style has sizes and colours (its variants still sell as ordinary items)');
    const done = (await owner.post('/modules/shop-type').send({ type: 'cosmetics', confirm: true }).expect(200)).body;
    expect([done.modules.batches, done.modules.variants]).toEqual([true, false]);
    expect((await modules()).shopType).toBe('cosmetics');
  });

  it('“Mobiles” switches on serial numbers', async () => {
    const done = (await owner.post('/modules/shop-type').send({ type: 'mobiles', confirm: true }).expect(200)).body;
    expect(done.modules.serials).toBe(true);
    expect(done.modules.batches).toBe(false);
    expect(done.itemGroups).toEqual([...SHOP_TYPES.mobiles.itemGroups]);
  });

  it('re-applying a different shop type asks first and deletes nothing', async () => {
    const groups = (await prisma.itemGroup.findMany({ select: { id: true, name: true } })).map((g) => g.id).sort();
    const values = await prisma.variantAttributeValue.count();
    const items = await prisma.item.count();

    const ask = (await owner.post('/modules/shop-type').send({ type: 'footwear' }).expect(200)).body;
    expect(ask).toMatchObject({ done: false, needsConfirm: true, attributes: ['Shoe size'] });
    // "Accessories" already came with cosmetics, so it is not added twice.
    expect(ask.itemGroups).toEqual(SHOP_TYPES.footwear.itemGroups.filter((g) => g !== 'Accessories'));
    expect((await modules()).shopType).toBe('mobiles');

    await owner.post('/modules/shop-type').send({ type: 'footwear', confirm: true }).expect(200);
    const after = (await prisma.itemGroup.findMany({ select: { id: true } })).map((g) => g.id);
    expect(after).toEqual(expect.arrayContaining(groups));
    expect(after.length).toBe(groups.length + SHOP_TYPES.footwear.itemGroups.length - 1);
    expect(await prisma.variantAttributeValue.count()).toBe(values + 7);
    expect(await prisma.item.count()).toBe(items);
    expect(await prisma.item.findUnique({ where: { id: shirt.id } })).not.toBeNull();
    const shoe = await prisma.variantAttribute.findFirstOrThrow({ where: { code: 'SHOE-SIZE' }, include: { values: { orderBy: { sortOrder: 'asc' } } } });
    expect(shoe.values.map((v) => v.value)).toEqual(['UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11']);
    // Applying the same type again creates nothing twice.
    const again = (await owner.post('/modules/shop-type').send({ type: 'footwear', confirm: true }).expect(200)).body;
    expect([again.itemGroups, again.attributes]).toEqual([[], []]);
    const state = await modules();
    expect(state.shopType).toBe('footwear');
    expect([state.modules.variants, state.modules.serials]).toEqual([true, false]);
  });
});
