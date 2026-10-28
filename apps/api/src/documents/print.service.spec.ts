// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 4 (28 October 2026): what the A4 GST documents must carry under the CGST
// Rules: rule 46 (values, tax, reverse charge, SEZ endorsement), rule 48(1)
// copies, rule 5(1)(f) composition declaration at the top, rule 53(1A) credit
// note details, rule 55 delivery challan (consignor and consignee, value).
import { describe, expect, it } from 'vitest';
import { BILL_OF_SUPPLY_DECLARATION, type CurrentUser, Decimal } from 'shared';
import { consignorLine, posBillGst, type PrintDocument, PrintService, RETURN_NOTE_LINE, RULE_48_COPIES, SEZ_UNDER_LUT, SEZ_WITH_IGST } from './print.service.js';

const D = (v: string) => new Decimal(v);
const MAIN = '10000000-0000-4000-8000-000000000001';
const BLR = '10000000-0000-4000-8000-000000000002';
const store = (id: string, code: string, name: string, stateCode: string, gstin: string) => ({ id, code, name, addressLine1: `1 ${name} Road`, addressLine2: null, city: name, pincode: '600001', stateCode, phone: null, email: null, gstRegistration: { id: `reg-${code}`, gstin, stateCode } });
const STORES = [store(MAIN, 'MAIN', 'Chennai', '33', '33AAAAA0000A1Z9'), store(BLR, 'BLR', 'Bengaluru', '29', '29AAAAA0000A1Z3')];

/** A user who may see stock but not its cost. */
const clerk = { id: 'u1', firstName: 'A', lastName: null, email: 'a@x', isOwnerAdmin: false, permissions: ['stock.view'], allStores: true, stores: [], mustChangePassword: false, roles: [] } as unknown as CurrentUser;

