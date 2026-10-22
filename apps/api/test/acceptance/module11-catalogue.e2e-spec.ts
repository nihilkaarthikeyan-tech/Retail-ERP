// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 11",
// scenarios 11.10, 11.11, 11.15, 11.16 and 11.17 (plan 11 B1, B2, C2–C5).
// The scenarios build on each other: the styles imported in 11.10 are bought,
// sold, reported on and marked down in the later ones.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, gtinCheckDigit } from 'shared';
import { type Sheet, writeXlsx } from '../../src/imports/spreadsheet.js';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let loc: Record<string, string>;
let sellList: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let colourId: string;
let sizeId: string;
let seasonId: string;
let supplierId: string;
let n = 0;

const today = () => businessDate();
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
/** A valid EAN-13 from 12 data digits. */
const ean = (data: string) => `${data}${gtinCheckDigit(data)}`;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  sellList = (await owner.get('/catalogue/settings').expect(200)).body.defaultSellingPriceListId;
  await owner.post('/catalogue/item-groups').send({ code: 'MENS', name: 'Menswear' }).expect(201);
  colourId = (
    await owner
      .post('/catalogue/attributes')
      .send({ code: 'COLOUR', name: 'Colour', kind: 'list', values: [{ value: 'Red', shortCode: 'RED' }, { value: 'Blue', shortCode: 'BLU' }, { value: 'Green', shortCode: 'GRN' }] })
      .expect(201)
  ).body.id;
  sizeId = (
    await owner
      .post('/catalogue/attributes')
      .send({ code: 'SIZE', name: 'Size', kind: 'list', values: ['S', 'M', 'L', 'XL'].map((v) => ({ value: v, shortCode: v })) })
      .expect(201)
  ).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: sellList, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  const supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  supplierId = (await owner.post('/suppliers').send({ name: 'Tiruppur Garments', supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body.id;
});

afterAll(async () => {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  await app.close();
});

/** Uploads a sheet for preview, runs it and waits for it to finish. */
async function importSheet(kind: string, rows: Sheet, mode = 'add') {
  const file = writeXlsx('Import', rows, { textColumns: rows[0].map((_, i) => i) });
  const preview = (await owner.post('/imports/preview').attach('file', file, `${kind}.xlsx`).field('options', JSON.stringify({ kind, mode })).expect(200)).body;
  await owner.post(`/imports/${preview.jobId}/run`).expect(200);
  for (let i = 0; i < 200; i++) {
    const s = (await owner.get(`/imports/${preview.jobId}`).expect(200)).body;
    if (s.status !== 'running') return { preview, status: s };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The import did not finish');
}

async function variantsOf(code: string) {
  const style = await prisma.item.findFirstOrThrow({ where: { code } });
  return prisma.item.findMany({ where: { parentItemId: style.id }, include: { barcodes: true, prices: true }, orderBy: { code: 'asc' } });
}

const byCode = async (code: string) => prisma.item.findFirstOrThrow({ where: { code } });

async function opening(storeCode: string, lines: { itemId: string; qty: string }[]) {
  const c = (
    await owner
      .post('/stock/counts')
      .send({ countType: 'opening', storeId: storeCode === 'ANNA' ? ANNA : MAIN, locationId: loc[`${storeCode}-FLOOR`], lines: lines.map((l) => ({ itemId: l.itemId, countedQuantity: l.qty, unitCost: '450' })) })
      .expect(201)
  ).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

function sale(lines: { itemId: string; quantity: string }[], amount: string) {
  return {
    clientId: randomUUID(),
    tillId,
    soldAt: new Date().toISOString(),
    sale: { number: `MAT1/2627/${String(++n).padStart(6, '0')}`, lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) },
    payments: [{ paymentMethodId: pm.CASH, amount }],
  };
}

const HEAD = ['Style name', 'Style code', 'Item group code', 'Unit', 'HSN code', 'MRP', 'Season code', 'Colour', 'Size', 'Barcode', 'Selling price'];
const SHEET: Sheet = [
  HEAD,
  ...['Red', 'Blue'].flatMap((colour, c) => ['S', 'M', 'L', 'XL'].map((size, s) => ['Oxford shirt', 'SHIRT', 'MENS', 'PCS', '6205', '999', 'SUMMER26', colour, size, ean(`89012345${c}${s}00`.slice(0, 12)), '799'])),
];

describe('11.10 sizes and colours from Excel (B1)', () => {
  beforeAll(async () => {
    seasonId = (await owner.post('/seasons').send({ code: 'SUMMER26', name: 'Summer 2026', startsOn: '2026-03-01', endsOn: '2026-08-31' }).expect(201)).body.id;
  });

  it('offers the kind with one column per attribute, and a template', async () => {
    const kinds = (await owner.get('/imports/kinds').expect(200)).body as { kind: string; label: string; fields: { label: string }[] }[];
    const sv = kinds.find((k) => k.kind === 'styles_variants')!;
    expect(sv.label).toBe('Styles and variants');
    expect(sv.fields.map((f) => f.label)).toEqual(['Style name', 'Style code', 'Item group code', 'Brand code', 'Unit', 'HSN code', 'MRP', 'Season code', 'Colour', 'Size', 'Barcode', 'Selling price']);
    await owner.get('/imports/templates/styles_variants').expect(200);
  });

  it('makes one style and 8 variants, each with its barcode and price', async () => {
    const r = await importSheet('styles_variants', SHEET);
    expect(r.preview).toMatchObject({ rows: 8, ready: 8, unmatched: [], missingRequired: [] });
    expect(r.status).toMatchObject({ status: 'done', added: 8, failed: 0 });
    const style = await prisma.item.findFirstOrThrow({ where: { code: 'SHIRT' }, include: { variantAttributes: { orderBy: { sortOrder: 'asc' } } } });
    expect(style).toMatchObject({ isParentStyle: true, name: 'Oxford shirt', hsnCode: '6205', seasonId });
    expect(style.variantAttributes.map((a) => a.attributeId)).toEqual([colourId, sizeId]);
    const variants = await variantsOf('SHIRT');
    expect(variants.map((v) => v.code)).toEqual(['SHIRT-BLU-L', 'SHIRT-BLU-M', 'SHIRT-BLU-S', 'SHIRT-BLU-XL', 'SHIRT-RED-L', 'SHIRT-RED-M', 'SHIRT-RED-S', 'SHIRT-RED-XL']);
    for (const v of variants) {
      expect(v.barcodes).toHaveLength(1);
      expect(v.prices.map((p) => [p.priceListId, p.price.toFixed(2)])).toEqual([[sellList, '799.00']]);
      expect(v.mrp?.toFixed(2)).toBe('999.00');
      expect(v.seasonId).toBe(seasonId);
    }
    const redM = (await variantsOf('SHIRT')).find((v) => v.code === 'SHIRT-RED-M')!;
    expect(redM.barcodes[0].code).toBe(SHEET[2][9]);
    expect(redM.name).toBe('Oxford shirt Red M');
  });

  it('adds nothing twice when the same sheet is imported again', async () => {
    const r = await importSheet('styles_variants', SHEET);
    expect(r.status).toMatchObject({ status: 'done', added: 0, unchanged: 8, failed: 0 });
    expect(await prisma.item.count({ where: { code: { startsWith: 'SHIRT' } } })).toBe(9);
    expect(await prisma.price.count({ where: { item: { code: { startsWith: 'SHIRT' } } } })).toBe(8);
    expect(await prisma.barcode.count({ where: { item: { code: { startsWith: 'SHIRT' } } } })).toBe(8);
  });

  it('refuses a row with an unknown size by its row number; the other rows still go in', async () => {
    const r = await importSheet('styles_variants', [
      HEAD,
      ['Oxford shirt', 'SHIRT', 'MENS', 'PCS', '6205', '999', 'SUMMER26', 'Green', 'XXL', '', '799'],
      ['Oxford shirt', 'SHIRT', 'MENS', 'PCS', '6205', '999', 'SUMMER26', 'Green', 'S', ean('890123459900'), '799'],
      ['Oxford shirt', 'SHIRT', 'MENS', 'PCS', '6205', '999', 'SUMMER26', 'Green', '', '', '799'],
    ]);
    expect(r.status).toMatchObject({ status: 'partly_done', added: 1, failed: 2 });
    expect(r.status.failedRows).toEqual([
      { rowNumber: 2, message: '"XXL" is not a value of Size' },
      { rowNumber: 4, message: 'Give the Size of this variant' },
    ]);
    expect((await byCode('SHIRT-GRN-S')).parentItemId).toBe((await byCode('SHIRT')).id);
  });

  it('makes a new style without a code from the style name, and refuses an item code used as a style', async () => {
    await owner.post('/items').send({ code: 'PLAIN', name: 'Plain tee', itemGroupId: (await prisma.itemGroup.findFirstOrThrow({ where: { code: 'MENS' } })).id, baseUnitId: (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id }).expect(201);
    const r = await importSheet('styles_variants', [
      ['Style name', 'Style code', 'Item group code', 'Unit', 'Size', 'Selling price'],
      ['Polo tee', '', 'MENS', 'PCS', 'M', '499'],
      ['Polo tee', '', 'MENS', 'PCS', 'L', '499'],
      ['Plain tee', 'PLAIN', 'MENS', 'PCS', 'L', '499'],
    ]);
    expect(r.status).toMatchObject({ added: 2, failed: 1 });
    expect(r.status.failedRows).toEqual([{ rowNumber: 4, message: 'PLAIN is an item, not a style with sizes and colours' }]);
    const polo = await prisma.item.findFirstOrThrow({ where: { name: 'Polo tee', isParentStyle: true }, include: { variants: true } });
    expect(polo.variants.map((v) => v.code).sort()).toEqual([`${polo.code}-L`, `${polo.code}-M`]);
  });
});

describe('11.11 style changes reach the variants (B2)', () => {
  it('changing the MRP from ₹999 to ₹1,099 with "also change all sizes and colours" changes every variant, nothing else', async () => {
    const style = await byCode('SHIRT');
    const before = await variantsOf('SHIRT');
    const res = (await owner.patch(`/items/${style.id}`).send({ mrp: '1099', applyToVariants: true }).expect(200)).body;
    expect(res.mrp).toBe('1099');
    const after = await variantsOf('SHIRT');
    expect(after).toHaveLength(9);
    for (const v of after) {
      const b = before.find((x) => x.id === v.id)!;
      expect(v.mrp?.toFixed(2)).toBe('1099.00');
      expect(v.code).toBe(b.code);
      expect(v.barcodes.map((x) => x.code)).toEqual(b.barcodes.map((x) => x.code));
      expect(v.prices.map((x) => x.price.toFixed(2))).toEqual(b.prices.map((x) => x.price.toFixed(2)));
      const history = await prisma.auditLog.findMany({ where: { entityType: 'item', entityId: v.id, action: 'update', reason: 'Copied from style SHIRT' } });
      expect(history).toHaveLength(1);
      expect(history[0].changes).toMatchObject({ mrp: { old: '999', new: '1099' } });
    }
  });

  it('without the option only the style changes; "apply to variants" copies it later', async () => {
    const style = await byCode('SHIRT');
    await owner.patch(`/items/${style.id}`).send({ description: 'Pure cotton, regular fit' }).expect(200);
    expect((await variantsOf('SHIRT')).every((v) => v.description === null)).toBe(true);
    const r = (await owner.post(`/items/${style.id}/apply-to-variants`).expect(200)).body;
    expect(r).toEqual({ variants: 9, changed: 9 });
    expect((await variantsOf('SHIRT')).every((v) => v.description === 'Pure cotton, regular fit' && v.mrp?.toFixed(2) === '1099.00')).toBe(true);
    // Nothing left to copy the second time.
    expect((await owner.post(`/items/${style.id}/apply-to-variants`).expect(200)).body.changed).toBe(0);
  });

  it('is refused on an item that is not a style', async () => {
    const redM = await byCode('SHIRT-RED-M');
    expect((await owner.patch(`/items/${redM.id}`).send({ mrp: '1199', applyToVariants: true }).expect(400)).body.message).toMatch(/not a style/);
  });
});

describe('11.15 size × colour grid when buying (C2)', () => {
  it('the four lines the grid makes for Red (2, 3, 3, 2 under S, M, L, XL) post as one line per variant', async () => {
    const style = await byCode('SHIRT');
    const variants = (await owner.get(`/items/${style.id}/variants`).expect(200)).body as { id: string; code: string; variantValues: { attribute: { id: string }; value: string }[] }[];
    const red = Object.fromEntries(
      variants.filter((v) => v.variantValues.some((x) => x.attribute.id === colourId && x.value === 'Red')).map((v) => [v.variantValues.find((x) => x.attribute.id === sizeId)!.value, v.id]),
    );
    const qty = { S: '2', M: '3', L: '3', XL: '2' };
    const lines = Object.entries(qty).map(([size, q]) => ({ itemId: red[size], receivedQuantity: q, rate: '450', gstRate: '5' }));
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId, noOrderReason: 'Season stock', lines }).expect(201)).body;
    await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200);
    const receipt = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: { include: { item: true } } } });
    expect(receipt.lines.map((l) => [l.item.code, l.basicAcceptedQuantity.toString()]).sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ['SHIRT-RED-L', '3'],
      ['SHIRT-RED-M', '3'],
      ['SHIRT-RED-S', '2'],
      ['SHIRT-RED-XL', '2'],
    ]);
  });
});

