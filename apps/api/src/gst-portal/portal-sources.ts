// Copyright (c) 2026, Rademics. All rights reserved.
// Reads our documents (till bills and stock transfers) into the plain shapes the
// e-invoice and e-way bill files are built from (packages/shared/src/gst-portal.ts).
// Nothing here writes; the services decide what to do with the result.
import { NotFoundException } from '@nestjs/common';
import { Decimal, type EInvoiceSource, type EWaySource, eWayValue, INDIAN_STATES, pickGstRate, uqcFor } from 'shared';
import type { Db } from '../audit/audit.service.js';
import type { TransferGstService } from '../inventory/transfer-gst.service.js';

const D = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : '0');
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** The town of a free-text address: its last part without the PIN code ("12 MG Road, Bengaluru 560001" → "Bengaluru"). */
const townIn = (text: string | null | undefined) => {
  const last = (text ?? '').split(/[,\n]/).map((p) => p.replace(/[1-9][0-9]{5}/, '').replace(/[-–]\s*$/, '').trim()).filter((p) => p.length >= 3).pop();
  return last ?? null;
};

/** A PIN code written inside a free-text address. */
const pinIn = (text: string | null | undefined) => /(?:^|\D)([1-9][0-9]{5})(?:\D|$)/.exec(text ?? '')?.[1] ?? null;

export interface PartyPlace {
  gstin: string | null;
  name: string;
  addr1: string;
  addr2: string | null;
  place: string;
  pincode: string | null;
  stateCode: string;
}

