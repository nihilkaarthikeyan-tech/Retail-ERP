// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 2".
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, SYSTEM_ROLES } from 'shared';
import { ItemsService } from '../../src/items/items.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let units: Record<string, string>;
let riceGroupId: string;
let sellingListId: string;
let buyingListId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  owner = await setUpCompany(app, prisma);
  units = Object.fromEntries((await prisma.unit.findMany()).map((u) => [u.code, u.id]));

  const grocery = (await owner.post('/catalogue/item-groups').send({ code: 'GROCERY', name: 'Grocery' }).expect(201)).body;
  const staples = (await owner.post('/catalogue/item-groups').send({ code: 'STAPLES', name: 'Staples', parentId: grocery.id }).expect(201)).body;
  riceGroupId = (await owner.post('/catalogue/item-groups').send({ code: 'RICE', name: 'Rice', parentId: staples.id }).expect(201)).body.id;

  const settings = (await owner.get('/catalogue/settings').expect(200)).body;
  sellingListId = settings.defaultSellingPriceListId;
  buyingListId = settings.defaultBuyingPriceListId;
  expect(sellingListId).toBeTruthy();
  expect(buyingListId).toBeTruthy();
});

afterAll(async () => {
  await app.close();
});

async function createItem(body: Record<string, unknown>) {
  return (await owner.post('/items').send({ itemGroupId: riceGroupId, baseUnitId: units.PCS, ...body }).expect(201)).body;
}

describe('2.1 A simple item with two pack sizes', () => {
  let item: { id: string; code: string };

  it('gets an automatic code and keeps its units', async () => {
    item = await createItem({
      name: 'Basmati Rice 1 kg',
      units: [{ unitId: units.BOX, factor: '12' }],
      hsnCode: '1006',
      mrp: '120.00',
      sellingPrice: '110.00',
    });
    expect(item.code).toBe('ITM-000001');
    const full = (await owner.get(`/items/${item.id}`).expect(200)).body;
    expect(full.units.map((u: { code: string; factor: string }) => `${u.code}=${u.factor}`).sort()).toEqual(['BOX=12', 'PCS=1']);
    expect(full.mrp).toBe('120');
  });

  it('scans the piece and carton barcodes to the right unit', async () => {
    await owner.post(`/items/${item.id}/barcodes`).send({ code: '8901234567890', unitId: units.PCS }).expect(201);
    await owner.post(`/items/${item.id}/barcodes`).send({ code: '5901234123457', unitId: units.BOX }).expect(201);

    const pcs = (await owner.get('/catalogue/scan/8901234567890').expect(200)).body;
    expect(pcs.item.code).toBe('ITM-000001');
    expect(pcs.unit.code).toBe('PCS');
    expect(pcs.usable).toBe(true);

    const box = (await owner.get('/catalogue/scan/5901234123457').expect(200)).body;
    expect(box.unit.code).toBe('BOX');
    expect(box.unit.factor).toBe('12');
    expect(box.matchedBy).toBe('barcode');

    expect((await owner.get('/catalogue/scan/itm-000001').expect(200)).body.matchedBy).toBe('code');
    await owner.get('/catalogue/scan/0000000000000').expect(404);
  });

  it('prices a box at 12 × the per-piece price', async () => {
    const piece = (await owner.get(`/prices/lookup?itemId=${item.id}`).expect(200)).body;
    expect(piece).toMatchObject({ found: true, rate: '110.00', source: 'list' });
    const box = (await owner.get(`/prices/lookup?itemId=${item.id}&unitId=${units.BOX}`).expect(200)).body;
    expect(box.rate).toBe('1320.00');
  });
});