describe('11.16 reports by style, size and colour (C3)', () => {
  beforeAll(async () => {
    const id = async (code: string) => (await byCode(code)).id;
    await opening('MAIN', [{ itemId: await id('SHIRT-BLU-M'), qty: '4' }]);
    await opening('ANNA', [{ itemId: await id('SHIRT-BLU-S'), qty: '5' }, { itemId: await id('SHIRT-RED-M'), qty: '1' }]);
    await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '2000' }] }).expect(201);
    await T(owner.post('/pos/bills'))
      .send(sale([{ itemId: await id('SHIRT-RED-S'), quantity: '1' }, { itemId: await id('SHIRT-RED-M'), quantity: '2' }, { itemId: await id('SHIRT-RED-L'), quantity: '1' }], '3196'))
      .expect(201);
    await T(owner.post('/pos/bills')).send(sale([{ itemId: await id('SHIRT-BLU-M'), quantity: '1' }], '799')).expect(201);
  });

  it('item sales grouped by size show S, M, L totals that add up to the style total', async () => {
    const q = `from=${today()}&to=${today()}`;
    const bySize = (await owner.get(`/reports/item-sales?${q}&groupBy=attribute&attributeId=${sizeId}`).expect(200)).body;
    const rows = Object.fromEntries(bySize.rows.map((r: { name: string; quantity: string; netSales: string }) => [r.name, r]));
    expect(Object.keys(rows).sort()).toEqual(['L', 'M', 'S']);
    expect([rows.S.quantity, rows.M.quantity, rows.L.quantity]).toEqual(['1', '3', '1']);
    const byStyle = (await owner.get(`/reports/item-sales?${q}&groupBy=style`).expect(200)).body;
    expect(byStyle.rows).toHaveLength(1);
    expect(byStyle.rows[0]).toMatchObject({ code: 'SHIRT', name: 'Oxford shirt', quantity: '5' });
    const sizesTotal = bySize.rows.reduce((s: number, r: { netSales: string }) => s + Math.round(Number(r.netSales) * 100), 0);
    expect(sizesTotal).toBe(Math.round(Number(byStyle.rows[0].netSales) * 100));
    expect(bySize.totals.netSales).toBe(byStyle.totals.netSales);
    const byColour = (await owner.get(`/reports/item-sales?${q}&groupBy=attribute&attributeId=${colourId}`).expect(200)).body;
    expect(byColour.rows.map((r: { name: string; quantity: string }) => [r.name, r.quantity]).sort()).toEqual([
      ['Blue', '1'],
      ['Red', '4'],
    ]);
    await owner.get(`/reports/item-sales?${q}&groupBy=attribute`).expect(400);
  });

  it('the stock of a style shows as a size × colour grid per shop, adding up', async () => {
    const style = await byCode('SHIRT');
    const grid = (await owner.get(`/stock/style-grid?itemId=${style.id}`).expect(200)).body;
    expect(grid.across).toEqual({ attributes: ['Size'], values: ['S', 'M', 'L', 'XL'] });
    expect(grid.down).toEqual({ attributes: ['Colour'], values: ['Red', 'Blue', 'Green'] });
    const main = grid.stores.find((s: { store: { code: string } }) => s.store.code === 'MAIN');
    const anna = grid.stores.find((s: { store: { code: string } }) => s.store.code === 'ANNA');
    const cellQty = (s: typeof main, row: number) => s.rows[row].cells.map((c: { quantity: string } | null) => c?.quantity ?? null);
    // MAIN: received 2/3/3/2 Red, sold 1/2/1 → 1/1/2/2; Blue M 4 − 1 = 3; Green has only S.
    expect(cellQty(main, 0)).toEqual(['1', '1', '2', '2']);
    expect(cellQty(main, 1)).toEqual(['0', '3', '0', '0']);
    expect(cellQty(main, 2)).toEqual(['0', null, null, null]);
    expect(main.rows.map((r: { total: string }) => r.total)).toEqual(['6', '3', '0']);
    expect(main.columnTotals).toEqual(['1', '4', '2', '2']);
    expect(main.total).toBe('9');
    expect(anna.total).toBe('6');
    expect(cellQty(anna, 1)[0]).toBe('5');
    expect(grid.total).toBe('15');
    const one = (await owner.get(`/stock/style-grid?itemId=${style.id}&storeId=${ANNA}`).expect(200)).body;
    expect(one.stores.map((s: { store: { code: string } }) => s.store.code)).toEqual(['ANNA']);
    await owner.get(`/stock/style-grid?itemId=${(await byCode('SHIRT-RED-M')).id}`).expect(400);
  });
});

