// Copyright (c) 2026, Rademics. All rights reserved.
// The owner's decisions of 28 October 2026 on the launch check (docs/decisions.md, L1–L12).
import type { INestApplication } from '@nestjs/common';
import { addDays, businessDate, Decimal, SHOP_TYPES } from 'shared';
import type { App } from 'supertest/types.js';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let pcs: string;
let groupId: string;
let supplierId: string;

const today = () => businessDate();

async function acct(key: string): Promise<string> {
  return (await prisma.account.findFirstOrThrow({ where: { systemKey: key } })).id;
}

/** Debit minus credit of an account, as "12.34". */
async function bal(key: string): Promise<string> {
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: await acct(key) }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

async function item(name: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, ...extra }).expect(201)).body as { id: string; code: string; maxDiscountPercent: string; autoNumberBatches: boolean };
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  MAIN = await storeId(prisma, 'MAIN');
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'TEST', name: 'Test goods' }).expect(201)).body.id;
  const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  const supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  supplierId = (await owner.post('/suppliers').send({ name: 'Tiruppur Garments', supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body.id;
});

afterAll(async () => {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  await app.close();
});

describe('L1, L2, L6: the clothing template', () => {
  it('adds its common HSN codes with the official descriptions, XS and Free size, and a 10% starting discount', async () => {
    const ask = (await owner.post('/modules/shop-type').send({ type: 'clothing' }).expect(200)).body;
    expect(ask.hsnCodes).toEqual([...SHOP_TYPES.clothing.hsnCodes]);
    const done = (await owner.post('/modules/shop-type').send({ type: 'clothing', confirm: true }).expect(200)).body;
    expect(done.hsnCodes).toEqual([...SHOP_TYPES.clothing.hsnCodes]);

    const shirts = await prisma.hsnCode.findFirstOrThrow({ where: { code: '6205' } });
    expect(shirts.description).toBe("MEN'S OR BOYS' SHIRTS");
    expect(await prisma.auditLog.count({ where: { entityType: 'hsn_code', action: 'create' } })).toBe(SHOP_TYPES.clothing.hsnCodes.length);

    const size = await prisma.variantAttribute.findFirstOrThrow({ where: { code: 'SIZE' }, include: { values: { orderBy: { sortOrder: 'asc' } } } });
    expect(size.values.map((v) => [v.value, v.shortCode])).toEqual([
      ['XS', 'XS'],
      ['S', 'S'],
      ['M', 'M'],
      ['L', 'L'],
      ['XL', 'XL'],
      ['XXL', 'XXL'],
      ['Free size', 'FS'],
    ]);

    const settings = (await owner.get('/catalogue/settings').expect(200)).body;
    expect(Number(settings.newItemMaxDiscountPercent)).toBe(10);
    const kurti = await item('Cotton kurti', { hsnCode: '6204' });
    expect(Number(kurti.maxDiscountPercent)).toBe(10);
    // A typed discount still wins.
    expect(Number((await item('Silk saree', { maxDiscountPercent: '5' })).maxDiscountPercent)).toBe(5);
  });

  it('applying it again adds nothing twice; a code the shop changed keeps its own description', async () => {
    await prisma.hsnCode.updateMany({ where: { code: '6205' }, data: { description: 'Shirts (our wording)' } });
    await owner.post('/modules/shop-type').send({ type: 'fancy', confirm: true }).expect(200);
    const back = (await owner.post('/modules/shop-type').send({ type: 'clothing', confirm: true }).expect(200)).body;
    expect(back.hsnCodes).toEqual([]);
    expect((await prisma.hsnCode.findFirstOrThrow({ where: { code: '6205' } })).description).toBe('Shirts (our wording)');
    expect(await prisma.hsnCode.count({ where: { code: '6205' } })).toBe(1);
  });
});

describe('L12: the cosmetics template', () => {
  it('starts batch items with the batch number typed from the pack', async () => {
    await owner.post('/modules/shop-type').send({ type: 'cosmetics', confirm: true }).expect(200);
    const settings = (await owner.get('/catalogue/settings').expect(200)).body;
    expect(settings).toMatchObject({ newItemAutoNumberBatches: false });
    expect(Number(settings.newItemMaxDiscountPercent)).toBe(0);
    expect((await item('Face cream 50 g', { hsnCode: '3304', trackBatches: true })).autoNumberBatches).toBe(false);
    // The owner can still tick it on one item.
    expect((await item('Lip balm', { hsnCode: '3304', trackBatches: true, autoNumberBatches: true })).autoNumberBatches).toBe(true);
    expect((await item('Plain item')).autoNumberBatches).toBe(false);
    // Back to clothing: new batch items number themselves again.
    await owner.post('/modules/shop-type').send({ type: 'clothing', confirm: true }).expect(200);
    expect((await owner.get('/catalogue/settings').expect(200)).body.newItemAutoNumberBatches).toBe(true);
  });
});

describe('L3: a markdown can be withdrawn or ended early', () => {
  let shirt: { id: string };
  const rate = async (d: string) => (await owner.get(`/prices/lookup?itemId=${shirt.id}&date=${d}`).expect(200)).body.rate;

  beforeAll(async () => {
    shirt = await item('Linen shirt', { hsnCode: '6205', mrp: '1200', sellingPrice: '1000' });
    // Its price has been on sale for a while (a price added today would win over a markdown that started earlier).
    await prisma.price.updateMany({ where: { itemId: shirt.id }, data: { startDate: new Date(`${addDays(today(), -30)}T00:00:00Z`) } });
  });

  it('withdrawn before it starts: its prices never apply', async () => {
    const md = (await owner.post('/markdowns').send({ itemIds: [shirt.id], rule: 'percent', value: '20', startDate: addDays(today(), 2) }).expect(201)).body;
    expect(await rate(addDays(today(), 2))).toBe('800.00');
    await owner.post(`/markdowns/${md.id}/stop`).send({}).expect(400);
    const stopped = (await owner.post(`/markdowns/${md.id}/stop`).send({ reason: 'Wrong items chosen' }).expect(200)).body;
    expect(stopped).toMatchObject({ status: 'withdrawn', stoppedOn: today(), stoppedReason: 'Wrong items chosen' });
    expect(await rate(addDays(today(), 2))).toBe('1000.00');
    // Nothing is deleted: the price is kept, ended before it began, and the change is in the history.
    const price = await prisma.price.findFirstOrThrow({ where: { markdownId: md.id } });
    expect(price.endDate!.toISOString().slice(0, 10)).toBe(addDays(today(), 1));
    expect(await prisma.auditLog.count({ where: { entityType: 'price', entityId: price.id, reason: 'Markdown withdrawn' } })).toBe(1);
    expect((await owner.post(`/markdowns/${md.id}/stop`).send({ reason: 'Again' }).expect(400)).body.message).toMatch(/already stopped/);
  });

  it('ended early: from today the price before the markdown applies again', async () => {
    const md = (await owner.post('/markdowns').send({ itemIds: [shirt.id], rule: 'price', value: '700', startDate: addDays(today(), -3) }).expect(201)).body;
    expect(await rate(today())).toBe('700.00');
    const stopped = (await owner.post(`/markdowns/${md.id}/stop`).send({ reason: 'Supplier price went up' }).expect(200)).body;
    expect(stopped).toMatchObject({ status: 'ended', endDate: addDays(today(), -1), stoppedOn: today() });
    expect(await rate(today())).toBe('1000.00');
    // The days it ran keep their price (bills of those days are unchanged).
    expect(await rate(addDays(today(), -2))).toBe('700.00');
    const list = (await owner.get('/markdowns').expect(200)).body as { id: string; status: string }[];
    expect(list.find((m) => m.id === md.id)?.status).toBe('ended');
  });
});

describe('L4: a purchase order line of an item never bought takes the GST rate list', () => {
  it('uses the band of the price per piece before GST, and 0 only when the list has nothing', async () => {
    await owner.post('/pos/gst-rates').send({ hsnCode: '6203', rate: '5', priceUpTo: '2500', effectiveFrom: '2025-09-22' }).expect(201);
    await owner.post('/pos/gst-rates').send({ hsnCode: '6203', rate: '18', priceFrom: '2500', effectiveFrom: '2025-09-22' }).expect(201);
    const trousers = await item('Cotton trousers', { hsnCode: '6203' });
    const suit = await item('Wool suit', { hsnCode: '6203' });
    const unknown = await item('Gift box', { hsnCode: '4819' });
    const order = (
      await owner
        .post('/purchase/orders')
        .send({
          supplierId,
          storeId: MAIN,
          neededBy: addDays(today(), 7),
          lines: [
            { itemId: trousers.id, quantity: '10', rate: '900' },
            { itemId: suit.id, quantity: '2', rate: '6000' },
            { itemId: unknown.id, quantity: '5', rate: '40' },
          ],
        })
        .expect(201)
    ).body;
    expect(order.lines.map((l: { gstRate: string }) => Number(l.gstRate))).toEqual([5, 18, 0]);
  });
});

describe('L5: freight on goods returned to the supplier', () => {
  it('goes back to Freight inward, so goods received not billed clears with the debit note', async () => {
    await owner.post('/pos/gst-rates').send({ hsnCode: '6109', rate: '5', effectiveFrom: '2025-09-22' }).expect(201);
    const tee = await item('Round-neck T-shirt', { hsnCode: '6109' });
    const freightBefore = new Decimal(await bal('freight_inward'));
    const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId, noOrderReason: 'Local purchase', lines: [{ itemId: tee.id, receivedQuantity: '10', rate: '100', gstRate: '5' }] }).expect(201)).body;
    const receipt = (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
    const charge = (await owner.post('/purchase/charges').send({ shareBy: 'value', receiptIds: [receipt.id], charges: [{ description: 'Lorry freight', chargeType: 'freight', amount: '100' }] }).expect(201)).body;
    await owner.post(`/purchase/charges/${charge.id}/finalise`).expect(200);
    const billDraft = (await owner.post('/purchase/bills').send({ kind: 'against_receipt', supplierId, supplierBillNo: 'TG/1', supplierBillDate: today(), lines: [{ receiptLineId: receipt.lines[0].id, itemId: tee.id, quantity: '10', rate: '100' }] }).expect(201)).body;
    const bill = (await owner.post(`/purchase/bills/${billDraft.id}/finalise`).send({}).expect(200)).body;
    expect(await bal('goods_received_not_billed')).toBe('0.00');

    // Two pieces (₹110 each with their freight) go back to the supplier, who sends a debit note for ₹200 of goods.
    await owner.post(`/purchase/receipts/${receipt.id}/return`).send({ reason: 'Stitching faults', lines: [{ originalLineId: receipt.lines[0].id, acceptedQuantity: '2' }] }).expect(201);
    expect(await bal('goods_received_not_billed')).toBe('200.00');
    await owner.post(`/purchase/bills/${bill.id}/debit-note`).send({ reason: 'Stitching faults', lines: [{ originalLineId: bill.lines[0].id, quantity: '2' }] }).expect(201);
    expect(await bal('goods_received_not_billed')).toBe('0.00');
    expect(new Decimal(await bal('freight_inward')).sub(freightBefore).toFixed(2)).toBe('-80.00');
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { remark: 'Freight share of the goods returned' }, include: { lines: true } });
    expect(entry.lines.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)]).sort((a, b) => a.join().localeCompare(b.join()))).toEqual([
      ['0.00', '20.00'],
      ['20.00', '0.00'],
    ]);
  });
});