describe('2.2 Barcodes are unique and checked', () => {
  it('refuses a barcode that belongs to another item, naming it', async () => {
    const other = await createItem({ name: 'Sona Masoori Rice 1 kg' });
    const res = await owner.post(`/items/${other.id}/barcodes`).send({ code: '8901234567890' }).expect(409);
    expect(res.body.message).toMatch(/ITM-000001/);
  });

  it('refuses a wrong EAN-13 check digit', async () => {
    const other = await createItem({ name: 'Ponni Rice 1 kg' });
    const res = await owner.post(`/items/${other.id}/barcodes`).send({ code: '8901234567894', type: 'EAN13' }).expect(400);
    expect(res.body.message).toMatch(/check digit/);
  });
});

describe('2.3 A style with sizes and colours', () => {
  let shirt: { id: string };
  let colourId: string;
  let sizeId: string;

  beforeAll(async () => {
    colourId = (
      await owner
        .post('/catalogue/attributes')
        .send({ code: 'COLOUR', name: 'Colour', kind: 'list', values: [{ value: 'Red', shortCode: 'RED' }, { value: 'Blue', shortCode: 'BLU' }] })
        .expect(201)
    ).body.id;
    sizeId = (
      await owner
        .post('/catalogue/attributes')
        .send({ code: 'SIZE', name: 'Size', kind: 'list', values: [{ value: 'S', shortCode: 'S' }, { value: 'M', shortCode: 'M' }, { value: 'L', shortCode: 'L' }] })
        .expect(201)
    ).body.id;
  });

  it('creates six variants with readable codes and skips repeats', async () => {
    shirt = await createItem({ code: 'SHIRT', name: 'Shirt', variantAttributeIds: [colourId, sizeId] });
    const first = (await owner.post(`/items/${shirt.id}/variants`).send({ values: { [colourId]: ['Red', 'Blue'], [sizeId]: ['S', 'M', 'L'] } }).expect(201)).body;
    expect(first.created.map((v: { code: string }) => v.code)).toEqual(['SHIRT-RED-S', 'SHIRT-RED-M', 'SHIRT-RED-L', 'SHIRT-BLU-S', 'SHIRT-BLU-M', 'SHIRT-BLU-L']);
    expect(first.created[1].name).toBe('Shirt Red M');

    const again = (await owner.post(`/items/${shirt.id}/variants`).send({ values: { [colourId]: ['red', 'blue'], [sizeId]: ['S', 'M', 'L'] } }).expect(201)).body;
    expect(again.created).toHaveLength(0);
    expect(again.skippedExisting).toBe(6);
    expect((await owner.get(`/items/${shirt.id}/variants`).expect(200)).body).toHaveLength(6);
  });

  it('refuses prices and barcodes on the style, accepts them on a variant', async () => {
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: shirt.id, price: '499' }).expect(400);
    await owner.post(`/items/${shirt.id}/barcodes`).send({ code: 'SHIRT-BC-1' }).expect(400);
    const redM = (await prisma.item.findUniqueOrThrow({ where: { code: 'SHIRT-RED-M' } })).id;
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: redM, price: '499' }).expect(201);
    await owner.post(`/items/${redM}/barcodes`).send({ code: 'SHIRT-RED-M-BC' }).expect(201);
    expect((await owner.get('/catalogue/scan/SHIRT').expect(200)).body).toMatchObject({ usable: false, reason: expect.stringMatching(/style/) });
  });

  it('refuses a value the attribute does not have', async () => {
    const res = await owner.post(`/items/${shirt.id}/variants`).send({ values: { [colourId]: ['Green'], [sizeId]: ['S'] } }).expect(400);
    expect(res.body.message).toMatch(/Green/);
  });
});

