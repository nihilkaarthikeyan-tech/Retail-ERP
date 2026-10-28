// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 8": 8.8
// GSTR-1 and the HSN summary for a month, and 8.9 GSTR-3B. The month's
// documents are made through the till and purchase APIs (business invoices
// with the buyer's GSTIN, as the till makes them).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, Decimal, gstinCheckCharacter } from 'shared';
import { readXlsx } from '../../src/imports/spreadsheet.js';
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
let terms: Record<string, string>;
let supplierGroups: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftId: string;
let n = 0;

const today = () => businessDate();
const period = () => today().slice(0, 7);
const withCheck = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;
const MAIN_GSTIN = '33AAACR1234A1ZA';
/** A Karnataka (29) buyer and a Tamil Nadu (33) buyer, with correct check characters. */
const KA_GSTIN = withCheck('29AABCK1234A1Z');
const TN_GSTIN = withCheck('33AABCT1234A1Z');
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const sum = (list: string[]) => list.reduce((t, x) => t.add(x), new Decimal(0)).toFixed(2);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GEN', name: 'General' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  for (const [hsnCode, rate] of [
    ['6205', '5'],
    ['9102', '18'],
    ['1006', '5'],
    ['0401', '0'],
    ['9965', '18'],
    ['9983', '18'],
  ]) {
    await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
  }
  await owner.patch('/gst/settings').send({ filingFrequency: 'monthly', hsnDigits: 4 }).expect(200);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] }).expect(201)).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  shiftId = (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '0' }] }).expect(201)).body.id;
}

/** A shelf item with a GST-inclusive price and opening stock. */
async function item(name: string, hsnCode: string, price: string) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, maxDiscountPercent: '30' }).expect(201)).body as { id: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: i.id, countedQuantity: '20', unitCost: '10' }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  return i;
}

type Bill = { id: string; number: string; total: string; lines: { id: string }[] };

/** A sale paid by card (so the shift closes with no cash to count). */
async function sell(lines: Record<string, unknown>[], total: string, extra: Record<string, unknown> = {}): Promise<Bill> {
  const body = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CARD, amount: total, reference: `AUTH${n}` }], ...extra };
  const res = await T(owner.post('/pos/bills')).send(body);
  if (res.status !== 201) throw new Error(`Sale refused: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.sale as Bill;
}

async function giveBack(original: Bill, itemId: string, quantity: string, refund: string): Promise<Bill> {
  const body = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), buyer: { name: 'Walk-in customer' }, ret: { number: num(), returnOfId: original.id, lines: [{ lineNo: 1, itemId, quantity, returnOfLineId: original.lines[0].id }] }, payments: [{ paymentMethodId: pm.CARD, amount: `-${refund}`, reference: `REF${n}` }] };
  const res = await T(owner.post('/pos/bills')).send(body);
  if (res.status !== 201) throw new Error(`Return refused: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.return as Bill;
}

async function supplier(name: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/suppliers').send({ name, supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30, ...extra }).expect(201)).body as { id: string };
}

async function serviceBill(supplierId: string, billNo: string, lines: Record<string, unknown>[]) {
  const draft = (await owner.post('/purchase/bills').send({ kind: 'services', supplierId, supplierBillNo: billNo, supplierBillDate: today(), storeId: MAIN, lines }).expect(201)).body;
  return (await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(200)).body;
}

