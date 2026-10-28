// Copyright (c) 2026, Rademics. All rights reserved.
// Printed documents (plan 10 §1.A; blueprint 16 "What each document shows").
// Each document comes back in one simple shape (letterhead, party, details,
// lines, totals, amount in words, terms) that the web prints with one layout
// through the browser's Print / Save as PDF. Drafts are marked DRAFT and
// cancelled documents CANCELLED; every print is recorded in the history.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { amountInWords, BILL_OF_SUPPLY_DECLARATION, businessDate, type CurrentUser, Decimal, gstDocumentTitle, hasPermission, hsnForPrint, INDIAN_STATES, type PermissionKey, type PrintKind, type PrintSettingsInput, type StandardTermsInput, taxSituationOf } from 'shared';
import { LedgerReportsService } from '../accounting/ledger-reports.service.js';
import { AlterationsService } from '../orders/alterations.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { AuditService } from '../audit/audit.service.js';
import { canAccessStore } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { TransferGstService } from '../inventory/transfer-gst.service.js';
import { EInvoicesService, type PrintQr } from '../gst-portal/einvoices.service.js';
import { EWayBillsService } from '../gst-portal/eway-bills.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { imageTypeOf } from '../common/image-type.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Amount = { toString(): string } | null | undefined;
const D = (v: Amount) => new Decimal(v ? v.toString() : '0');
const money = (v: Amount) => D(v).toFixed(2);
const qty = (v: Amount) => D(v).toDecimalPlaces(3).toString();
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export interface PrintColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface PrintDocument {
  kind: PrintKind;
  title: string;
  number: string | null;
  date: string | null;
  mark: 'DRAFT' | 'CANCELLED' | null;
  paper: 'A4' | 'A5';
  letterhead: { name: string; legalName: string; storeName: string | null; address: string[]; gstin: string | null; phone: string | null; email: string | null; showLogo: boolean };
  party: { label: string; name: string; code: string | null; address: string[]; gstin: string | null; phone: string | null } | null;
  details: [string, string][];
  columns: PrintColumn[];
  lines: Record<string, string>[];
  totals: [string, string][];
  amountInWords: string | null;
  terms: string[];
  signatures: string[];
  printedAt: string;
  /** Plan 08 §4: a warning across the top, e.g. an e-invoice not yet registered. */
  notice?: string | null;
  /** Plan 08 §4: the e-invoice's signed QR code. */
  qr?: PrintQr | null;
  /**
   * Audit 4 (28 October 2026), CGST Rules rule 48(1): a goods tax invoice is made in
   * triplicate; the screen prints the page set once per entry, with the marking at the top.
   */
  copies?: string[] | null;
}

/** CGST Rules rule 48(1): the three copies of a tax invoice for goods. */
export const RULE_48_COPIES = ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER'];
export { RETURN_NOTE_LINE, SEZ_UNDER_LUT, SEZ_WITH_IGST } from 'shared';
import { RETURN_NOTE_LINE, SEZ_UNDER_LUT, SEZ_WITH_IGST } from 'shared';

/**
 * Audit 4 (28 October 2026): what an A4 till bill prints about GST beyond its lines.
 * - A bill of supply carries the composition declaration at the top (CGST Rules rule 5(1)(f)).
 * - A tax invoice to an SEZ carries the rule 46 third-proviso endorsement: "on payment of
 *   integrated tax" when tax is charged, "under bond or LUT" when none is.
 * - A return note carries no GST and says so.
 * - Reverse charge (rule 46(p)) is Yes when the buyer's situation is reverse_charge.
 * - A goods tax invoice comes in the three rule 48(1) copies.
 */
export function posBillGst(i: { billKind: string; invoiceKind: string; title: string; situation: string | null; taxCharged: boolean; declaration: string; eInvoiceNotice?: string | null }) {
  const returnNote = i.title.trim().toLowerCase() === 'return note';
  const taxed = !returnNote && i.invoiceKind !== 'bill_of_supply';
  const taxInvoice = taxed && i.billKind === 'sale';
  const notes = [
    i.invoiceKind === 'bill_of_supply' && !returnNote ? i.declaration : null,
    taxInvoice && i.situation === 'sez' ? (i.taxCharged ? SEZ_WITH_IGST : SEZ_UNDER_LUT) : null,
    returnNote ? RETURN_NOTE_LINE : null,
    i.eInvoiceNotice ?? null,
  ].filter((x): x is string => !!x);
  return {
    returnNote,
    taxed,
    notice: notes.length ? notes.join('\n') : null,
    reverseCharge: taxed && i.situation === 'reverse_charge' ? 'Yes' : 'No',
    copies: taxInvoice ? RULE_48_COPIES : null,
  };
}

/** Audit 4 (28 October 2026), CGST Rules rule 55(1)(ii),(iii): a consignor or consignee with its name, full address and GSTIN. */
export function consignorLine(store: { code: string; name: string; addressLine1: string | null; addressLine2: string | null; city: string | null; pincode: string | null; stateCode: string | null } | null | undefined, gstin: string | null | undefined): string {
  if (!store) return gstin ? `GSTIN ${gstin}` : '';
  const state = store.stateCode ? `${INDIAN_STATES[store.stateCode] ?? store.stateCode} (${store.stateCode})` : null;
  const address = [store.addressLine1, store.addressLine2, [store.city, store.pincode].filter(Boolean).join(' '), state].filter((x): x is string => !!x && x.trim() !== '').join(', ');
  return [`${store.code} — ${store.name}`, address || null, gstin ? `GSTIN ${gstin}` : null].filter(Boolean).join(' · ');
}

const RIGHTS: Record<PrintKind, PermissionKey[]> = {
  purchase_order: ['purchase.view'],
  goods_receipt: ['purchase.view'],
  transfer: ['stock.view'],
  count_sheet: ['stock.view'],
  payment: ['accounts.view', 'payments.post', 'cash.deposit'],
  journal: ['accounts.view', 'journals.post', 'cash.deposit'],
  statement: ['accounts.view', 'payments.post'],
  // Plan 11 part 2
  customer_order: ['orders.manage'],
  alteration_job: ['alterations.manage'],
  alteration_tag: ['alterations.manage'],
  // Plan 08: a till bill printed on A4 (business tax invoice, bill of supply or credit note).
  pos_bill: ['pos.sell', 'pos.reports'],
  // Audit 4 (T14): the self-invoice for a reverse-charge purchase from an unregistered supplier.
  rcm_self_invoice: ['purchase.view'],
};

const TERMS_FOR: Record<PrintKind, 'selling' | 'buying' | null> = {
  purchase_order: 'buying',
  goods_receipt: 'buying',
  transfer: null,
  count_sheet: null,
  payment: null,
  journal: null,
  statement: 'selling',
  customer_order: 'selling',
  alteration_job: null,
  alteration_tag: null,
  pos_bill: 'selling',
  rcm_self_invoice: null,
};

