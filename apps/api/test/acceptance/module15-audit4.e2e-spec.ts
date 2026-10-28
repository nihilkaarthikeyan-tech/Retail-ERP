// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 4 (GST and the law), 28 October 2026: the owner's decisions
// T1–T15 and the defects found, each tried at the till and in the returns.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, gstinCheckCharacter, SEZ_UNDER_LUT, SEZ_WITH_IGST, shortFinancialYear } from 'shared';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, OWNER, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let ownerId: string;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftClientId: string;
let counter = 0;

const num = () => `MAT1/${shortFinancialYear('2026-27')}/${String(++counter).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const withCheck = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;
/** Tamil Nadu (33), the shop's own state. */
const TN_SEZ = withCheck('33AABCS1234A1Z');
const KA_GSTIN = withCheck('29AABCK1234A1Z');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'APP', name: 'Apparel' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2025-09-22' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '4202', rate: '18', effectiveFrom: '2025-09-22' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '9965', rate: '18', effectiveFrom: '2025-09-22' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '0401', rate: '0', kind: 'exempt', effectiveFrom: '2025-09-22' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
  shiftClientId = randomUUID();
  await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
});

/** A till bill that must be saved: on a refusal the test shows the reason. */
async function made(r: ReturnType<Agent['post']>) {
  const res = await r;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

afterAll(async () => {
  await app.close();
});

async function item(name: string, hsnCode: string, price: string | null, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, ...(hsnCode ? { hsnCode } : {}), ...extra }).expect(201)).body as { id: string; code: string };
  if (price) await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2025-04-01' }).expect(201);
  if (extra.isStockItem !== false) {
    const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: i.id, countedQuantity: '50', unitCost: '100' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  }
  return i;
}

function sale(lines: Record<string, unknown>[], amount: string, extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount }], ...extra };
}

function giveBack(original: { id: string; lines: { id: string; item: { id: string } }[] }, amount: string, extra: Record<string, unknown> = {}) {
  return {
    clientId: randomUUID(),
    tillId,
    soldAt: new Date().toISOString(),
    ret: { number: num(), returnOfId: original.id, reason: 'Wrong size', lines: [{ lineNo: 1, itemId: original.lines[0].item.id, quantity: '1', returnOfLineId: original.lines[0].id }] },
    payments: [{ paymentMethodId: pm.CASH, amount: `-${amount}` }],
    ...extra,
  };
}

describe('audit 4: GST and the law', () => {
  let shirt: { id: string; code: string };
  let bag: { id: string; code: string };
  let milk: { id: string; code: string };

  beforeAll(async () => {
    shirt = await item('Cotton Shirt', '62052000', '1050');
    bag = await item('Leather Bag', '42022100', '1180');
    milk = await item('Milk', '04011000', '60');
  });

  it('T6: a supply to an SEZ in the shop’s own state is inter-state, with IGST and the endorsement; under LUT it is without tax (GSTR-1 SEWP / SEWOP, GSTR-3B 3.1(b))', async () => {
    const sez = (await owner.post('/customers').send({ name: 'Sriperumbudur SEZ Unit', gstin: TN_SEZ, taxSituation: 'sez', address: { addressLine1: 'Plot 4, SEZ Road', city: 'Sriperumbudur', stateCode: '33', pincode: '602105' } }).expect(201)).body;
    const withTax = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { customerId: sez.id }))));
    expect(withTax.sale).toMatchObject({ invoiceKind: 'business', placeOfSupply: '33', igst: '50.00', cgst: '0.00', sgst: '0.00' });
    expect(withTax.receipts[0].gst).toMatchObject({ interState: true, buyerSituation: 'sez', endorsement: SEZ_WITH_IGST });

    await owner.patch('/gst/settings').send({ sezUnderLut: true }).expect(200);
    const lut = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { customerId: sez.id }))));
    expect(lut.sale).toMatchObject({ igst: '0.00', cgst: '0.00', taxableAmount: '1050.00', total: '1050.00' });
    expect(lut.receipts[0].gst.endorsement).toBe(SEZ_UNDER_LUT);
    await owner.patch('/gst/settings').send({ sezUnderLut: false }).expect(200);

    const r1 = (await owner.get('/reports/gst/gstr1').expect(200)).body;
    const types = r1.b2b.filter((x: { buyerGstin: string }) => x.buyerGstin === TN_SEZ).map((x: { invType: string }) => x.invType).sort();
    expect(types).toEqual(['SEWOP', 'SEWP']);
    const r3 = (await owner.get('/reports/gst/gstr3b').expect(200)).body;
    expect(r3.outward.zeroRated).toMatchObject({ taxable: '2050.00', igst: '50.00' });
  });

  it('T5: "exempt" is not a buyer situation any more', async () => {
    expect(JSON.stringify((await owner.post('/customers').send({ name: 'Charity Trust', gstin: KA_GSTIN, taxSituation: 'exempt' }).expect(400)).body)).toMatch(/exemption follows the goods/);
  });

  it('T10: taxable and exempt goods together: invoice-cum-bill of supply for a walk-in; refused for a business buyer', async () => {
    const walkIn = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }, { itemId: milk.id, quantity: '1' }], '1110'))));
    expect(walkIn.sale.documentTitle).toBe('Invoice-cum-bill of supply');
    const refused = await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }, { itemId: milk.id, quantity: '1' }], '1110', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: 'Bengaluru' } }));
    expect(refused.status).toBe(400);
    const onlyMilk = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: milk.id, quantity: '1' }], '60'))));
    expect(onlyMilk.sale.documentTitle).toBe('Bill of supply');
  });

  it('M7: a business invoice needs the HSN code of every item', async () => {
    const plain = await item('Gift wrap', '', '20');
    const res = await T(owner.post('/pos/bills')).send(sale([{ itemId: plain.id, quantity: '1' }], '20', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: 'Bengaluru' } }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/HSN code/);
  });

  it('T4: home delivery takes the rate of the goods (composite supply), the highest when they differ', async () => {
    const delivery = await item('Home delivery', '9965', null, { isStockItem: false });
    await owner.patch(`/pos/stores/${MAIN}/delivery-charges`).send({ deliveryCharge: '50', deliveryFreeAbove: '100000' }).expect(200);
    await owner.patch('/pos/settings').send({ deliveryItemId: delivery.id }).expect(200);
    const one = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1100', { delivery: { address: '12 Gandhi Street, Chennai' } }))));
    expect(one.sale.lines.find((l: { item: { id: string } }) => l.item.id === delivery.id).gstRate).toBe('5');
    const two = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }, { itemId: bag.id, quantity: '1' }], '2280', { delivery: { address: '12 Gandhi Street, Chennai' } }))));
    expect(two.sale.lines.find((l: { item: { id: string } }) => l.item.id === delivery.id).gstRate).toBe('18');
    await owner.patch(`/pos/stores/${MAIN}/delivery-charges`).send({ deliveryCharge: '0', deliveryFreeAbove: null }).expect(200);
  });

  it('T8, T9: a return to a walk-in needs their name for the credit note; a return without the bill is a return note, left out of GSTR-1', async () => {
    const sold = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050')))).sale;
    const noName = await T(owner.post('/pos/bills')).send(giveBack(sold, '1050'));
    expect(noName.status).toBe(400);
    expect(noName.body.message).toMatch(/customer’s name/);
    const note = (await made(T(owner.post('/pos/bills')).send(giveBack(sold, '1050', { buyer: { name: 'Lakshmi', stateCode: '33' } }))));
    expect(note.return).toMatchObject({ documentTitle: 'Credit note', buyerName: 'Lakshmi', buyerStateCode: '33', cgst: '-25.00' });

    const approvalToken = (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'return_without_bill' }).expect(200)).body.token;
    const looseRes = await T(owner.post('/pos/bills')).send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), reason: 'No bill', approvalToken, lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1', price: '1050' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-1050' }] });
    expect(looseRes.status, JSON.stringify(looseRes.body)).toBe(201);
    const loose = looseRes.body.return;
    expect(loose).toMatchObject({ documentTitle: 'Return note', cgst: '0.00', sgst: '0.00' });
    const r1 = (await owner.get('/reports/gst/gstr1').expect(200)).body;
    expect(r1.documents.some((d: { series: string; from: string; to: string }) => d.from === loose.number || d.to === loose.number)).toBe(false);
  });

  it('cess cannot be put on a rate (bills do not work it out)', async () => {
    expect(JSON.stringify((await owner.post('/pos/gst-rates').send({ hsnCode: '2202', rate: '28', cessRate: '12', effectiveFrom: '2026-10-01' }).expect(400)).body)).toMatch(/cess is not worked out/);
  });

  it('a bill with a registered e-invoice cannot be cancelled until the IRN is cancelled', async () => {
    const res = (await made(T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: 'Bengaluru' } })))).sale;
    const company = await prisma.posBill.findUniqueOrThrow({ where: { id: res.id }, select: { companyId: true } });
    await prisma.eInvoice.upsert({
      where: { documentType_documentId: { documentType: 'pos_bill', documentId: res.id } },
      update: { status: 'registered', irn: 'a'.repeat(64) },
      create: { companyId: company.companyId, gstRegistrationId: (await prisma.gstRegistration.findFirstOrThrow({ where: { companyId: company.companyId } })).id, documentType: 'pos_bill', documentId: res.id, documentNumber: res.number, status: 'registered', irn: 'a'.repeat(64) },
    });
    const token = (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'cancel_bill' }).expect(200)).body.token;
    const refused = await owner.post(`/pos/bills/${res.id}/cancel`).send({ reason: 'Wrong buyer', approvalToken: token });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/e-invoice \(IRN\)/);
  });

  it('T11: without a GSTR-2B the return says so; the 3B shows purchases without tax (table 5)', async () => {
    const r3 = (await owner.get('/reports/gst/gstr3b').expect(200)).body;
    expect(r3.credit.gstr2bImported).toBe(false);
    expect(r3.notes.join(' ')).toMatch(/No GSTR-2B is imported/);
    expect(r3.inwardNoTax).toEqual({ interState: '0.00', intraState: '0.00' });
  });

  it('T15: a month marked as filed sends later bills of it to the next open month; only after the month is over', async () => {
    const settings = (await owner.patch('/gst/settings').send({ filingFrequency: 'monthly' }).expect(200)).body;
    expect(settings.filingFrequency).toBe('monthly');
    const reg = (await owner.get('/reports/gst/registrations').expect(200)).body.registrations[0];
    const thisMonth = businessDate().slice(0, 7);
    expect((await owner.post('/reports/gst/filed').send({ gstRegistrationId: reg.id, period: thisMonth, returnType: 'gstr1', filedOn: businessDate() }).expect(400)).body.message).toMatch(/only be filed after/);
    // Last month, filed today: an offline bill of last month that arrives now goes into this month.
    const last = new Date(`${thisMonth}-01T00:00:00Z`);
    last.setUTCDate(0);
    const lastMonth = last.toISOString().slice(0, 7);
    const mark = (await owner.post('/reports/gst/filed').send({ gstRegistrationId: reg.id, period: lastMonth, returnType: 'gstr1', filedOn: businessDate() }).expect(201)).body;
    expect((await owner.get(`/reports/gst/filed?gstRegistrationId=${reg.id}`).expect(200)).body.map((f: { period: string }) => f.period)).toEqual([lastMonth]);
    const late = (
      await T(owner.post('/pos/bills'))
        .send({ clientId: randomUUID(), tillId, shiftClientId, offline: true, soldAt: `${lastMonth}-28T11:00:00+05:30`, sale: { number: num(), lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '1050' }] })
        .expect(201)
    ).body.sale;
    expect((await prisma.posBill.findUniqueOrThrow({ where: { id: late.id }, select: { gstPeriod: true } })).gstPeriod).toBe(thisMonth);
    await owner.delete(`/reports/gst/filed/${mark.id}`).expect(204);
    await owner.patch('/gst/settings').send({ filingFrequency: 'quarterly' }).expect(200);
  });

  it('IFF: a quarterly filer’s first month lists only business invoices; the third month has none', async () => {
    const thisMonth = businessDate().slice(0, 7);
    const m = Number(thisMonth.slice(5, 7));
    const res = await owner.get(`/reports/gst/gstr1?period=${thisMonth}`);
    if (m % 3 === 0) {
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/third month/);
    } else {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ iff: true, b2cs: [], b2cl: [], hsnBusiness: [], documents: [] });
      expect(res.body.b2b.length).toBeGreaterThan(0);
    }
  });

  it('T13: a composition shop gets the CMP-08 figure (1% of taxable turnover) and cannot sell to another state', async () => {
    await owner.patch('/gst/settings').send({ scheme: 'composition' }).expect(200);
    const res = await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: 'Bengaluru' } }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10\(2\)\(c\)/);
    (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '2' }], '2100')).expect(201));
    const r3 = (await owner.get('/reports/gst/gstr3b').expect(200)).body;
    expect(r3.composition).toMatchObject({ outward: { rate: '1.00' } });
    expect(r3.composition.outward.cgst).toBe(r3.composition.outward.sgst);
    await owner.patch('/gst/settings').send({ scheme: 'regular' }).expect(200);
  });

  it('HSN digits: above ₹5 crore every invoice needs 6 digits', async () => {
    expect((await owner.patch('/gst/settings').send({ turnoverBand: '5cr_to_10cr', hsnDigits: 4 }).expect(400)).body.message).toMatch(/6-digit/);
    await owner.patch('/gst/settings').send({ turnoverBand: '5cr_to_10cr', hsnDigits: 6 }).expect(200);
    await owner.patch('/gst/settings').send({ turnoverBand: 'up_to_5cr', hsnDigits: 4 }).expect(200);
  });
});