describe('2.4 Fractions only for weight, length and volume', () => {
  it('refuses 1.5 pieces, accepts 1.5 kg, and will not allow fractions on PCS', async () => {
    const unitsService = app.get(ItemsService)['units'] as { assertQuantityAllowed: (u: { code: string; allowsFractions: boolean }, q: string) => void };
    const pcs = await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } });
    const kg = await prisma.unit.findUniqueOrThrow({ where: { code: 'KG' } });
    expect(() => unitsService.assertQuantityAllowed(pcs, '1.5')).toThrow(/whole numbers/);
    expect(() => unitsService.assertQuantityAllowed(pcs, '2')).not.toThrow();
    expect(() => unitsService.assertQuantityAllowed(kg, '1.5')).not.toThrow();

    const res = await owner.patch(`/catalogue/units/${pcs.id}`).send({ allowsFractions: true }).expect(400);
    expect(res.body.message).toMatch(/decision 11/);
    await owner.post('/catalogue/units').send({ code: 'TIN', name: 'Tin', kind: 'count', allowsFractions: true }).expect(400);
    await owner.post('/catalogue/units').send({ code: 'TIN', name: 'Tin', kind: 'count' }).expect(201);
  });
});

describe('2.5 The right price is found', () => {
  let x: { id: string };
  let wholesaleId: string;
  const customerC = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    x = await createItem({ name: 'Item X' });
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: x.id, price: '100', startDate: '2026-04-01' }).expect(201);
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: x.id, price: '105', startDate: '2026-11-01' }).expect(201);
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: x.id, price: '90', startDate: '2026-04-01', customerId: customerC }).expect(201);
    wholesaleId = (await owner.post('/price-lists').send({ code: 'WHOLESALE', name: 'Wholesale', forSelling: true, forBuying: false }).expect(201)).body.id;
  });

  const lookup = async (q: string) => (await owner.get(`/prices/lookup?itemId=${x.id}&${q}`).expect(200)).body;

  it('uses the scheduled price only from its start date', async () => {
    expect((await lookup('date=2026-10-14')).rate).toBe('100.00');
    expect((await lookup('date=2026-11-01')).rate).toBe('105.00');
  });

  it('gives customer C the contract price on both dates', async () => {
    expect((await lookup(`date=2026-10-14&customerId=${customerC}`)).rate).toBe('90.00');
    expect((await lookup(`date=2026-11-01&customerId=${customerC}`)).rate).toBe('90.00');
  });

  it('falls back to the default selling list only when the setting allows', async () => {
    const withFallback = await lookup(`date=2026-10-14&priceListId=${wholesaleId}`);
    expect(withFallback).toMatchObject({ found: true, rate: '100.00', source: 'default_list' });
    await owner.patch('/catalogue/settings').send({ fallbackToDefaultSellingList: false }).expect(200);
    expect((await lookup(`date=2026-10-14&priceListId=${wholesaleId}`)).found).toBe(false);
    await owner.patch('/catalogue/settings').send({ fallbackToDefaultSellingList: true }).expect(200);
  });

  it('refuses a supplier price on a selling list and a duplicate price', async () => {
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: x.id, price: '80', supplierId: customerC }).expect(400);
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: x.id, price: '100', startDate: '2026-04-01' }).expect(409);
  });
});