@Injectable()
export class PrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly ledgerReports: LedgerReportsService,
    private readonly orders: OrdersService,
    private readonly alterations: AlterationsService,
    private readonly transferGst: TransferGstService,
    private readonly eInvoices: EInvoicesService,
    private readonly eWayBills: EWayBillsService,
  ) {}

  // ---- Settings, logo and standard terms ----

  async settings() {
    const company = await this.company.current();
    const s = await this.prisma.printSettings.findUnique({ where: { companyId: company.id } });
    return { paperSize: (s?.paperSize ?? 'A4') as 'A4' | 'A5', showLogo: s?.showLogo ?? true, storeLetterhead: s?.storeLetterhead ?? true, hasLogo: !!company.logo };
  }

  async saveSettings(input: PrintSettingsInput, actor: Actor) {
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      await tx.printSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, ...input, createdById: actor.userId, updatedById: actor.userId }, update: { ...input, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'print_settings', entityId: company.id, changes: input });
    });
    return this.settings();
  }

  async logo(): Promise<{ data: Buffer; type: string } | null> {
    const company = await this.company.current();
    return company.logo ? { data: Buffer.from(company.logo), type: company.logoMimeType ?? 'image/png' } : null;
  }

  async saveLogo(file: { buffer: Buffer; mimetype: string; size: number } | undefined, actor: Actor) {
    if (!file) throw new BadRequestException('Choose an image file');
    if (!['image/png', 'image/jpeg'].includes(file.mimetype)) throw new BadRequestException('The logo must be a PNG or JPEG image');
    if (file.size > 300_000) throw new BadRequestException('The logo must be smaller than 300 KB');
    if (imageTypeOf(file.buffer) !== file.mimetype) throw new BadRequestException('This file is not a PNG or JPEG picture');
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: { logo: new Uint8Array(file.buffer), logoMimeType: file.mimetype, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'company', entityId: company.id, changes: { logo: `${file.mimetype}, ${file.size} bytes` } });
    });
    return this.settings();
  }

  async terms() {
    const company = await this.company.current();
    const rows = await this.prisma.standardTerms.findMany({ where: { companyId: company.id }, orderBy: { title: 'asc' } });
    return rows.map((t) => ({ id: t.id, title: t.title, text: t.text, usedFor: t.usedFor, defaultFor: t.defaultFor, active: t.active }));
  }

  async saveTerms(id: string | null, input: StandardTermsInput, actor: Actor) {
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      if (id) {
        const before = await tx.standardTerms.findUnique({ where: { id } });
        if (!before || before.companyId !== company.id) throw new NotFoundException('Terms not found');
        await tx.standardTerms.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      } else {
        id = (await tx.standardTerms.create({ data: { companyId: company.id, ...input, createdById: actor.userId, updatedById: actor.userId } })).id;
      }
      await this.audit.record(tx, actor, { action: 'update', entityType: 'standard_terms', entityId: id, changes: { title: input.title, usedFor: input.usedFor } });
    });
    return this.terms();
  }

  // ---- Documents ----

  async document(kind: PrintKind, id: string, actor: Actor, user: CurrentUser): Promise<PrintDocument> {
    if (!RIGHTS[kind].some((r) => hasPermission(user, r))) throw new ForbiddenException('You are not allowed to print this');
    const doc = await this.build(kind, id, user);
    // One history entry per person and document a minute: a page opened twice in a row is one print.
    const entityId = kind === 'statement' ? null : id;
    const recent = await this.prisma.auditLog.findMany({ where: { action: 'print', entityType: kind, entityId, userId: actor.userId, at: { gt: new Date(Date.now() - 60_000) } }, select: { changes: true } });
    // A draft and the finalised document are different prints, even a minute apart.
    if (!recent.some((r) => (r.changes as { mark?: string | null } | null)?.mark === doc.mark)) await this.audit.record(this.prisma, actor, { action: 'print', entityType: kind, entityId, changes: { title: doc.title, number: doc.number, mark: doc.mark } });
    return doc;
  }

  private async build(kind: PrintKind, id: string, user: CurrentUser): Promise<PrintDocument> {
    switch (kind) {
      case 'purchase_order':
        return this.purchaseOrder(id, user);
      case 'goods_receipt':
        return this.goodsReceipt(id, user);
      case 'transfer':
      case 'count_sheet':
        return this.stockDocument(kind, id, user);
      case 'payment':
        return this.payment(id, user);
      case 'journal':
        return this.journal(id, user);
      case 'statement':
        return this.statement(id, user);
      case 'customer_order':
        return this.customerOrder(id, user);
      case 'alteration_job':
      case 'alteration_tag':
        return this.alterationJob(kind, id, user);
      case 'pos_bill':
        return this.posBill(id, user);
      case 'rcm_self_invoice':
        return this.rcmSelfInvoice(id, user);
    }
  }

  private assertStore(user: CurrentUser, storeId: string | null | undefined) {
    if (storeId && !canAccessStore(user, storeId)) throw new ForbiddenException('You are not allowed to work in this store');
  }

  private async letterhead(storeId: string | null): Promise<PrintDocument['letterhead'] & { paper: 'A4' | 'A5' }> {
    const company = await this.company.current();
    const settings = await this.settings();
    const store = storeId && settings.storeLetterhead ? await this.prisma.store.findUnique({ where: { id: storeId }, include: { gstRegistration: true } }) : null;
    const reg = store?.gstRegistration ?? (await this.prisma.gstRegistration.findFirst({ where: { companyId: company.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
    const src = store ?? company;
    const address = [src.addressLine1, src.addressLine2, [src.city, src.pincode].filter(Boolean).join(' ')].filter((x): x is string => !!x && x.trim() !== '');
    return {
      name: company.tradeName ?? company.legalName,
      legalName: company.legalName,
      storeName: store ? store.name : null,
      address,
      gstin: reg?.gstin ?? null,
      phone: src.phone ?? company.phone ?? null,
      email: src.email ?? company.email ?? null,
      showLogo: settings.showLogo && settings.hasLogo,
      paper: settings.paperSize,
    };
  }

  private async termsFor(kind: PrintKind): Promise<string[]> {
    const company = await this.company.current();
    const use = TERMS_FOR[kind];
    const rows = await this.prisma.standardTerms.findMany({ where: { companyId: company.id, active: true, defaultFor: { has: kind } } });
    return rows.filter((t) => !use || t.usedFor === 'both' || t.usedFor === use).map((t) => t.text);
  }

  private async partyBlock(type: 'customer' | 'supplier', id: string): Promise<PrintDocument['party']> {
    const party = type === 'customer' ? await this.prisma.customer.findUnique({ where: { id } }) : await this.prisma.supplier.findUnique({ where: { id } });
    if (!party) return null;
    const a = await this.prisma.address.findFirst({ where: { partyType: type, partyId: id, active: true }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
    return {
      label: type === 'customer' ? 'Customer' : 'Supplier',
      name: party.name,
      code: party.code,
      address: a ? [a.addressLine1, a.addressLine2, [a.city, a.pincode].filter(Boolean).join(' ')].filter((x): x is string => !!x && x.trim() !== '') : [],
      gstin: a?.gstin ?? party.gstin ?? null,
      phone: party.mobile ?? a?.phone ?? null,
    };
  }

  private base(kind: PrintKind, title: string, lh: Awaited<ReturnType<PrintService['letterhead']>>): Omit<PrintDocument, 'number' | 'date' | 'mark' | 'party' | 'details' | 'columns' | 'lines' | 'totals' | 'amountInWords' | 'terms' | 'signatures'> {
    const { paper, ...letterhead } = lh;
    return { kind, title, paper, letterhead, printedAt: new Date().toISOString() };
  }

  private mark(status: string): PrintDocument['mark'] {
    return status === 'draft' ? 'DRAFT' : status === 'cancelled' ? 'CANCELLED' : null;
  }

  /** Plan 11 part 2: the order slip, with the advance received. */
  private async customerOrder(id: string, user: CurrentUser): Promise<PrintDocument> {
    const o = await this.orders.get(id, user);
    const lh = await this.letterhead(o.storeId);
    const received = D(o.advanceReceived);
    const balance = D(o.total).sub(D(o.advanceHeld));
    return {
      ...this.base('customer_order', 'Customer order', lh),
      number: o.number,
      date: businessDate(o.createdAt), // Indian date of the order (launch check: UTC printed 31 March for 00:30 on 1 April)
      mark: o.status === 'cancelled' ? 'CANCELLED' : null,
      party: await this.partyBlock('customer', o.customerId),
      details: [['Expected on', o.expectedOn ?? ''], ['Status', o.status], ...(o.remarks ? [['Remarks', o.remarks] as [string, string]] : [])],
      columns: [
        { key: 'no', label: '#' },
        { key: 'item', label: 'Item' },
        { key: 'quantity', label: 'Quantity', align: 'right' },
        { key: 'price', label: 'Agreed price', align: 'right' },
        { key: 'amount', label: 'Amount', align: 'right' },
      ],
      lines: o.lines.map((l) => ({ no: String(l.lineNo), item: `${l.item.name} (${l.item.code})${l.remarks ? ` · ${l.remarks}` : ''}`, quantity: `${qty(l.quantity)} ${l.unitCode}`.trim(), price: money(l.price), amount: money(l.amount) })),
      totals: [
        ['Total (GST included)', money(o.total)],
        ['Advance received', money(received)],
        ...(D(o.advanceRefunded).gt(0) ? [['Advance refunded', money(o.advanceRefunded)] as [string, string]] : []),
        ['To pay on collection', money(Decimal.max(balance, 0))],
      ],
      amountInWords: amountInWords(o.total),
      terms: await this.termsFor('customer_order'),
      signatures: ['Customer', 'For the shop'],
    };
  }

  /** Plan 11 part 2: the alteration job slip, or the small tag that goes with the garment. */
  private async alterationJob(kind: 'alteration_job' | 'alteration_tag', id: string, user: CurrentUser): Promise<PrintDocument> {
    const j = await this.alterations.get(id, user);
    const lh = await this.letterhead(j.storeId);
    const tag = kind === 'alteration_tag';
    return {
      ...this.base(kind, tag ? 'Alteration tag' : 'Alteration job', lh),
      paper: tag ? 'A5' : lh.paper,
      number: j.number,
      date: businessDate(j.createdAt),
      mark: j.status === 'cancelled' ? 'CANCELLED' : null,
      party: { label: 'Customer', name: j.name ?? '', code: null, address: [], gstin: null, phone: j.phone },
      details: [
        ['Promised on', j.promisedOn ?? ''],
        ...(tag ? [] : [['Tailor', j.tailor ?? ''] as [string, string], ['Status', j.status.replace('_', ' ')] as [string, string]]),
        ...(j.bill?.number ? [['Bought on bill', j.bill.number] as [string, string]] : []),
        ...(!tag && j.remarks ? [['Remarks', j.remarks] as [string, string]] : []),
      ],
      columns: [
        { key: 'no', label: '#' },
        { key: 'garment', label: 'Garment' },
        { key: 'work', label: 'Work' },
      ],
      lines: j.lines.map((l) => ({ no: String(l.lineNo), garment: l.garment, work: l.work })),
      totals: tag ? [] : [['Alteration charge', money(j.charge)], ['Paid', j.chargeBill ? `on bill ${j.chargeBill.number}` : j.chargePaidWith === 'bill' ? 'with the bill' : 'on collection']],
      amountInWords: null,
      terms: tag ? [] : await this.termsFor(kind),
      signatures: tag ? [] : ['Customer', 'For the shop'],
    };
  }

  /**
   * Plan 08 (decision 43): a till bill on A4 with what the CBIC invoice rules ask
   * for: seller GSTIN, serial number and date, buyer details, HSN at the
   * configured digits, quantity and unit, taxable value, rate and tax per head,
   * place of supply, reverse charge, signature; a bill of supply carries the
   * composition declaration and no tax; a credit note names the original bill.
   * https://cbic-gst.gov.in/gst-invoice-rules.html
   */
  private async posBill(id: string, user: CurrentUser): Promise<PrintDocument> {
    const b = await this.prisma.posBill.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { code: true, name: true, hsnCode: true } } } }, till: { select: { code: true, storeId: true } } } });
    if (!b) throw new NotFoundException('Bill not found');
    this.assertStore(user, b.till.storeId);
    const lh = await this.letterhead(b.till.storeId);
    const gst = await this.prisma.gstSettings.findUnique({ where: { companyId: b.companyId } });
    const reg = b.gstRegistrationId ? await this.prisma.gstRegistration.findUnique({ where: { id: b.gstRegistrationId } }) : null;
    const original = b.returnOfId ? await this.prisma.posBill.findUnique({ where: { id: b.returnOfId }, select: { number: true, businessDate: true, buyerName: true, buyerAddress: true, buyerStateCode: true, buyerGstin: true } }) : null;
    const delivery = await this.prisma.posDelivery.findUnique({ where: { billId: b.id } });
    const customer = await this.prisma.customer.findUnique({ where: { id: b.customerId } });
    const units = await this.unitCodes(b.lines.map((l) => l.unitId));
    const title = gstDocumentTitle(b.kind, b.invoiceKind, b.documentKind);
    // Audit 4 (28 October 2026): the buyer's tax situation (the bill's GSTIN as recorded on the customer or its address).
    const buyerGstin = b.buyerGstin ?? original?.buyerGstin ?? null;
    const address = buyerGstin && customer && customer.gstin?.toUpperCase() !== buyerGstin.toUpperCase() ? await this.prisma.address.findFirst({ where: { partyType: 'customer', partyId: customer.id, gstin: buyerGstin } }) : null;
    const situation = buyerGstin && b.buyerSituation ? taxSituationOf(buyerGstin, b.buyerSituation) : buyerGstin ? taxSituationOf(buyerGstin, address ? address.taxSituation : customer?.gstin?.toUpperCase() === buyerGstin.toUpperCase() ? customer.taxSituation : null) : null;
    const igst = !D(b.igst).isZero();
    const taxCharged = igst || !D(b.cgst).isZero() || !D(b.sgst).isZero();
    const g = posBillGst({ billKind: b.kind, invoiceKind: b.invoiceKind, title, situation, taxCharged, declaration: BILL_OF_SUPPLY_DECLARATION, eInvoiceNotice: null });
    const supplyOfGoods = g.taxed;
    const state = (code: string | null) => (code ? `${INDIAN_STATES[code] ?? code} (${code})` : '');
    const digits = gst?.hsnDigits ?? 4;
    // Audit 4: a credit note names an unregistered buyer as the original bill did (CGST Rules rule 53(1A)(f)).
    const buyerName = b.buyerName ?? original?.buyerName ?? (customer && !customer.isWalkIn ? customer.name : null);
    const buyerAddress = b.buyerAddress ?? original?.buyerAddress ?? null;
    const buyerStateCode = b.buyerStateCode ?? original?.buyerStateCode ?? null;
    const late = b.checkFlags.includes('credit_note_late');
    // Plan 08 §4: the e-invoice (IRN and QR, or "not yet registered") and the e-way bill.
    const einvoice = await this.eInvoices.printBlock(b.id);
    const eway = await this.eWayBills.printDetails('pos_bill', b.id);
    const columns: PrintColumn[] = [
      { key: 'no', label: '#' },
      { key: 'item', label: 'Item' },
      { key: 'hsn', label: 'HSN' },
      { key: 'quantity', label: 'Quantity', align: 'right' },
      { key: 'price', label: 'Rate', align: 'right' },
      { key: 'discount', label: 'Discount', align: 'right' },
      { key: 'taxable', label: supplyOfGoods ? 'Taxable value' : 'Value', align: 'right' },
      ...(supplyOfGoods
        ? ([{ key: 'gst', label: 'GST %', align: 'right' }, ...(igst ? [{ key: 'igst', label: 'IGST', align: 'right' }] : [{ key: 'cgst', label: 'CGST', align: 'right' }, { key: 'sgst', label: 'SGST', align: 'right' }])] as PrintColumn[])
        : []),
    ];
    return {
      ...this.base('pos_bill', title, lh),
      letterhead: { ...this.base('pos_bill', '', lh).letterhead, gstin: reg?.gstin ?? lh.gstin },
      number: b.number,
      date: iso(b.businessDate),
      mark: b.status === 'cancelled' ? 'CANCELLED' : null,
      party: buyerName || buyerGstin || buyerAddress ? { label: 'Buyer', name: buyerName ?? '', code: null, address: buyerAddress ? buyerAddress.split(/\r?\n/) : [], gstin: buyerGstin, phone: customer?.mobile ?? null } : null,
      details: [
        // Audit 4 (28 October 2026): the composition declaration now prints at the top (notice), rule 5(1)(f).
        ...(buyerStateCode ? [['Buyer’s state', state(buyerStateCode)] as [string, string]] : []),
        ['Place of supply', state(b.placeOfSupply ?? reg?.stateCode ?? null)],
        ...(g.returnNote ? [] : [['Reverse charge', g.reverseCharge] as [string, string]]),
        ...(original ? [['Against invoice', `${original.number} dated ${iso(original.businessDate)}`] as [string, string]] : []),
        ...(late ? [['Note', 'Issued after the GST time limit (section 34): the tax of the original invoice is not reduced in the return'] as [string, string]] : []),
        ...(delivery ? [['Delivery address', delivery.address] as [string, string]] : []),
        ['Till', b.till.code],
        ...(b.gstProvisional ? [['GST', 'Provisional: saved before the GST settings applied straight away; check its GST'] as [string, string]] : []),
        ...einvoice.details,
        ...eway,
      ],
      notice: [g.notice, einvoice.notice].filter(Boolean).join('\n') || null,
      qr: einvoice.qr,
      copies: g.copies,
      columns,
      lines: b.lines.map((l) => ({
        no: String(l.lineNo),
        item: `${l.item.name} (${l.item.code})${l.isFree ? ' · free' : ''}`,
        hsn: hsnForPrint(l.hsnCode ?? l.item.hsnCode, digits),
        quantity: `${qty(D(l.quantity).abs())} ${units.get(l.unitId) ?? ''}`.trim(),
        price: money(l.price),
        discount: money(D(l.discountAmount).abs()),
        taxable: money(D(l.taxableAmount).abs()),
        gst: `${D(l.gstRate).toString()}%`,
        cgst: money(D(l.cgst).abs()),
        sgst: money(D(l.sgst).abs()),
        igst: money(D(l.igst).abs()),
      })),
      totals: [
        [supplyOfGoods ? 'Taxable value' : 'Value', money(D(b.taxableAmount).abs())],
        ...(supplyOfGoods ? (igst ? [['IGST', money(D(b.igst).abs())] as [string, string]] : ([['CGST', money(D(b.cgst).abs())], ['SGST', money(D(b.sgst).abs())]] as [string, string][])) : []),
        ...(!D(b.roundingAdjustment).isZero() ? [['Rounding', money(b.roundingAdjustment)] as [string, string]] : []),
        [b.kind === 'return' ? 'Total credited' : 'Total', money(D(b.total).abs())],
      ],
      amountInWords: amountInWords(D(b.total).abs()),
      terms: await this.termsFor('pos_bill'),
      signatures: ['Authorised signatory'],
    };
  }

  private async purchaseOrder(id: string, user: CurrentUser): Promise<PrintDocument> {
    const o = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: { include: { item: true }, orderBy: { lineNo: 'asc' } } } });
    if (!o) throw new NotFoundException('Purchase order not found');
    this.assertStore(user, o.storeId);
    const units = await this.unitCodes(o.lines.map((l) => l.unitId));
    const paymentTerms = o.paymentTermsId ? await this.prisma.paymentTerms.findUnique({ where: { id: o.paymentTermsId } }) : null;
    const lh = await this.letterhead(o.storeId);
    // Audit 1 (28 October 2026): rates and amounts only for people who may see buying prices, as on the screen.
    const prices = hasPermission(user, 'buying_prices.view');
    return {
      ...this.base('purchase_order', 'Purchase order', lh),
      number: o.number,
      date: iso(o.orderDate),
      mark: this.mark(o.status),
      party: await this.partyBlock('supplier', o.supplierId),
      details: [['Needed by', iso(o.neededBy) ?? ''], ...(o.supplierQuoteRef ? [['Your quotation', o.supplierQuoteRef] as [string, string]] : []), ...(paymentTerms ? [['Payment terms', paymentTerms.name] as [string, string]] : []), ...(o.remarks ? [['Remarks', o.remarks] as [string, string]] : [])],
      columns: [
        { key: 'no', label: '#' },
        { key: 'item', label: 'Item' },
        { key: 'quantity', label: 'Quantity', align: 'right' },
        ...(prices
          ? ([
              { key: 'rate', label: 'Rate', align: 'right' },
              { key: 'discount', label: 'Discount', align: 'right' },
              { key: 'taxable', label: 'Taxable value', align: 'right' },
              { key: 'gst', label: 'GST', align: 'right' },
              { key: 'total', label: 'Amount', align: 'right' },
            ] as const)
          : []),
      ],
      lines: o.lines.map((l) => ({
        no: String(l.lineNo),
        item: `${l.item.name} (${l.item.code})`,
        quantity: `${qty(l.quantity)} ${units.get(l.unitId) ?? ''}${D(l.freeQuantity).gt(0) ? ` + ${qty(l.freeQuantity)} free` : ''}`.trim(),
        ...(prices
          ? {
              rate: money(l.rate),
              discount: D(l.discountPercent).gt(0) ? `${D(l.discountPercent).toFixed(2)}%` : D(l.discountAmount).gt(0) ? money(l.discountAmount) : '',
              taxable: money(l.taxableAmount),
              gst: `${D(l.gstRate).toString()}% · ${money(D(l.cgst).add(D(l.sgst)).add(D(l.igst)))}`,
              total: money(l.lineTotal),
            }
          : {}),
      })),
      totals: prices ? [['Taxable value', money(o.taxableAmount)], ['GST', money(o.taxAmount)], ...(D(o.roundingAdjustment).isZero() ? [] : [['Rounding', money(o.roundingAdjustment)] as [string, string]]), ['Total', money(o.total)]] : [],
      amountInWords: prices ? amountInWords(o.total.toString()) : '',
      terms: await this.termsFor('purchase_order'),
      signatures: ['Authorised signatory'],
    };
  }

  private async goodsReceipt(id: string, user: CurrentUser): Promise<PrintDocument> {
    const r = await this.prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: { include: { item: true, orderLine: true }, orderBy: { lineNo: 'asc' } } } });
    if (!r) throw new NotFoundException('Goods receipt not found');
    this.assertStore(user, r.storeId);
    const units = await this.unitCodes(r.lines.map((l) => l.unitId));
    const batches = new Map((await this.prisma.batch.findMany({ where: { id: { in: r.lines.map((l) => l.batchId).filter((x): x is string => !!x) } } })).map((b) => [b.id, b]));
    const locations = new Map((await this.prisma.stockLocation.findMany({ where: { id: { in: r.lines.map((l) => l.shelfLocationId) } } })).map((l) => [l.id, l.name]));
    const receivedBy = r.finalisedById ? await this.prisma.user.findUnique({ where: { id: r.finalisedById } }) : null;
    const lh = await this.letterhead(r.storeId);
    return {
      ...this.base('goods_receipt', r.isReturn ? 'Goods returned to supplier' : 'Goods receipt note', lh),
      number: r.number,
      date: iso(r.postingDate),
      mark: this.mark(r.status),
      party: await this.partyBlock('supplier', r.supplierId),
      details: [
        ...(r.deliveryNoteNo ? [['Supplier’s delivery note', r.deliveryNoteNo] as [string, string]] : []),
        ...(r.vehicleNo ? [['Vehicle', r.vehicleNo] as [string, string]] : []),
        ...(receivedBy ? [['Received by', `${receivedBy.firstName}${receivedBy.lastName ? ` ${receivedBy.lastName}` : ''}`] as [string, string]] : []),
      ],
      columns: [
        { key: 'no', label: '#' },
        { key: 'item', label: 'Item' },
        { key: 'ordered', label: 'Ordered', align: 'right' },
        { key: 'received', label: 'Received', align: 'right' },
        { key: 'accepted', label: 'Accepted', align: 'right' },
        { key: 'rejected', label: 'Rejected', align: 'right' },
        { key: 'batch', label: 'Batch / expiry' },
        { key: 'location', label: 'Put in' },
      ],
      lines: r.lines.map((l) => {
        const b = l.batchId ? batches.get(l.batchId) : null;
        const batch = b?.batchNumber ?? l.newBatchNumber;
        const expiry = iso(b?.expiryDate ?? l.newExpiryOn);
        return {
          no: String(l.lineNo),
          item: `${l.item.name} (${l.item.code})`,
          ordered: l.orderLine ? `${qty(l.orderLine.quantity)} ${units.get(l.orderLine.unitId) ?? ''}`.trim() : '—',
          received: `${qty(D(l.receivedQuantity).abs())} ${units.get(l.unitId) ?? ''}`.trim(),
          accepted: qty(D(l.acceptedQuantity).abs()),
          rejected: D(l.rejectedQuantity).isZero() ? '' : qty(D(l.rejectedQuantity).abs()),
          batch: [batch, expiry ? `exp. ${expiry}` : null].filter(Boolean).join(' · '),
          location: locations.get(l.shelfLocationId) ?? '',
        };
      }),
      totals: [],
      amountInWords: null,
      terms: [],
      signatures: ['Received by', 'Checked by'],
    };
  }

  private async stockDocument(kind: 'transfer' | 'count_sheet', id: string, user: CurrentUser): Promise<PrintDocument> {
    const d = await this.prisma.stockDocument.findUnique({ where: { id }, include: { lines: { include: { item: true, batch: true }, orderBy: { lineNo: 'asc' } } } });
    if (!d) throw new NotFoundException('Stock document not found');
    this.assertStore(user, d.storeId);
    if (kind === 'count_sheet' && d.kind !== 'count') throw new BadRequestException('This is not a stock count');
    if (kind === 'transfer' && d.kind !== 'transfer_send' && d.kind !== 'transfer_receive' && d.kind !== 'move') throw new BadRequestException('This is not a transfer');
    const units = await this.unitCodes(d.lines.map((l) => l.unitId));
    const locs = new Map((await this.prisma.stockLocation.findMany({ where: { id: { in: [d.fromLocationId, d.toLocationId].filter((x): x is string => !!x) } } })).map((l) => [l.id, l.name]));
    const stores = new Map((await this.prisma.store.findMany({ where: { id: { in: [d.storeId, d.toStoreId].filter((x): x is string => !!x) } } })).map((s) => [s.id, `${s.code} — ${s.name}`]));
    const lh = await this.letterhead(d.storeId);
    if (kind === 'count_sheet') {
      return {
        ...this.base(kind, d.blind ? 'Stock count sheet (blind count)' : 'Stock count sheet', lh),
        number: d.number,
        date: iso(d.postingDate),
        mark: d.status === 'cancelled' ? 'CANCELLED' : null,
        party: null,
        details: [['Location', locs.get(d.fromLocationId ?? d.toLocationId ?? '') ?? stores.get(d.storeId) ?? '']],
        columns: [
          { key: 'no', label: '#' },
          { key: 'item', label: 'Item' },
          { key: 'batch', label: 'Batch' },
          ...(d.blind ? [] : [{ key: 'expected', label: 'In the system', align: 'right' as const }]),
          { key: 'counted', label: 'Counted', align: 'right' },
        ],
        lines: d.lines.map((l) => ({
          no: String(l.lineNo),
          item: `${l.item.name} (${l.item.code})`,
          batch: l.batch?.batchNumber ?? l.newBatchNumber ?? '',
          ...(d.blind ? {} : { expected: l.expectedQuantity ? `${qty(l.expectedQuantity)} ${units.get(l.unitId) ?? ''}`.trim() : '' }),
          // Space to write the count; filled in only once the count is finalised.
          counted: d.status === 'finalised' && l.countedQuantity ? qty(l.countedQuantity) : '',
        })),
        totals: [],
        amountInWords: null,
        terms: [],
        signatures: ['Counted by', 'Checked by'],
      };
    }
    if (d.kind === 'transfer_send' && d.toStoreId) return this.transferSend(d, units, locs, lh);
    return {
      ...this.base(kind, 'Stock transfer slip', lh),
      number: d.number,
      date: iso(d.postingDate),
      mark: this.mark(d.status),
      party: null,
      details: [
        ['From', [stores.get(d.storeId), d.fromLocationId ? locs.get(d.fromLocationId) : null].filter(Boolean).join(' · ')],
        ['To', [d.toStoreId ? stores.get(d.toStoreId) : stores.get(d.storeId), d.toLocationId ? locs.get(d.toLocationId) : null].filter(Boolean).join(' · ')],
        ...(d.remarks ? [['Remarks', d.remarks] as [string, string]] : []),
      ],
      columns: [
        { key: 'no', label: '#' },
        { key: 'item', label: 'Item' },
        { key: 'quantity', label: 'Quantity', align: 'right' },
        { key: 'batch', label: 'Batch / serials' },
      ],
      lines: d.lines.map((l) => ({
        no: String(l.lineNo),
        item: `${l.item.name} (${l.item.code})`,
        quantity: `${qty(l.quantity)} ${units.get(l.unitId) ?? ''}`.trim(),
        batch: [l.batch?.batchNumber ?? l.newBatchNumber, l.serialNumbers.length ? l.serialNumbers.join(', ') : null].filter(Boolean).join(' · '),
      })),
      totals: [['Items', String(d.lines.length)]],
      amountInWords: null,
      terms: [],
      signatures: ['Sent by', 'Received by'],
    };
  }

  /**
   * Plan 08 G10: goods sent to another store travel with a delivery challan
   * (CGST Rules rule 55: number and date, consignor and consignee with their
   * GSTINs, HSN, description, quantity, value, and the tax rate and amount
   * where the movement is a supply; CBIC invoice rules,
   * https://cbic-gst.gov.in/gst-invoice-rules.html). Between stores under
   * different GSTINs the send is a taxable supply and prints as a tax invoice
   * with the tax per line.
   */
  private async transferSend(
    d: Prisma.StockDocumentGetPayload<{ include: { lines: { include: { item: true; batch: true } } } }>,
    units: Map<string, string>,
    locs: Map<string, string>,
    lh: Awaited<ReturnType<PrintService['letterhead']>>,
  ): Promise<PrintDocument> {
    // Audit 4 (28 October 2026): values and tax always print (CGST Rules rule 46(k)-(m) on a tax
    // invoice or bill of supply, rule 55(1)(vi) on a delivery challan), whatever the reader's stock.cost.view right.
    const tax = await this.transferGst.forPrint(this.prisma, d);
    const settings = await this.prisma.gstSettings.findUnique({ where: { companyId: d.companyId }, select: { hsnDigits: true } });
    const digits = settings?.hsnDigits ?? 4;
    const regs = await this.prisma.store.findMany({ where: { id: { in: [d.storeId, d.toStoreId!] } }, include: { gstRegistration: true } });
    const fallbackReg = await this.prisma.gstRegistration.findFirst({ where: { companyId: d.companyId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    const reg = (id: string) => regs.find((s) => s.id === id)?.gstRegistration ?? fallbackReg;
    const party = (id: string) => consignorLine(regs.find((s) => s.id === id), reg(id)?.gstin);
    const byLine = new Map((tax?.lines ?? []).map((t) => [t.lineId, t]));
    const invoiced = !!tax?.taxed;
    // Audit 4 (28 October 2026): a transfer tax invoice shows its e-invoice IRN and QR (or "not yet registered").
    const einvoice = invoiced ? await this.eInvoices.printBlock(d.id, 'stock_document') : { details: [] as [string, string][], notice: null, qr: null };
    const title = invoiced ? 'Tax invoice (stock transfer)' : tax ? 'Bill of supply (stock transfer)' : 'Delivery challan';
    const valueOf = (l: (typeof d.lines)[number]) => byLine.get(l.id)?.taxable ?? D(l.valueChange).abs();
    const total = d.lines.reduce((s, l) => s.add(valueOf(l)), new Decimal(0));
    return {
      ...this.base('transfer', title, lh),
      number: d.number,
      date: iso(d.postingDate),
      mark: this.mark(d.status),
      // Audit 4: a composition company's bill of supply carries the rule 5(1)(f) declaration at the top.
      notice: tax && !invoiced ? BILL_OF_SUPPLY_DECLARATION : einvoice.notice,
      qr: einvoice.qr,
      // Audit 4: rule 48(1), a tax invoice for goods in triplicate.
      copies: invoiced ? RULE_48_COPIES : null,
      party: null,
      details: [
        // Audit 4: rule 55(1)(ii),(iii), name, full address and GSTIN of consignor and consignee.
        ['Consignor', party(d.storeId)],
        ['Consignee', party(d.toStoreId!)],
        ...(tax ? [['Place of supply', tax.placeOfSupply] as [string, string]] : []),
        ['Reason', tax ? 'Supply to own branch under another GSTIN' : 'Transfer between own stores (not a sale)'],
        ...einvoice.details,
        ...(await this.eWayBills.printDetails('stock_document', d.id)),
        ...(d.fromLocationId ? [['From location', locs.get(d.fromLocationId) ?? ''] as [string, string]] : []),
        ...(d.remarks ? [['Remarks', d.remarks] as [string, string]] : []),
      ],
      columns: [
        { key: 'no', label: '#' },
        { key: 'item', label: 'Item' },
        { key: 'hsn', label: 'HSN' },
        { key: 'quantity', label: 'Quantity', align: 'right' },
        { key: 'batch', label: 'Batch / serials' },
        { key: 'value', label: invoiced ? 'Taxable value' : 'Value', align: 'right' as const },
        ...(invoiced ? [{ key: 'gst', label: 'GST', align: 'right' as const }] : []),
      ],
      lines: d.lines.map((l) => {
        const t = byLine.get(l.id);
        return {
          no: String(l.lineNo),
          item: `${l.item.name} (${l.item.code})`,
          hsn: hsnForPrint(t?.hsnCode ?? l.item.hsnCode, digits),
          quantity: `${qty(l.quantity)} ${units.get(l.unitId) ?? ''}`.trim(),
          batch: [l.batch?.batchNumber ?? l.newBatchNumber, l.serialNumbers.length ? l.serialNumbers.join(', ') : null].filter(Boolean).join(' · '),
          value: money(valueOf(l)),
          ...(invoiced && t
            ? { gst: t.igst.gt(0) ? `IGST ${t.gstRate.toString()}% · ${money(t.igst)}` : `CGST + SGST ${t.gstRate.toString()}% · ${money(t.cgst.add(t.sgst))}` }
            : {}),
        };
      }),
      totals: [
        ['Items', String(d.lines.length)],
        [invoiced ? 'Taxable value' : 'Value', money(total)],
        ...(invoiced && tax
          ? ([
              ...(tax.totals.cgst.gt(0) ? [['CGST', money(tax.totals.cgst)], ['SGST', money(tax.totals.sgst)]] : []),
              ...(tax.totals.igst.gt(0) ? [['IGST', money(tax.totals.igst)]] : []),
              ['Total', money(tax.totals.total)],
            ] as [string, string][])
          : []),
      ],
      amountInWords: invoiced && tax ? amountInWords(tax.totals.total.toFixed(2)) : null,
      terms: [],
      signatures: ['Sent by', 'Received by'],
    };
  }

  /**
   * Audit 4 (T14): the invoice a shop issues itself for goods or services
   * bought on reverse charge from a supplier who is not registered (CGST Act
   * s.31(3)(f), Rule 46). Its number is the purchase bill's own (one series,
   * consecutive in the year), marked SI.
   */
  private async rcmSelfInvoice(id: string, user: CurrentUser): Promise<PrintDocument> {
    const b = await this.prisma.supplierBill.findUnique({ where: { id }, include: { supplier: true, lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { code: true, name: true, hsnCode: true } } } } } });
    if (!b) throw new NotFoundException('Supplier bill not found');
    this.assertStore(user, b.storeId);
    if (!b.reverseCharge) throw new BadRequestException('A self-invoice is only for a purchase on reverse charge');
    if (b.supplier.gstin) throw new BadRequestException('The supplier is registered: their own tax invoice is the document; no self-invoice is needed');
    if (b.status === 'draft') throw new BadRequestException('Finalise the bill first');
    const lh = await this.letterhead(b.storeId);
    const units = await this.unitCodes(b.lines.map((l) => l.unitId));
    const sum = (k: 'taxableAmount' | 'cgst' | 'sgst' | 'igst') => b.lines.reduce((s, l) => s.add(D(l[k])), new Decimal(0));
    const tax = sum('cgst').add(sum('sgst')).add(sum('igst'));
    const pos = b.placeOfSupply ?? null;
    return {
      ...this.base('rcm_self_invoice', 'Tax invoice (self-invoice, reverse charge)', lh),
      notice: 'Issued by the recipient under section 31(3)(f): goods or services received from an unregistered supplier. Tax payable on reverse charge: Yes',
      number: `SI-${b.number}`,
      date: iso(b.postingDate),
      mark: this.mark(b.status),
      party: { ...(await this.partyBlock('supplier', b.supplierId))!, label: 'Supplier (not registered)' },
      details: [
        ['Supplier’s bill', `${b.supplierBillNo} dated ${iso(b.supplierBillDate)}`],
        ['Place of supply', pos ? `${INDIAN_STATES[pos] ?? pos} (${pos})` : ''],
        ['Tax payable on reverse charge', 'Yes'],
      ],
      columns: [
        { key: 'item', label: 'Description' },
        { key: 'hsn', label: 'HSN/SAC' },
        { key: 'qty', label: 'Quantity', align: 'right' },
        { key: 'taxable', label: 'Taxable value', align: 'right' },
        { key: 'rate', label: 'GST %', align: 'right' },
        { key: 'cgst', label: 'CGST', align: 'right' },
        { key: 'sgst', label: 'SGST', align: 'right' },
        { key: 'igst', label: 'IGST', align: 'right' },
      ],
      lines: b.lines.map((l) => ({
        item: l.item.name,
        hsn: l.hsnCode ?? l.item.hsnCode ?? '',
        qty: `${l.quantity.toString()} ${units.get(l.unitId) ?? ''}`.trim(),
        taxable: money(l.taxableAmount),
        rate: l.gstRate.toString(),
        cgst: money(l.cgst),
        sgst: money(l.sgst),
        igst: money(l.igst),
      })),
      totals: [
        ['Taxable value', money(sum('taxableAmount'))],
        ['CGST', money(sum('cgst'))],
        ['SGST', money(sum('sgst'))],
        ['IGST', money(sum('igst'))],
        ['Tax payable by us (reverse charge)', money(tax)],
        ['Invoice value', money(sum('taxableAmount').add(tax))],
      ],
      amountInWords: amountInWords(sum('taxableAmount').add(tax).toString()),
      terms: [],
      signatures: ['Authorised signatory'],
    };
  }

  private async payment(id: string, user: CurrentUser): Promise<PrintDocument> {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: { deductions: true } });
    if (!p) throw new NotFoundException('Payment not found');
    this.assertStore(user, p.storeId);
    const accounts = new Map((await this.prisma.account.findMany({ where: { id: { in: [p.fromAccountId, p.toAccountId, ...p.deductions.map((d) => d.accountId)].filter((x): x is string => !!x) } } })).map((a) => [a.id, a.name]));
    const links = await this.prisma.settlement.findMany({ where: { byType: 'payment', byId: p.id, undone: false } });
    const numbers = new Map((await this.prisma.ledgerLine.findMany({ where: { itemId: { in: links.map((l) => l.billId) }, itemNumber: { not: null } }, select: { itemId: true, itemNumber: true, entryDate: true }, distinct: ['itemId'] })).map((l) => [l.itemId!, l]));
    const lh = await this.letterhead(p.storeId);
    const title = p.kind === 'receipt' ? 'Payment receipt' : p.kind === 'payment' ? 'Payment voucher' : 'Transfer voucher';
    const deductions = p.deductions.reduce((s, d) => s.add(D(d.amount)), new Decimal(0));
    // Audit 4 (T14; CGST Act s.31(3)(g), Rule 52): paying a supplier on reverse charge, the voucher shows the tax the shop pays.
    const rcmBills = p.kind === 'payment' ? await this.prisma.supplierBill.findMany({ where: { id: { in: links.filter((l) => l.billType === 'supplier_bill').map((l) => l.billId) }, reverseCharge: true }, include: { supplier: { select: { gstin: true } }, lines: { select: { gstRate: true, cgst: true, sgst: true, igst: true } } } }) : [];
    const rcmRows: [string, string][] = rcmBills.flatMap((b) => {
      const tax = b.lines.reduce((s, l) => s.add(D(l.cgst)).add(D(l.sgst)).add(D(l.igst)), new Decimal(0));
      const rates = [...new Set(b.lines.map((l) => `${l.gstRate.toString()}%`))].join(', ');
      const pos = b.placeOfSupply ? `${INDIAN_STATES[b.placeOfSupply] ?? b.placeOfSupply} (${b.placeOfSupply})` : '';
      return [[`Reverse charge on ${b.number}`, `GST ${rates}: ₹${money(tax)} payable by us${pos ? `; place of supply ${pos}` : ''}${b.supplier.gstin ? `; supplier GSTIN ${b.supplier.gstin}` : ''}`]];
    });
    return {
      ...this.base('payment', title, lh),
      ...(rcmRows.length ? { notice: 'Payment voucher under section 31(3)(g): tax on this supply is paid by us on reverse charge' } : {}),
      number: p.number,
      date: iso(p.paymentDate),
      mark: this.mark(p.status),
      party: p.partyType && p.partyId ? await this.partyBlock(p.partyType as 'customer' | 'supplier', p.partyId) : null,
      details: [
        ...(p.kind === 'receipt' ? [['Received into', accounts.get(p.toAccountId!) ?? ''] as [string, string]] : []),
        ...(p.kind === 'payment' ? [['Paid from', accounts.get(p.fromAccountId!) ?? ''] as [string, string]] : []),
        ...(p.kind === 'transfer' ? ([['From', accounts.get(p.fromAccountId!) ?? ''], ['To', accounts.get(p.toAccountId!) ?? '']] as [string, string][]) : []),
        ...(p.reference ? [['Cheque / transfer number', `${p.reference}${p.referenceDate ? ` dated ${iso(p.referenceDate)}` : ''}`] as [string, string]] : []),
        ...(p.remark ? [['Remark', p.remark] as [string, string]] : []),
        ...rcmRows,
      ],
      columns: [
        { key: 'bill', label: p.kind === 'transfer' ? 'Deduction' : 'Bill settled' },
        { key: 'date', label: 'Bill date' },
        { key: 'amount', label: 'Amount', align: 'right' },
      ],
      lines: [
        ...links.map((l) => ({ bill: numbers.get(l.billId)?.itemNumber ?? l.billType, date: iso(numbers.get(l.billId)?.entryDate) ?? '', amount: money(l.amount) })),
        ...p.deductions.map((d) => ({ bill: `${accounts.get(d.accountId) ?? 'Deduction'}${d.remark ? ` (${d.remark})` : ''}`, date: '', amount: money(d.amount) })),
      ],
      totals: [['Amount', money(p.amount)], ...(deductions.isZero() ? [] : [['Deductions', money(deductions)] as [string, string]])],
      amountInWords: amountInWords(p.amount.toString()),
      terms: [],
      signatures: [p.kind === 'receipt' ? 'Received by' : 'Paid by', 'Authorised signatory'],
    };
  }

  private async journal(id: string, user: CurrentUser): Promise<PrintDocument> {
    const j = await this.prisma.journal.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!j) throw new NotFoundException('Journal not found');
    for (const l of j.lines) this.assertStore(user, l.storeId);
    const accounts = new Map((await this.prisma.account.findMany({ where: { id: { in: j.lines.map((l) => l.accountId) } } })).map((a) => [a.id, `${a.number ? `${a.number} ` : ''}${a.name}`]));
    const parties = new Map(
      [
        ...(await this.prisma.customer.findMany({ where: { id: { in: j.lines.filter((l) => l.partyType === 'customer').map((l) => l.partyId!) } }, select: { id: true, name: true } })),
        ...(await this.prisma.supplier.findMany({ where: { id: { in: j.lines.filter((l) => l.partyType === 'supplier').map((l) => l.partyId!) } }, select: { id: true, name: true } })),
      ].map((p) => [p.id, p.name]),
    );
    const stores = new Map((await this.prisma.store.findMany({ select: { id: true, code: true } })).map((s) => [s.id, s.code]));
    const dr = j.lines.reduce((s, l) => s.add(D(l.debit)), new Decimal(0));
    const lh = await this.letterhead(j.lines.find((l) => l.storeId)?.storeId ?? null);
    return {
      ...this.base('journal', 'Journal voucher', lh),
      number: j.number,
      date: iso(j.journalDate),
      mark: this.mark(j.status),
      party: null,
      details: [...(j.reference ? [['Reference', j.reference] as [string, string]] : []), ...(j.remark ? [['Narration', j.remark] as [string, string]] : [])],
      columns: [
        { key: 'account', label: 'Account' },
        { key: 'party', label: 'Customer / supplier' },
        { key: 'store', label: 'Store' },
        { key: 'debit', label: 'Debit', align: 'right' },
        { key: 'credit', label: 'Credit', align: 'right' },
      ],
      lines: j.lines.map((l) => ({
        account: accounts.get(l.accountId) ?? '',
        party: l.partyId ? (parties.get(l.partyId) ?? '') : '',
        store: l.storeId ? (stores.get(l.storeId) ?? '') : '',
        debit: D(l.debit).isZero() ? '' : money(l.debit),
        credit: D(l.credit).isZero() ? '' : money(l.credit),
      })),
      totals: [['Total', money(dr)]],
      amountInWords: amountInWords(dr.toString()),
      terms: [],
      signatures: ['Prepared by', 'Approved by'],
    };
  }

  /** Statement of account: `id` is "customer:<uuid>" or "supplier:<uuid>"; the whole history to date, with the unpaid bills. */
  private async statement(id: string, user: CurrentUser): Promise<PrintDocument> {
    const [type, partyId] = id.split(':');
    if ((type !== 'customer' && type !== 'supplier') || !partyId) throw new BadRequestException('Statement of whom?');
    const s = await this.ledgerReports.partyStatement(type, partyId, {}, user);
    const lh = await this.letterhead(null);
    const party = await this.partyBlock(type, partyId);
    if (!party) throw new NotFoundException(`${type === 'customer' ? 'Customer' : 'Supplier'} not found`);
    return {
      ...this.base('statement', 'Statement of account', lh),
      number: null,
      date: iso(new Date()),
      mark: null,
      party,
      details: [['Opening balance', s.opening]],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'document', label: 'Document' },
        { key: 'debit', label: 'Debit', align: 'right' },
        { key: 'credit', label: 'Credit', align: 'right' },
        { key: 'balance', label: 'Balance', align: 'right' },
      ],
      lines: s.rows.map((r) => ({ date: r.date ?? '', document: r.documentNumber ?? r.documentType, debit: r.debit === '0.00' ? '' : r.debit, credit: r.credit === '0.00' ? '' : r.credit, balance: r.balance })),
      totals: [
        ['Closing balance', s.closing],
        ...s.openItems.filter((i) => D(i.owed).gt(0)).map((i): [string, string] => [`Unpaid: ${i.number ?? ''} of ${i.date}${i.dueDate ? `, due ${i.dueDate}` : ''}`, i.owed]),
      ],
      amountInWords: D(s.closing).isZero() ? null : amountInWords(D(s.closing).abs().toString()),
      terms: await this.termsFor('statement'),
      signatures: [],
    };
  }

  private async unitCodes(ids: string[]) {
    return new Map((await this.prisma.unit.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, code: true } })).map((u) => [u.id, u.code]));
  }
}