async function staff(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

async function download(path: string): Promise<Buffer> {
  const res = await owner
    .get(path)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  return res.body as Buffer;
}

describe('8.8 GSTR-1 and HSN summary for a month; 8.9 GSTR-3B', () => {
  let regId: string;
  const q = () => `?period=${period()}&gstRegistrationId=${regId}`;

  beforeAll(async () => {
    await freshCompany();
    regId = (await prisma.gstRegistration.findFirstOrThrow({ where: { gstin: MAIN_GSTIN } })).id;
    const shirt = await item('Cotton Shirt', '62052000', '1050');
    const watch = await item('Gold Watch', '91021100', '295000');
    const rice = await item('Ponni Rice 1 kg', '10063010', '105');
    const milk = await item('Fresh Milk 500 ml', '04011000', '30');

    // Consumer bills in the state.
    const a = await sell([{ itemId: shirt.id, quantity: '2' }], '2100');
    await sell([{ itemId: rice.id, quantity: '1' }, { itemId: milk.id, quantity: '1' }], '135');
    // A business invoice to another state (IGST) and one in the state (CGST + SGST).
    const c = await sell([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: '12 MG Road, Bengaluru 560001' } });
    await sell([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: TN_GSTIN, name: 'Tamil Textiles', address: '5 Anna Salai, Chennai' } });
    // A large consumer bill to another state (above ₹2.5 lakh, so B2CL under either limit).
    // Audit 4 (T1): a walk-in taking goods at the counter is taxed in the shop's state; delivered to Karnataka, it is IGST.
    const d = await sell([{ itemId: watch.id, quantity: '1' }], '295000', { buyer: { name: 'Ravi Kumar', address: '8 Brigade Road, Bengaluru', stateCode: '29' }, delivery: { address: '8 Brigade Road, Bengaluru', stateCode: '29' } });
    // A bill cancelled with the owner's PIN: it counts only in documents issued.
    const f = await sell([{ itemId: rice.id, quantity: '1' }], '105');
    await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
    const ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
    const { token } = (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'cancel_bill' }).expect(200)).body;
    await owner.post(`/pos/bills/${f.id}/cancel`).send({ reason: 'Keyed twice', approvalToken: token }).expect(200);
    // Credit notes: against the business invoice (CDNR), a consumer bill (netted in B2CS) and the large bill (CDNUR).
    await giveBack(c, shirt.id, '1', '1050');
    await giveBack(a, shirt.id, '1', '1050');
    await giveBack(d, watch.id, '1', '295000');
  });

  it('8.8 the sales tax register lists each invoice and credit note with its tax per head', async () => {
    const r = (await owner.get(`/reports/gst/sales-register${q()}`).expect(200)).body;
    expect(r).toMatchObject({ gstin: MAIN_GSTIN, fp: `${period().slice(5, 7)}${period().slice(0, 4)}` });
    expect(r.rows).toHaveLength(8);
    expect(r.totals).toMatchObject({ documents: 8, taxable: '2130.00', igst: '0.00', cgst: '52.50', sgst: '52.50' });
    const business = (await owner.get(`/reports/gst/sales-register${q()}&kind=business`).expect(200)).body;
    expect(business.rows.map((x: { buyerGstin: string }) => x.buyerGstin).sort()).toEqual([KA_GSTIN, KA_GSTIN, TN_GSTIN].sort());
    const karnataka = (await owner.get(`/reports/gst/sales-register${q()}&placeOfSupply=29`).expect(200)).body;
    expect(karnataka.totals).toMatchObject({ documents: 4, taxable: '0.00', igst: '0.00' });
    expect(karnataka.rows.find((x: { section: string }) => x.section === 'b2cl')).toMatchObject({ taxable: '250000.00', igst: '45000.00', invoiceKind: 'consumer' });
    // A quarterly filer sees the same documents in the quarter; the portal period is the quarter's last month.
    const m = Number(period().slice(5, 7));
    const fy = m >= 4 ? Number(period().slice(0, 4)) : Number(period().slice(0, 4)) - 1;
    const quarter = (await owner.get(`/reports/gst/sales-register?period=${fy}-Q${m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4}`).expect(200)).body;
    expect(quarter.totals).toEqual(r.totals);
    expect(Number(quarter.fp.slice(0, 2)) % 3).toBe(0);
    const regs = (await owner.get('/reports/gst/registrations').expect(200)).body;
    expect(regs).toMatchObject({ filingFrequency: 'monthly', currentPeriod: period(), registrations: [{ gstin: MAIN_GSTIN, stores: [{ code: 'MAIN' }] }] });
  });

  it('8.8 B2B, B2CL, B2CS, credit notes, nil, HSN summary and documents issued all add up to the sales tax register', async () => {
    const g = (await owner.get(`/reports/gst/gstr1${q()}`).expect(200)).body;
    expect(g.b2b).toHaveLength(2);
    expect(g.b2b.find((x: { buyerGstin: string }) => x.buyerGstin === KA_GSTIN)).toMatchObject({ value: '1050.00', placeOfSupply: '29', items: [{ rate: '5.00', taxable: '1000.00', igst: '50.00', cgst: '0.00', sgst: '0.00' }] });
    expect(g.b2b.find((x: { buyerGstin: string }) => x.buyerGstin === TN_GSTIN)).toMatchObject({ placeOfSupply: '33', items: [{ taxable: '1000.00', cgst: '25.00', sgst: '25.00' }] });
    expect(g.b2cl).toMatchObject([{ value: '295000.00', placeOfSupply: '29', buyerGstin: null, items: [{ rate: '18.00', taxable: '250000.00', igst: '45000.00' }] }]);
    // B2CS by state and rate, net of the consumer credit note: 2,000 + 100 (rice) − 1,000.
    expect(g.b2cs).toEqual([{ supplyType: 'INTRA', placeOfSupply: '33', rate: '5.00', taxable: '1100.00', igst: '0.00', cgst: '27.50', sgst: '27.50', cess: '0.00' }]);
    expect(g.cdnr).toMatchObject([{ buyerGstin: KA_GSTIN, noteType: 'C', placeOfSupply: '29', originalNumber: 'MAT1/2627/000003', items: [{ taxable: '-1000.00', igst: '-50.00' }], late: false }]);
    expect(g.cdnur).toMatchObject([{ buyerGstin: null, placeOfSupply: '29', items: [{ rate: '18.00', taxable: '-250000.00', igst: '-45000.00' }] }]);
    expect(g.nil).toEqual([{ supplyType: 'INTRAB2C', nil: '30.00', exempt: '0.00', nonGst: '0.00' }]);
    // HSN at 4 digits, business and consumer apart, with credit notes as minus figures.
    // The shop gave 6205 no description, so the official one is used (owner, 28 October 2026).
    expect(g.hsnBusiness).toEqual([{ hsn: '6205', description: expect.stringMatching(/SHIRTS/), uqc: 'PCS', quantity: '1', rate: '5.00', taxable: '1000.00', igst: '0.00', cgst: '25.00', sgst: '25.00', cess: '0.00' }]);
    expect(g.hsnConsumer.map((h: { hsn: string; quantity: string; taxable: string }) => [h.hsn, h.quantity, h.taxable])).toEqual([
      ['0401', '1', '30.00'],
      ['1006', '1', '100.00'],
      ['6205', '1', '1000.00'],
      ['9102', '0', '0.00'],
    ]);
    // Documents issued: six invoices (one cancelled) and three credit notes, one series.
    expect(g.documents).toEqual([
      { series: 'MAT1/2627/', from: 'MAT1/2627/000001', to: 'MAT1/2627/000006', total: 6, cancelled: 1, net: 5, missing: 0, nature: 1, natureLabel: 'Invoices for outward supply' },
      { series: 'MAT1/2627/', from: 'MAT1/2627/000007', to: 'MAT1/2627/000009', total: 3, cancelled: 0, net: 3, missing: 0, nature: 5, natureLabel: 'Credit Note' },
    ]);
    // The ₹135 bill with no buyer shows in the combined daily view of sales under ₹200.
    expect(g.smallSales).toMatchObject([{ date: today(), store: 'MAIN', bills: 1, value: '135.00', taxable: '130.00' }]);
    // Every section adds up to the register.
    expect(g.reconciliation).toMatchObject({ sectionsAgree: true, hsnAgrees: true, documentsAgree: true, register: { taxable: '2130.00', cgst: '52.50', sgst: '52.50', igst: '0.00' } });
    const s = g.reconciliation.sections;
    expect(sum([s.b2b.taxable, s.b2cl.taxable, s.b2cs.taxable, s.cdnr.taxable, s.cdnur.taxable, s.nil.taxable, s.excluded.taxable])).toBe('2130.00');
    expect(sum([...g.hsnBusiness, ...g.hsnConsumer].map((h: { taxable: string }) => h.taxable))).toBe('2130.00');
    // The till's numbers (PREFIX/2627/000001) fit the portal's 16 characters, so there is no warning about them.
    expect(g.warnings.join(' ')).not.toMatch(/longer than 16 characters/);
  });

  it('8.8 the Excel and the GST portal JSON downloads carry the same figures, and both are recorded in the history', async () => {
    const g = (await owner.get(`/reports/gst/gstr1${q()}`).expect(200)).body;
    const xlsx = await download(`/reports/gst/gstr1/excel${q()}`);
    const b2b = readXlsx(xlsx, 'b2b');
    expect(b2b[0]).toEqual(['GSTIN of buyer', 'Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess']);
    expect(b2b.slice(1).map((r) => r[6])).toEqual(g.b2b.map((x: { items: { taxable: string }[] }) => Number(x.items[0].taxable)));
    expect(readXlsx(xlsx, 'b2cs').slice(1)).toEqual([['INTRA', '33', 5, 1100, 0, 27.5, 27.5, 0]]);
    expect(readXlsx(xlsx, 'cdnur').slice(1)[0]).toContain(-250000);
    expect(readXlsx(xlsx, 'hsn(b2c)').slice(1).map((r) => r[0])).toEqual(['0401', '1006', '6205', '9102']);
    expect(readXlsx(xlsx, 'docs').slice(1).map((r) => [r[0], r[4], r[5], r[6]])).toEqual([
      ['Invoices for outward supply', 6, 1, 5],
      ['Credit Note', 3, 0, 3],
    ]);
    expect(readXlsx(xlsx, 'summary').find((r) => r[0] === 'Sections agree with the register')?.[1]).toBe('Yes');

    const json = JSON.parse((await download(`/reports/gst/gstr1/json${q()}`)).toString('utf8'));
    expect(json.gstin).toBe(MAIN_GSTIN);
    expect(json.fp).toBe(g.fp);
    const [dd, mm, yyyy] = [today().slice(8, 10), today().slice(5, 7), today().slice(0, 4)];
    expect(json.b2b.find((x: { ctin: string }) => x.ctin === KA_GSTIN).inv[0]).toEqual({ inum: 'MAT1/2627/000003', idt: `${dd}-${mm}-${yyyy}`, val: 1050, pos: '29', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 5, txval: 1000, iamt: 50, csamt: 0 } }] });
    expect(json.b2cl).toEqual([{ pos: '29', inv: [{ inum: 'MAT1/2627/000005', idt: `${dd}-${mm}-${yyyy}`, val: 295000, itms: [{ num: 1, itm_det: { rt: 18, txval: 250000, iamt: 45000, csamt: 0 } }] }] }]);
    expect(json.b2cs).toEqual([{ sply_ty: 'INTRA', pos: '33', typ: 'OE', rt: 5, txval: 1100, camt: 27.5, samt: 27.5, csamt: 0 }]);
    expect(json.cdnr[0]).toMatchObject({ ctin: KA_GSTIN, nt: [{ ntty: 'C', val: 1050, pos: '29', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 5, txval: 1000, iamt: 50 } }] }] });
    expect(json.cdnur).toMatchObject([{ typ: 'B2CL', ntty: 'C', val: 295000, pos: '29', itms: [{ itm_det: { rt: 18, txval: 250000, iamt: 45000 } }] }]);
    expect(json.nil).toEqual({ inv: [{ sply_ty: 'INTRAB2C', nil_amt: 30, expt_amt: 0, ngsup_amt: 0 }] });
    expect(json.hsn.hsn_b2b).toEqual([{ num: 1, hsn_sc: '6205', desc: "MEN'S OR BOYS' SHIRTS", uqc: 'PCS', qty: 1, rt: 5, txval: 1000, iamt: 0, camt: 25, samt: 25, csamt: 0 }]);
    expect(json.hsn.hsn_b2c.map((h: { hsn_sc: string; txval: number }) => [h.hsn_sc, h.txval])).toEqual([
      ['0401', 30],
      ['1006', 100],
      ['6205', 1000],
      ['9102', 0],
    ]);
    expect(json.doc_issue.doc_det).toEqual([
      { doc_num: 1, doc_typ: 'Invoices for outward supply', docs: [{ num: 1, from: 'MAT1/2627/000001', to: 'MAT1/2627/000006', totnum: 6, cancel: 1, net_issue: 5 }] },
      { doc_num: 5, doc_typ: 'Credit Note', docs: [{ num: 1, from: 'MAT1/2627/000007', to: 'MAT1/2627/000009', totnum: 3, cancel: 0, net_issue: 3 }] },
    ]);
    // The JSON's taxable values add up to the same register total as the screen.
    const jsonTaxable = [
      ...json.b2b.flatMap((x: { inv: { itms: { itm_det: { txval: number } }[] }[] }) => x.inv.flatMap((i) => i.itms.map((it) => String(it.itm_det.txval)))),
      ...json.b2cl.flatMap((x: { inv: { itms: { itm_det: { txval: number } }[] }[] }) => x.inv.flatMap((i) => i.itms.map((it) => String(it.itm_det.txval)))),
      ...json.b2cs.map((x: { txval: number }) => String(x.txval)),
      ...json.cdnr.flatMap((x: { nt: { itms: { itm_det: { txval: number } }[] }[] }) => x.nt.flatMap((i) => i.itms.map((it) => `-${it.itm_det.txval}`))),
      ...json.cdnur.flatMap((x: { itms: { itm_det: { txval: number } }[] }) => x.itms.map((it) => `-${it.itm_det.txval}`)),
      ...json.nil.inv.map((x: { nil_amt: number; expt_amt: number }) => new Decimal(x.nil_amt).add(x.expt_amt).toString()),
    ];
    expect(sum(jsonTaxable)).toBe(g.reconciliation.register.taxable);

    const logged = await prisma.auditLog.findMany({ where: { action: 'export', entityType: 'report' }, orderBy: { at: 'asc' } });
    expect(logged.map((l) => (l.changes as { report: string }).report)).toEqual(['GSTR-1 (Excel)', 'GSTR-1 (portal JSON)']);
    expect(logged[0].changes).toMatchObject({ filters: { gstin: MAIN_GSTIN, period: period() } });
  });

  it('8.5 the credit note register names the original bill and the 30 November deadline', async () => {
    const r = (await owner.get(`/reports/gst/notes${q()}`).expect(200)).body;
    const fy = Number(today().slice(5, 7)) >= 4 ? Number(today().slice(0, 4)) + 1 : Number(today().slice(0, 4));
    expect(r.rows.filter((x: { kind: string }) => x.kind === 'credit_note')).toHaveLength(3);
    expect(r.rows.find((x: { originalNumber: string }) => x.originalNumber === 'MAT1/2627/000003')).toMatchObject({ kind: 'credit_note', party: KA_GSTIN, originalDate: today(), deadline: `${fy}-11-30`, status: 'ok', section: 'cdnr', taxable: '-1000.00', igst: '-50.00' });
  });

  it('8.9 GSTR-3B: tax per head from the accounts, input credit set off IGST first, plus reverse charge, gives the net payable; extra credit carries forward', async () => {
    // Close the shift so the till bills reach the accounts.
    await T(owner.post(`/pos/shifts/${shiftId}/close`)).send({ denominations: {} }).expect(200);
    const consult = (await owner.post('/items').send({ name: 'Consulting', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '9983', isStockItem: false }).expect(201)).body;
    const legal = (await owner.post('/items').send({ name: 'Legal services', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '9965', isStockItem: false }).expect(201)).body;
    // Input credit: CGST + SGST ₹9 each in the state, IGST ₹180 from Karnataka, and ₹90 that cannot be claimed.
    await serviceBill((await supplier('Chennai Consultants', { stateCode: '33' })).id, 'CC/1', [{ itemId: consult.id, quantity: '1', rate: '100', gstRate: '18' }]);
    await serviceBill((await supplier('Bengaluru Advisers', { stateCode: '29' })).id, 'BA/1', [{ itemId: consult.id, quantity: '1', rate: '1000', gstRate: '18' }]);
    await serviceBill((await supplier('Club House', { stateCode: '33' })).id, 'CH/1', [{ itemId: consult.id, quantity: '1', rate: '500', gstRate: '18', creditClaimable: false }]);
    // Reverse charge: ₹10,000 at 18%, ₹1,800 payable by the shop in cash, and the same claimed as credit.
    await serviceBill((await supplier('K. Raman, Advocate', { stateCode: '33', taxSituation: 'reverse_charge' })).id, 'KR/7', [{ itemId: legal.id, quantity: '1', rate: '10000', gstRate: '18' }]);

    const r = (await owner.get(`/reports/gst/gstr3b${q()}`).expect(200)).body;
    expect(r.outward).toMatchObject({ taxable: { taxable: '2100.00', igst: '0.00', cgst: '52.50', sgst: '52.50' }, nilExempt: '30.00', reverseChargeInward: { taxable: '10000.00', cgst: '900.00', sgst: '900.00' } });
    expect(r.interStateUnregistered).toEqual([{ placeOfSupply: '29', taxable: '0.00', igst: '0.00' }]);
    expect(r.outputTaxFromAccounts).toEqual(r.outputTaxFromBills);
    expect(r.outputTaxFromAccounts).toMatchObject({ igst: '0.00', cgst: '52.50', sgst: '52.50' });
    expect(r.credit).toMatchObject({
      reverseCharge: { igst: '0.00', cgst: '900.00', sgst: '900.00' },
      allOther: { igst: '180.00', cgst: '9.00', sgst: '9.00' },
      net: { igst: '180.00', cgst: '909.00', sgst: '909.00' },
      ineligible: { cgst: '45.00', sgst: '45.00' },
    });
    // IGST credit is used up first (against CGST and SGST, as there is no IGST to pay); CGST and SGST credit then carry forward.
    expect(r.setOff.steps).toEqual([
      { credit: 'igst', against: 'cgst', amount: '52.50' },
      { credit: 'igst', against: 'sgst', amount: '52.50' },
    ]);
    expect(r.setOff.cash).toMatchObject({ igst: '0.00', cgst: '0.00', sgst: '0.00' });
    expect(r.netPayable).toMatchObject({ igst: '0.00', cgst: '900.00', sgst: '900.00', total: '1800.00' });
    expect(r.totalPayable).toBe('1800.00');
    expect(r.creditCarriedForward).toMatchObject({ igst: '75.00', cgst: '909.00', sgst: '909.00' });
    for (const h of ['igst', 'cgst', 'sgst']) expect(new Decimal(r.creditCarriedForward[h]).gte(0)).toBe(true);

    // The owner dashboard tile shows the same payable position.
    const p = (await owner.get('/reports/gst/payable').expect(200)).body;
    expect(p).toMatchObject({ payable: '1800.00', creditCarriedForward: '1893.00' });
    const dash = (await owner.get('/dashboards/owner').expect(200)).body;
    expect(dash.tiles.find((t: { key: string }) => t.key === 'gst_payable')).toMatchObject({ value: '1800.00', format: 'money' });
  });

  it('the GST return figures need the right: an accountant sees them, a cashier does not', async () => {
    const accountant = await staff('Meena', 'meena@rademics.test', 'accountant');
    await accountant.get(`/reports/gst/gstr1${q()}`).expect(200);
    const cashier = await staff('Arun', 'arun@rademics.test', 'cashier');
    await cashier.get(`/reports/gst/gstr1${q()}`).expect(403);
    await cashier.get(`/reports/gst/gstr1/json${q()}`).expect(403);
    await cashier.get(`/reports/gst/gstr3b${q()}`).expect(403);
  });
});