function service(o: { tax: unknown; posBill?: Record<string, unknown>; customer?: Record<string, unknown> | null; original?: Record<string, unknown> | null }) {
  const doc = { id: 'd1', companyId: 'c1', kind: 'transfer_send', number: 'TR-1', postingDate: new Date('2026-10-18'), status: 'finalised', storeId: MAIN, toStoreId: BLR, fromLocationId: null, toLocationId: null, remarks: null, lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', unitId: 'kg', quantity: D('2.5'), valueChange: D('-500'), serialNumbers: [], batch: null, newBatchNumber: null, item: { name: 'Rice', code: 'RICE', hsnCode: '10063020' } }] };
  const prisma = {
    stockDocument: { findUnique: async () => doc },
    unit: { findMany: async () => [{ id: 'kg', code: 'KG' }, { id: 'pcs', code: 'PCS' }] },
    stockLocation: { findMany: async () => [] },
    store: { findMany: async () => STORES, findUnique: async () => STORES[0] },
    gstSettings: { findUnique: async () => ({ hsnDigits: 4 }) },
    gstRegistration: { findFirst: async () => STORES[0].gstRegistration, findUnique: async () => STORES[0].gstRegistration },
    printSettings: { findUnique: async () => null },
    standardTerms: { findMany: async () => [] },
    posBill: { findUnique: async (q: { where: { id: string } }) => (q.where.id === 'orig' ? o.original : o.posBill) },
    posDelivery: { findUnique: async () => null },
    customer: { findUnique: async () => o.customer ?? null },
    address: { findFirst: async () => null },
  };
  const company = { current: async () => ({ id: 'c1', legalName: 'Rademics Retail', tradeName: null, addressLine1: null, addressLine2: null, city: null, pincode: null, phone: null, email: null, logo: null }) };
  const transferGst = { forPrint: async () => o.tax };
  const eInvoices = { printBlock: async (id: string, type?: string) => (type === 'stock_document' ? { details: [['IRN', `irn-${id}`]], notice: null, qr: { path: 'M0 0', size: 21, label: 'e-invoice QR' } } : { details: [], notice: null, qr: null }) };
  const eWayBills = { printDetails: async () => [] };
  const svc = new PrintService(prisma as never, {} as never, company as never, {} as never, {} as never, {} as never, transferGst as never, eInvoices as never, eWayBills as never);
  // The two builders under test are private; reached directly so no audit or HTTP is needed.
  return svc as unknown as { stockDocument: (kind: 'transfer', id: string, user: CurrentUser) => Promise<PrintDocument>; posBill: (id: string, user: CurrentUser) => Promise<PrintDocument> };
}

const taxLine = { lineId: 'l1', hsnCode: '10063020', gstRate: D('5'), unitValue: D('200'), taxable: D('500'), cgst: D('0'), sgst: D('0'), igst: D('25') };
const TAXED = { taxed: true, placeOfSupply: '29', lines: [taxLine], totals: { taxable: D('500'), cgst: D('0'), sgst: D('0'), igst: D('25'), total: D('525') } };

describe('audit 4: transfer documents (rules 46, 48, 55, 5(1)(f))', () => {
  it('a transfer tax invoice shows values and tax to a reader without stock.cost.view, in three copies', async () => {
    const doc = await service({ tax: TAXED }).stockDocument('transfer', 'd1', clerk);
    expect(doc.title).toBe('Tax invoice (stock transfer)');
    expect(doc.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['value', 'gst']));
    expect(doc.lines[0]).toMatchObject({ quantity: '2.5 KG', value: '500.00', gst: 'IGST 5% · 25.00' });
    expect(doc.totals).toEqual(expect.arrayContaining([['Taxable value', '500.00'], ['IGST', '25.00'], ['Total', '525.00']]));
    expect(doc.copies).toEqual(RULE_48_COPIES);
    // The transfer's own e-invoice: IRN in the details and its QR.
    expect(doc.details).toEqual(expect.arrayContaining([['IRN', 'irn-d1']]));
    expect(doc.qr).toMatchObject({ label: 'e-invoice QR' });
  });

  it('consignor and consignee carry name, full address and GSTIN (rule 55(1)(ii),(iii))', async () => {
    const doc = await service({ tax: TAXED }).stockDocument('transfer', 'd1', clerk);
    expect(doc.details).toEqual(
      expect.arrayContaining([
        ['Consignor', 'MAIN — Chennai · 1 Chennai Road, Chennai 600001, Tamil Nadu (33) · GSTIN 33AAAAA0000A1Z9'],
        ['Consignee', 'BLR — Bengaluru · 1 Bengaluru Road, Bengaluru 600001, Karnataka (29) · GSTIN 29AAAAA0000A1Z3'],
      ]),
    );
  });

  it('a delivery challan shows the value to every reader (rule 55(1)(vi)), with no copies of a tax invoice', async () => {
    const doc = await service({ tax: null }).stockDocument('transfer', 'd1', clerk);
    expect(doc.title).toBe('Delivery challan');
    expect(doc.lines[0]).toMatchObject({ value: '500.00' });
    expect(doc.totals).toEqual(expect.arrayContaining([['Value', '500.00']]));
    expect(doc.copies ?? null).toBeNull();
    expect(doc.notice ?? null).toBeNull();
    expect(doc.qr ?? null).toBeNull();
  });

  it("a composition company's bill of supply carries the rule 5(1)(f) declaration at the top", async () => {
    const doc = await service({ tax: { ...TAXED, taxed: false, lines: [{ ...taxLine, igst: D('0'), gstRate: D('0') }] } }).stockDocument('transfer', 'd1', clerk);
    expect(doc.title).toBe('Bill of supply (stock transfer)');
    expect(doc.notice).toBe(BILL_OF_SUPPLY_DECLARATION);
    expect(doc.lines[0]).toMatchObject({ value: '500.00' });
  });
});

describe('audit 4: what an A4 till bill prints about GST', () => {
  const base = { billKind: 'sale', invoiceKind: 'consumer', title: 'Tax invoice', situation: null, taxCharged: true, declaration: BILL_OF_SUPPLY_DECLARATION };
  it('reverse charge follows the buyer situation (rule 46(p))', () => {
    expect(posBillGst(base).reverseCharge).toBe('No');
    expect(posBillGst({ ...base, invoiceKind: 'business', situation: 'reverse_charge' }).reverseCharge).toBe('Yes');
  });
  it('an SEZ supply carries the rule 46 third-proviso endorsement', () => {
    expect(posBillGst({ ...base, invoiceKind: 'business', situation: 'sez' }).notice).toBe(SEZ_WITH_IGST);
    expect(posBillGst({ ...base, invoiceKind: 'business', situation: 'sez', taxCharged: false }).notice).toBe(SEZ_UNDER_LUT);
    expect(posBillGst({ ...base, billKind: 'return', title: 'Credit note', situation: 'sez' }).notice).toBeNull();
  });
  it('a bill of supply has the declaration at the top and no copies; a goods tax invoice comes in three copies', () => {
    expect(posBillGst({ ...base, invoiceKind: 'bill_of_supply', title: 'Bill of supply' })).toMatchObject({ notice: BILL_OF_SUPPLY_DECLARATION, copies: null, taxed: false });
    expect(posBillGst(base).copies).toEqual(['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER']);
    expect(posBillGst({ ...base, title: 'Invoice-cum-bill of supply' }).copies).toEqual(RULE_48_COPIES);
    expect(posBillGst({ ...base, billKind: 'return', title: 'Credit note' }).copies).toBeNull();
  });
  it('a return note carries no GST and says so', () => {
    expect(posBillGst({ ...base, billKind: 'return', title: 'Return note' })).toMatchObject({ returnNote: true, taxed: false, notice: RETURN_NOTE_LINE });
  });
  it('a consignor line without a store still shows the GSTIN', () => {
    expect(consignorLine(null, '33AAAAA0000A1Z9')).toBe('GSTIN 33AAAAA0000A1Z9');
  });
});