describe('L9: a till day allows at most 1 paisa of rounding per bill', () => {
  it('a 2-paisa difference on a one-bill day is refused, 1 paisa goes to Rounding', async () => {
    const company = await prisma.company.findFirstOrThrow();
    const ledger = app.get(LedgerService);
    const post = (debit: string, tolerance: Decimal) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.company_id', ${company.id}, true)`;
        return ledger.post(tx, { companyId: company.id, date: today(), documentType: 'test', documentId: company.id, storeId: MAIN, actorId: null, tolerance, lines: [{ role: 'cash_in_till', storeId: MAIN, debit: new Decimal(debit) }, { role: 'sales', storeId: MAIN, credit: new Decimal('100') }] });
      });
    await expect(post('100.02', new Decimal('0.01'))).rejects.toThrow(/must balance/);
    const before = new Decimal(await bal('rounding'));
    await post('100.01', new Decimal('0.01'));
    expect(new Decimal(await bal('rounding')).sub(before).toFixed(2)).toBe('-0.01');
  });
});

describe('L10: a new store has its cash accounts at once', () => {
  it('before its first till shift', async () => {
    const store = (await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201)).body;
    const accounts = await prisma.account.findMany({ where: { storeId: store.id }, orderBy: { name: 'asc' } });
    expect(accounts.map((a) => a.systemKey)).toEqual(expect.arrayContaining([`cash_in_till:${store.id}`, `cash_in_hand:${store.id}`]));
    expect(accounts.map((a) => a.name)).toEqual(expect.arrayContaining(['Cash in till — ANNA']));
  });
});