describe('11.17 seasons and markdowns (C4, C5)', () => {
  const start = () => addDays(today(), 3);
  let markdownId: string;

  it('keeps a season list and filters items by season', async () => {
    await owner.post('/seasons').send({ code: 'summer26', name: 'Again' }).expect(409);
    await owner.post('/seasons').send({ code: 'WINTER26', name: 'Winter 2026', startsOn: '2026-11-01', endsOn: '2026-10-01' }).expect(400);
    const winter = (await owner.post('/seasons').send({ code: 'WINTER26', name: 'Winter 2026' }).expect(201)).body;
    await owner.patch(`/seasons/${winter.id}`).send({ active: false }).expect(200);
    const list = (await owner.get('/seasons').expect(200)).body as { code: string; itemCount: number; active: boolean }[];
    expect(list.find((s) => s.code === 'SUMMER26')).toMatchObject({ itemCount: 9, active: true });
    const items = (await owner.get(`/items?seasonId=${seasonId}&pageSize=50`).expect(200)).body;
    expect(items.total).toBe(10);
    // A switched-off season cannot be given to an item.
    const polo = await prisma.item.findFirstOrThrow({ where: { name: 'Polo tee', isParentStyle: true } });
    await owner.patch(`/items/${polo.id}`).send({ seasonId: winter.id }).expect(400);
  });

  it('previews a 30% markdown: old price, new price rounded to the rupee, never above MRP', async () => {
    const preview = (await owner.post('/markdowns/preview').send({ seasonId, rule: 'percent', value: '30', startDate: start() }).expect(200)).body;
    expect(preview).toMatchObject({ priceList: { id: sellList }, items: 9, toChange: 9, skipped: 0, cappedAtMrp: 0 });
    expect(preview.lines[0]).toMatchObject({ code: 'SHIRT-BLU-L', mrp: '1099.00', oldPrice: '799.00', newPrice: '559.00', skipped: null });
    // A fixed price above the MRP is brought down to it.
    const capped = (await owner.post('/markdowns/preview').send({ itemIds: [(await byCode('SHIRT-RED-M')).id], rule: 'price', value: '1500', startDate: start() }).expect(200)).body;
    expect(capped.lines[0]).toMatchObject({ newPrice: '1099.00', cappedAtMrp: true });
    expect(await prisma.price.count({ where: { markdownId: { not: null } } })).toBe(0);
  });

  it('applies it: from the start date the price is 70% of the old one, before it the old price', async () => {
    const res = (await owner.post('/markdowns').send({ seasonId, rule: 'percent', value: '30', startDate: start(), remark: 'End of summer' }).expect(201)).body;
    markdownId = res.id;
    expect(res).toMatchObject({ rule: 'percent', value: '30', startDate: start(), itemCount: 9, status: 'upcoming', toChange: 9 });
    expect(res.lines).toHaveLength(9);
    const redM = await byCode('SHIRT-RED-M');
    const on = async (d: string) => (await owner.get(`/prices/lookup?itemId=${redM.id}&date=${d}`).expect(200)).body.rate;
    expect(await on(today())).toBe('799.00');
    expect(await on(addDays(start(), -1))).toBe('799.00');
    expect(await on(start())).toBe('559.00');
    // The old price stays in the history; the new one points back to the markdown.
    const prices = await prisma.price.findMany({ where: { itemId: redM.id }, orderBy: { startDate: 'asc' } });
    expect(prices.map((p) => [p.price.toFixed(2), p.markdownId])).toEqual([
      ['799.00', null],
      ['559.00', markdownId],
    ]);
    const history = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'markdown', entityId: markdownId } });
    expect(history.changes).toMatchObject({ rule: 'percent', value: '30', items: 9 });
    expect(await prisma.auditLog.count({ where: { entityType: 'price', reason: 'Markdown' } })).toBe(9);
    // Applying it again on the same date adds nothing.
    expect((await owner.post('/markdowns').send({ seasonId, rule: 'percent', value: '30', startDate: start() }).expect(400)).body.message).toMatch(/None of the chosen items/);
    expect((await owner.get('/markdowns').expect(200)).body).toHaveLength(1);
  });

  it('a markdown with an end date gives the old price back after it', async () => {
    const polo = await prisma.item.findFirstOrThrow({ where: { name: 'Polo tee', isParentStyle: true }, include: { variants: true } });
    const from = addDays(today(), 1);
    const end = addDays(today(), 5);
    const res = (await owner.post('/markdowns').send({ itemIds: [polo.id], rule: 'price', value: '399', startDate: from, endDate: end }).expect(201)).body;
    expect(res.itemCount).toBe(2);
    const v = polo.variants[0];
    const on = async (d: string) => (await owner.get(`/prices/lookup?itemId=${v.id}&date=${d}`).expect(200)).body.rate;
    expect(await on(today())).toBe('499.00');
    expect(await on(from)).toBe('399.00');
    expect(await on(end)).toBe('399.00');
    expect(await on(addDays(end, 1))).toBe('499.00');
  });

  it('prints labels showing the old and the new price', async () => {
    const res = (await owner.post('/labels/data').send({ markdownId }).expect(200)).body;
    expect(res.labels).toHaveLength(9);
    expect(res.labels[0]).toMatchObject({ code: 'SHIRT-BLU-L', price: '559.00', wasPrice: '799.00' });
  });

  it('season sell-through shows bought, sold, in stock and percentage sold', async () => {
    const r = (await owner.get('/reports/season-sell-through').expect(200)).body;
    // Bought 10 (the Red receipt), sold 5 at the till; in stock: MAIN 9 + ANNA 6 = 15 (opening counts are not "bought").
    expect(r.rows).toEqual([{ key: seasonId, code: 'SUMMER26', name: 'Summer 2026', bought: '10', sold: '5', inStock: '15', percentSold: '25.00' }]);
    const styles = (await owner.get(`/reports/season-sell-through?seasonId=${seasonId}&storeId=${MAIN}`).expect(200)).body;
    expect(styles.groupBy).toBe('style');
    expect(styles.rows).toEqual([{ key: (await byCode('SHIRT')).id, code: 'SHIRT', name: 'Oxford shirt', bought: '10', sold: '5', inStock: '9', percentSold: '35.71' }]);
    const sales = (await owner.get(`/reports/item-sales?from=${today()}&to=${today()}&seasonId=${seasonId}&groupBy=season`).expect(200)).body;
    expect(sales.rows.map((x: { name: string; quantity: string }) => [x.name, x.quantity])).toEqual([['Summer 2026', '5']]);
  });

  it('needs the price right to mark down, and the catalogue right to change seasons', async () => {
    await owner.post('/users').send({ firstName: 'Ravi', email: 'ravi@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'cashier')], storeIds: [MAIN] }).expect(201);
    const cashier = await login(app, 'ravi@rademics.test', 'Temp-pass-1234');
    await cashier.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await cashier.post('/markdowns/preview').send({ seasonId, rule: 'percent', value: '10', startDate: today() }).expect(403);
    await cashier.post('/markdowns').send({ seasonId, rule: 'percent', value: '10', startDate: today() }).expect(403);
    await cashier.post('/seasons').send({ code: 'X1', name: 'X' }).expect(403);
  });
});