describe('audit 4: the A4 till bill', () => {
  const line = { lineNo: 1, unitId: 'kg', quantity: D('-2.5'), price: D('420'), discountAmount: D('0'), taxableAmount: D('-1000'), gstRate: D('5'), cgst: D('-25'), sgst: D('-25'), igst: D('0'), isFree: false, hsnCode: '1006', item: { code: 'RICE', name: 'Rice', hsnCode: '1006' } };
  const bill = { id: 'b1', companyId: 'c1', number: 'CN-1', kind: 'return', invoiceKind: 'consumer', documentKind: null, status: 'posted', businessDate: new Date('2026-10-18'), returnOfId: 'orig', customerId: 'walk', buyerName: null, buyerAddress: null, buyerStateCode: null, buyerGstin: null, placeOfSupply: '33', gstRegistrationId: null, checkFlags: [], gstProvisional: false, taxableAmount: D('-1000'), cgst: D('-25'), sgst: D('-25'), igst: D('0'), roundingAdjustment: D('0'), total: D('-1050'), lines: [line], till: { code: 'T1', storeId: MAIN } };
  const original = { number: 'MAIN-T1-000001', businessDate: new Date('2026-10-01'), buyerName: 'Anil Kumar', buyerAddress: '4 Lake View, Chennai', buyerStateCode: '33', buyerGstin: null };

  it("a credit note names the original invoice and date and the unregistered buyer's name, address and state (rule 53(1A)(f),(g))", async () => {
    const doc = await service({ tax: null, posBill: bill, original, customer: { id: 'walk', isWalkIn: true, name: 'Walk-in', gstin: null, taxSituation: null, mobile: null } }).posBill('b1', clerk);
    expect(doc.title).toBe('Credit note');
    expect(doc.party).toMatchObject({ name: 'Anil Kumar', address: ['4 Lake View, Chennai'] });
    expect(doc.details).toEqual(expect.arrayContaining([['Against invoice', 'MAIN-T1-000001 dated 2026-10-01'], ['Buyer’s state', 'Tamil Nadu (33)']]));
    expect(doc.lines[0].quantity).toBe('2.5 KG');
    expect(doc.copies).toBeNull();
  });

  it('a return note prints under its own title with no GST', async () => {
    const doc = await service({ tax: null, posBill: { ...bill, documentKind: 'return_note' }, original, customer: null }).posBill('b1', clerk);
    expect(doc.title).toBe('Return note');
    expect(doc.notice).toBe(RETURN_NOTE_LINE);
    expect(doc.columns.map((c) => c.key)).not.toContain('cgst');
    expect(doc.totals.map(([k]) => k)).not.toContain('CGST');
    expect(doc.details.map(([k]) => k)).not.toContain('Reverse charge');
  });

  it('a reverse-charge buyer gets "Reverse charge: Yes"; a bill of supply has its declaration at the top, not in the details', async () => {
    const customer = { id: 'c9', isWalkIn: false, name: 'Kaveri', gstin: '29AABCK1234A1Z5', taxSituation: 'reverse_charge', mobile: null };
    const sale = { ...bill, kind: 'sale', invoiceKind: 'business', returnOfId: null, customerId: 'c9', buyerGstin: '29AABCK1234A1Z5', buyerName: 'Kaveri', quantity: D('1') };
    const doc = await service({ tax: null, posBill: sale, customer }).posBill('b1', clerk);
    expect(doc.details).toEqual(expect.arrayContaining([['Reverse charge', 'Yes']]));
    expect(doc.copies).toEqual(RULE_48_COPIES);
    const bos = await service({ tax: null, posBill: { ...sale, invoiceKind: 'bill_of_supply', cgst: D('0'), sgst: D('0') }, customer: { ...customer, taxSituation: null } }).posBill('b1', clerk);
    expect(bos.notice).toBe(BILL_OF_SUPPLY_DECLARATION);
    expect(bos.details.map(([k]) => k)).not.toContain('Declaration');
  });
});