describe('2.6 Cashiers never see cost or buying prices', () => {
  let priya: Agent;
  let itemId: string;

  beforeAll(async () => {
    itemId = (await createItem({ name: 'Cost test item' })).id;
    const cashier = await roleId(prisma, SYSTEM_ROLES.CASHIER);
    await owner
      .post('/users')
      .send({ firstName: 'Priya', email: 'priya@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [cashier], storeIds: [await storeId(prisma, 'MAIN')] })
      .expect(201);
    priya = await login(app, 'priya@rademics.test', 'Temp-pass-1234');
    await priya.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Priya-own-pass-9' }).expect(204);
  });

  it('hides the last purchase price field and the buying list', async () => {
    const forPriya = (await priya.get(`/items/${itemId}`).expect(200)).body;
    expect(forPriya).not.toHaveProperty('lastPurchasePrice');
    const forOwner = (await owner.get(`/items/${itemId}`).expect(200)).body;
    expect(forOwner).toHaveProperty('lastPurchasePrice');

    const lists = (await priya.get('/price-lists').expect(200)).body as { code: string }[];
    expect(lists.map((l) => l.code)).not.toContain('STD-BUY');
    expect(lists.map((l) => l.code)).toContain('STD-SELL');
    await priya.get(`/prices?priceListId=${buyingListId}`).expect(403);
    await priya.get(`/prices/lookup?itemId=${itemId}&priceListId=${buyingListId}`).expect(403);
  });

  it('cannot change the catalogue', async () => {
    await priya.post('/items').send({ name: 'Nope', itemGroupId: riceGroupId, baseUnitId: units.PCS }).expect(403);
    await priya.post('/prices').send({ priceListId: sellingListId, itemId, price: '1' }).expect(403);
    await priya.get('/items').expect(200); // may look items up
  });
});

describe('2.7 A switched-off item cannot be used', () => {
  it('scan reports why, and documents are refused', async () => {
    const item = await createItem({ name: 'Old stock item' });
    await owner.post(`/items/${item.id}/barcodes`).send({ code: 'OLD-STOCK-1' }).expect(201);
    await owner.patch(`/items/${item.id}`).send({ active: false }).expect(200);
    expect((await owner.get('/catalogue/scan/OLD-STOCK-1').expect(200)).body).toMatchObject({ usable: false, reason: 'switched off' });

    await owner.patch(`/items/${item.id}`).send({ active: true, endDate: '2026-01-01' }).expect(200);
    expect((await owner.get('/catalogue/scan/OLD-STOCK-1').expect(200)).body.reason).toMatch(/not available after 2026-01-01/);

    const items = app.get(ItemsService);
    await expect(items.assertItemUsable(prisma, item.id, 'sale')).rejects.toThrow(/not available after/);
    await owner.patch(`/items/${item.id}`).send({ endDate: null }).expect(200);
    await expect(items.assertItemUsable(prisma, item.id, 'sale')).resolves.toBeTruthy();
  });
});

describe('2.8 Price changes are in the history', () => {
  it('records the old and new price with who and when', async () => {
    const item = await createItem({ name: 'Priced item', sellingPrice: '100' });
    const [price] = (await owner.get(`/prices?itemId=${item.id}`).expect(200)).body as { id: string; price: string }[];
    expect(price.price).toBe('100');

    await owner.patch(`/prices/${price.id}`).send({ price: '110' }).expect(200);
    const history = (await owner.get(`/audit?entityType=price&entityId=${price.id}`).expect(200)).body.rows as {
      action: string;
      user: { email: string };
      changes: { price?: { old: string; new: string } };
    }[];
    const change = history.find((h) => h.action === 'update');
    expect(change?.changes.price).toEqual({ old: '100', new: '110' });
    expect(change?.user.email).toBe('owner@rademics.test');

    // Ending today's price and loading tomorrow's in advance is the usual way to change a price.
    const today = businessDate();
    const tomorrow = addDays(today, 1);
    await owner.patch(`/prices/${price.id}`).send({ endDate: today }).expect(200);
    await owner.post('/prices').send({ priceListId: sellingListId, itemId: item.id, price: '115', startDate: tomorrow }).expect(201);
    expect((await owner.get(`/prices/lookup?itemId=${item.id}&date=${today}`).expect(200)).body.rate).toBe('110.00');
    expect((await owner.get(`/prices/lookup?itemId=${item.id}&date=${tomorrow}`).expect(200)).body.rate).toBe('115.00');
  });
});

describe('2.9 Item codes never repeat', () => {
  it('two staff creating items at the same instant get different codes', async () => {
    const [a, b] = await Promise.all([createItem({ name: 'Parallel A' }), createItem({ name: 'Parallel B' })]);
    expect(a.code).not.toBe(b.code);
    expect([a.code, b.code].every((c: string) => /^ITM-\d{6}$/.test(c))).toBe(true);
  });

  it('a typed code must be unique and is upper-cased', async () => {
    const typed = await createItem({ name: 'Typed', code: 'rice-5kg' });
    expect(typed.code).toBe('RICE-5KG');
    await owner.post('/items').send({ name: 'Typed again', code: 'RICE-5KG', itemGroupId: riceGroupId, baseUnitId: units.PCS }).expect(409);
  });
});