/** The registration a store reports under, with its address (registration first, then store, then company). */
export async function sellerOf(db: Db, storeId: string, registrationId?: string | null): Promise<PartyPlace & { registrationId: string | null; legalName: string; tradeName: string | null; phone: string | null; email: string | null }> {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, include: { gstRegistration: true, company: true } });
  const reg =
    (registrationId ? await db.gstRegistration.findUnique({ where: { id: registrationId } }) : null) ??
    store.gstRegistration ??
    (await db.gstRegistration.findFirst({ where: { companyId: store.companyId, active: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
  const c = store.company;
  const src = reg?.addressLine1 ? reg : store.addressLine1 ? store : c;
  return {
    registrationId: reg?.id ?? null,
    gstin: reg?.gstin ?? null,
    name: c.tradeName ?? c.legalName,
    legalName: reg?.legalNameOnCertificate ?? c.legalName,
    tradeName: c.tradeName,
    addr1: src.addressLine1 ?? '',
    addr2: src.addressLine2 ?? null,
    place: src.city ?? store.city ?? c.city ?? '',
    pincode: src.pincode ?? store.pincode ?? c.pincode ?? null,
    stateCode: reg?.stateCode ?? store.stateCode ?? c.stateCode,
    phone: (store.phone ?? c.phone ?? '').replace(/\D/g, '') || null,
    email: store.email ?? c.email ?? null,
  };
}

/** A store as the place goods leave from or arrive at. */
async function storePlace(db: Db, storeId: string): Promise<PartyPlace> {
  const s = await sellerOf(db, storeId);
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  return { ...s, name: `${s.name} ${store.name}`.trim(), addr1: store.addressLine1 ?? s.addr1, addr2: store.addressLine2 ?? s.addr2, place: store.city ?? s.place, pincode: store.pincode ?? s.pincode };
}

export type LoadedBill = NonNullable<Awaited<ReturnType<typeof loadBill>>>;

export async function loadBill(db: Db, billId: string) {
  return db.posBill.findUnique({
    where: { id: billId },
    include: { lines: { include: { item: true }, orderBy: { lineNo: 'asc' } }, till: true, returnOf: true },
  });
}

/** Services (SAC codes) per HSN code, and our unit codes. */
async function lineFacts(db: Db, bill: LoadedBill) {
  const hsns = [...new Set(bill.lines.map((l) => l.hsnCode ?? l.item.hsnCode).filter((x): x is string => !!x))];
  const services = new Set((await db.hsnCode.findMany({ where: { code: { in: hsns }, isService: true }, select: { code: true } })).map((h) => h.code));
  const units = new Map((await db.unit.findMany({ where: { id: { in: [...new Set(bill.lines.map((l) => l.unitId))] } }, select: { id: true, code: true } })).map((u) => [u.id, u.code]));
  const isService = (hsn: string | null) => !!hsn && (services.has(hsn) || hsn.startsWith('99'));
  return { isService, unitCode: (id: string) => units.get(id) ?? null };
}

/** The buyer of a business invoice (or of the invoice a credit note returns against). */
async function buyerOf(db: Db, bill: LoadedBill) {
  const src = bill.invoiceKind === 'business' || !bill.returnOf ? bill : bill.returnOf;
  const customer = await db.customer.findUnique({ where: { id: bill.customerId } });
  const gstin = src.buyerGstin ?? customer?.gstin ?? null;
  const addresses = await db.address.findMany({ where: { partyType: 'customer', partyId: bill.customerId, active: true }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
  const a = addresses.find((x) => gstin && x.gstin === gstin) ?? addresses.find((x) => x.isBilling) ?? addresses[0] ?? null;
  const stateCode = src.buyerStateCode ?? a?.stateCode ?? gstin?.slice(0, 2) ?? '';
  return {
    gstin,
    name: src.buyerName ?? customer?.name ?? '',
    addr1: a?.addressLine1 ?? src.buyerAddress ?? '',
    addr2: a ? (a.addressLine2 ?? null) : null,
    place: a?.city ?? townIn(src.buyerAddress) ?? INDIAN_STATES[stateCode] ?? '',
    pincode: a?.pincode ?? pinIn(src.buyerAddress),
    stateCode,
    placeOfSupply: src.placeOfSupply ?? stateCode,
    phone: (customer?.mobile ?? a?.phone ?? '').replace(/\D/g, '') || null,
    email: customer?.email ?? a?.email ?? null,
  };
}

/** The e-invoice source of a business invoice (sale → INV) or its credit note (return → CRN). */
export async function eInvoiceSourceOf(db: Db, billId: string): Promise<{ bill: LoadedBill; source: EInvoiceSource }> {
  const bill = await loadBill(db, billId);
  if (!bill) throw new NotFoundException('Bill not found');
  const seller = await sellerOf(db, bill.till.storeId, bill.gstRegistrationId);
  const buyer = await buyerOf(db, bill);
  const facts = await lineFacts(db, bill);
  const source: EInvoiceSource = {
    typ: bill.kind === 'return' ? 'CRN' : 'INV',
    number: bill.number,
    date: isoDay(bill.businessDate)!,
    seller: { ...seller, gstin: seller.gstin ?? '' },
    buyer: { ...buyer, gstin: buyer.gstin ?? '', legalName: buyer.name },
    lines: bill.lines.map((l) => {
      const hsn = (l.hsnCode ?? l.item.hsnCode ?? '').replace(/\D/g, '');
      return {
        description: l.item.name,
        isService: facts.isService(hsn),
        hsn,
        barcode: l.barcode,
        quantity: l.quantity.toString(),
        unit: uqcFor(facts.unitCode(l.unitId)),
        taxable: l.taxableAmount.toString(),
        gstRate: l.gstRate.toString(),
        igst: l.igst.toString(),
        cgst: l.cgst.toString(),
        sgst: l.sgst.toString(),
      };
    }),
    roundOff: bill.roundingAdjustment.toString(),
    total: bill.total.toString(),
    original: bill.returnOf ? { number: bill.returnOf.number, date: isoDay(bill.returnOf.businessDate)! } : null,
  };
  return { bill, source };
}

export interface EWayDocument {
  documentType: 'pos_bill' | 'stock_document';
  documentId: string;
  number: string;
  date: string;
  storeId: string;
  /** Value for the limit: with tax, without exempt goods and freight. */
  value: Decimal;
  lineCount: number;
  goodsLineCount: number;
  interState: boolean;
  fromState: string;
  toState: string;
  /** Everything but distance and transport, which come from the e-way bill. */
  source: Omit<EWaySource, 'distanceKm' | 'transporterId' | 'transporterName' | 'vehicleNo'>;
  cancelled: boolean;
}

/** A till bill as goods leaving the shop (home delivery or a business invoice). */
export async function eWayFromBill(db: Db, billId: string): Promise<EWayDocument> {
  const bill = await loadBill(db, billId);
  if (!bill) throw new NotFoundException('Bill not found');
  const seller = await sellerOf(db, bill.till.storeId, bill.gstRegistrationId);
  const facts = await lineFacts(db, bill);
  const settings = await db.posSettings.findUnique({ where: { companyId: bill.companyId } });
  const delivery = await db.posDelivery.findUnique({ where: { billId: bill.id } });
  const customer = await db.customer.findUnique({ where: { id: bill.customerId } });
  const addresses = await db.address.findMany({ where: { partyType: 'customer', partyId: bill.customerId, active: true }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
  const a = addresses.find((x) => x.isDelivery) ?? addresses[0] ?? null;
  const toState = bill.placeOfSupply ?? bill.buyerStateCode ?? a?.stateCode ?? seller.stateCode;
  const date = isoDay(bill.businessDate)!;
  const rates = await db.gstRate.findMany({ where: { hsnCode: { in: [...new Set(bill.lines.flatMap((l) => { const h = l.hsnCode ?? l.item.hsnCode ?? ''; return [h.slice(0, 8), h.slice(0, 6), h.slice(0, 4)]; }))] } } });
  const rateRows = rates.map((r) => ({ ...r, rate: r.rate.toString(), cessRate: r.cessRate.toString(), priceFrom: r.priceFrom?.toString() ?? null, priceUpTo: r.priceUpTo?.toString() ?? null, effectiveFrom: isoDay(r.effectiveFrom)! }));
  const freightItem = settings?.deliveryItemId ?? null;
  const goods = bill.lines.filter((l) => l.itemId !== freightItem && !facts.isService((l.hsnCode ?? l.item.hsnCode ?? '').replace(/\D/g, '')));
  const interState = toState !== seller.stateCode;
  const value = eWayValue(
    bill.lines.map((l) => {
      const hsn = l.hsnCode ?? l.item.hsnCode;
      const rate = pickGstRate(rateRows, hsn, date);
      return { total: D(l.lineTotal).abs().toString(), freight: l.itemId === freightItem || facts.isService((hsn ?? '').replace(/\D/g, '')), exempt: rate?.kind === 'exempt' };
    }),
  );
  const sum = (pick: (l: (typeof goods)[number]) => { toString(): string }) => goods.reduce((s, l) => s.add(D(pick(l)).abs()), new Decimal(0));
  const half = (r: { toString(): string }) => D(r).div(2).toString();
  return {
    documentType: 'pos_bill',
    documentId: bill.id,
    number: bill.number,
    date,
    storeId: bill.till.storeId,
    value,
    lineCount: bill.lines.length,
    goodsLineCount: goods.length,
    interState,
    fromState: seller.stateCode,
    toState,
    cancelled: bill.status === 'cancelled',
    source: {
      userGstin: seller.gstin ?? '',
      subSupplyType: 1,
      docType: bill.invoiceKind === 'bill_of_supply' ? 'BIL' : 'INV',
      number: bill.number,
      date,
      from: { ...seller, gstin: seller.gstin ?? '', name: seller.legalName },
      to: {
        gstin: bill.buyerGstin ?? 'URP',
        name: bill.buyerName ?? delivery?.name ?? customer?.name ?? '',
        addr1: delivery?.address ?? a?.addressLine1 ?? bill.buyerAddress ?? '',
        addr2: delivery ? null : (a?.addressLine2 ?? null),
        place: a?.city ?? '',
        pincode: pinIn(delivery?.address) ?? a?.pincode ?? pinIn(bill.buyerAddress),
        stateCode: toState,
      },
      lines: goods.map((l) => ({
        name: l.item.name,
        hsn: l.hsnCode ?? l.item.hsnCode ?? '',
        quantity: l.quantity.toString(),
        unit: uqcFor(facts.unitCode(l.unitId)),
        taxable: l.taxableAmount.toString(),
        igstRate: interState ? l.gstRate.toString() : '0',
        cgstRate: interState ? '0' : half(l.gstRate),
        sgstRate: interState ? '0' : half(l.gstRate),
      })),
      totals: { taxable: sum((l) => l.taxableAmount), cgst: sum((l) => l.cgst), sgst: sum((l) => l.sgst), igst: sum((l) => l.igst), total: sum((l) => l.lineTotal) },
    },
  };
}

/**
 * A transfer between stores (blueprint 13: transfers above the limit need an e-way bill).
 * Under one GSTIN it travels on a delivery challan at stock value, no tax ("for own use"
 * in the official sub-supply codes). Between GSTINs it is a supply on a tax invoice
 * (plan 08 G10, TransferGstService) and the e-way bill carries that invoice's tax.
 */
export async function eWayFromTransfer(db: Db, documentId: string, transferGst?: TransferGstService): Promise<EWayDocument> {
  const d = await db.stockDocument.findUnique({ where: { id: documentId }, include: { lines: { include: { item: true }, orderBy: { lineNo: 'asc' } } } });
  if (!d || d.kind !== 'transfer_send' || !d.toStoreId) throw new NotFoundException('Transfer not found');
  const from = await storePlace(db, d.storeId);
  const to = await storePlace(db, d.toStoreId);
  const tax = transferGst ? await transferGst.forPrint(db, d) : null;
  const invoiced = !!tax?.taxed;
  const byLine = new Map((tax?.lines ?? []).map((t) => [t.lineId, t]));
  const units = new Map((await db.unit.findMany({ where: { id: { in: [...new Set(d.lines.map((l) => l.unitId))] } }, select: { id: true, code: true } })).map((u) => [u.id, u.code]));
  const hsns = [...new Set(d.lines.map((l) => l.item.hsnCode).filter((x): x is string => !!x))];
  const services = new Set((await db.hsnCode.findMany({ where: { code: { in: hsns }, isService: true }, select: { code: true } })).map((h) => h.code));
  const goods = d.lines.filter((l) => !l.item.hsnCode || !services.has(l.item.hsnCode));
  const interState = from.stateCode !== to.stateCode;
  const lineOf = (l: (typeof goods)[number]) => {
    const t = byLine.get(l.id);
    const taxable = t?.taxable ?? D(l.valueChange).abs();
    const taxes = invoiced && t ? t.cgst.add(t.sgst).add(t.igst) : new Decimal(0);
    return { t, taxable, total: taxable.add(taxes) };
  };
  const value = eWayValue(goods.map((l) => ({ total: lineOf(l).total.toString() })));
  const sumTax = (k: 'cgst' | 'sgst' | 'igst') => (invoiced ? goods.reduce((s, l) => s.add(byLine.get(l.id)?.[k] ?? 0), new Decimal(0)) : new Decimal(0));
  const date = isoDay(d.postingDate)!;
  return {
    documentType: 'stock_document',
    documentId: d.id,
    number: d.number,
    date,
    storeId: d.storeId,
    value,
    lineCount: d.lines.length,
    goodsLineCount: goods.length,
    interState,
    fromState: from.stateCode,
    toState: to.stateCode,
    cancelled: d.status === 'cancelled',
    source: {
      userGstin: from.gstin ?? '',
      // Master codes: 1 = supply (to a registration under another GSTIN), 5 = for own use (same GSTIN).
      subSupplyType: tax ? 1 : 5,
      docType: invoiced ? 'INV' : tax ? 'BIL' : 'CHL',
      number: d.number,
      date,
      from: { ...from, gstin: from.gstin ?? '' },
      to: { ...to, gstin: to.gstin ?? from.gstin ?? '' },
      lines: goods.map((l) => {
        const { t, taxable } = lineOf(l);
        const rate = invoiced && t ? t.gstRate : new Decimal(0);
        return {
          name: l.item.name,
          hsn: l.item.hsnCode ?? '',
          quantity: l.quantity.toString(),
          unit: uqcFor(units.get(l.unitId)),
          taxable: taxable.toFixed(2),
          igstRate: interState ? rate.toString() : '0',
          cgstRate: interState ? '0' : rate.div(2).toString(),
          sgstRate: interState ? '0' : rate.div(2).toString(),
        };
      }),
      totals: { taxable: goods.reduce((s, l) => s.add(lineOf(l).taxable), new Decimal(0)).toFixed(2), cgst: sumTax('cgst').toFixed(2), sgst: sumTax('sgst').toFixed(2), igst: sumTax('igst').toFixed(2), total: value.toFixed(2) },
    },
  };
}

export async function eWayDocumentOf(db: Db, documentType: string, documentId: string, transferGst?: TransferGstService): Promise<EWayDocument> {
  return documentType === 'pos_bill' ? eWayFromBill(db, documentId) : eWayFromTransfer(db, documentId, transferGst);
}