describe('G10 goods sent to a store under another GSTIN are reported as B2B invoices of the sender', () => {
  const BLR_GSTIN = withCheck('29AAACR1234A1Z');
  let mainReg: string;
  let blrReg: string;

  beforeAll(async () => {
    await freshCompany();
    mainReg = (await prisma.gstRegistration.findFirstOrThrow({ where: { gstin: MAIN_GSTIN } })).id;
    blrReg = (await owner.post('/company/gst-registrations').send({ gstin: BLR_GSTIN, city: 'Bengaluru' }).expect(201)).body.id;
    await owner.post('/stores').send({ code: 'BLR', name: 'Bengaluru', gstRegistrationId: blrReg }).expect(201);
    const BLR = await storeId(prisma, 'BLR');
    const shirt = await item('Formal Shirt', '62052000', '1050');
    // 10 shirts at a cost of ₹10 each: ₹100 taxable, IGST 5% ₹5.
    const draft = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: BLR, lines: [{ itemId: shirt.id, quantity: '10' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${draft.id}/finalise`).expect(200);
  });

  it('GSTR-1 of the sending GSTIN lists the transfer, and GSTR-3B agrees with the accounts on both sides', async () => {
    const g = (await owner.get(`/reports/gst/gstr1?period=${period()}&gstRegistrationId=${mainReg}`).expect(200)).body;
    expect(g.b2b).toMatchObject([{ buyerGstin: BLR_GSTIN, placeOfSupply: '29', value: '105.00', items: [{ rate: '5.00', taxable: '100.00', igst: '5.00' }] }]);
    expect(g.reconciliation).toMatchObject({ sectionsAgree: true, hsnAgrees: true, documentsAgree: true });
    expect(g.documents).toMatchObject([{ nature: 1, total: 1, net: 1 }]);
    const reg = (await owner.get(`/reports/gst/sales-register?period=${period()}&gstRegistrationId=${mainReg}`).expect(200)).body;
    expect(reg.rows).toMatchObject([{ source: 'transfer', invoiceKind: 'business', buyerGstin: BLR_GSTIN, igst: '5.00' }]);
    const sender = (await owner.get(`/reports/gst/gstr3b?period=${period()}&gstRegistrationId=${mainReg}`).expect(200)).body;
    expect(sender.outputTaxFromAccounts).toEqual(sender.outputTaxFromBills);
    expect(sender.netPayable).toMatchObject({ igst: '5.00', total: '5.00' });
    const receiver = (await owner.get(`/reports/gst/gstr3b?period=${period()}&gstRegistrationId=${blrReg}`).expect(200)).body;
    expect(receiver.credit.net).toMatchObject({ igst: '5.00' });
    expect(receiver.creditCarriedForward).toMatchObject({ igst: '5.00', total: '5.00' });
    expect((await owner.get(`/reports/gst/gstr1?period=${period()}&gstRegistrationId=${blrReg}`).expect(200)).body.b2b).toEqual([]);
  });
});
