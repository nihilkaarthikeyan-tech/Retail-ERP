// Copyright (c) 2026, Rademics. All rights reserved.
// GST reports and return figures (plan 08 §3; blueprint 13 process 8 and
// "Reports"): the sales tax register, GSTR-1 figures with the HSN summary and
// documents issued, GSTR-3B figures with the set-off of input credit, the
// credit and debit note register and the GST payable position for the owner
// dashboard. Every figure is per GSTIN (decision 64) for a month or a quarter
// (the filing frequency setting). Reports only read the till bills, supplier
// bills and the accounts; they never change them.
//
// Where the figures come from:
// - Outward documents are the till bills (sales are tax invoices, returns are
//   credit notes), read directly so they are current before a shift closes.
//   Cancelled bills count only in "documents issued".
// - GSTR-3B output tax and input credit are read from the accounts (the
//   output, input and reverse-charge GST accounts), as the blueprint says the
//   return figures are read straight from the books; the bills give the
//   taxable values and the split by kind of supply.
// - Older bills made before the GST fields were filled in: the registration
//   comes from the bill's store (else the company's default registration),
//   the place of supply from the buyer's GSTIN or state (else the
//   registration's state), and the HSN code from the item. Each use of a
//   fallback is counted in the warnings.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  addFigures,
  businessDate,
  creditAdjustment,
  type CreditAdjustment,
  type CreditBill,
  creditNoteDeadline,
  type CurrentUser,
  Decimal,
  documentSeries,
  emptyFigures,
  figuresEqual,
  figuresTax,
  gstPositions,
  type Gstr1B2csRow,
  type Gstr1DocRow,
  type Gstr1Figures,
  type Gstr1HsnRow,
  type Gstr1Invoice,
  type Gstr1Item,
  type Gstr1NilRow,
  type Gstr1Note,
  type MatchRow,
  gstReturnPeriod,
  type GstFiledPeriodInput,
  type GstReturnQuery,
  HEADS,
  type Heads,
  hsnForReturn,
  invoiceNumberProblem,
  isCreditNoteLate,
  type NilSupplyType,
  nilSupplyType,
  noteSection,
  type OutwardDoc,
  outwardSection,
  type PeriodTax,
  ratesInForce,
  returnPeriodOf,
  roundMoney,
  type ReturnPeriod,
  type TaxFigures,
  uqcFor,
} from 'shared';
import type { GstRegistration } from '../generated/prisma/client.js';
import { TransferGstService } from '../inventory/transfer-gst.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { OfficialHsnService } from '../gst/official-hsn.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { GstInwardService } from '../purchasing/gst-inward.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, money, qty, ReportsCommon, type StoreScope, ZERO } from './reports-common.service.js';

type Section = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'excluded';

interface DocLine {
  hsn: string;
  uqc: string;
  quantity: Decimal;
  rate: Decimal;
  taxable: Decimal;
  igst: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  /** Nil-rated or exempt (0%): reported in table 8, not with the taxable supplies. */
  nilKind: 'nil' | 'exempt' | null;
}

export interface OutDoc {
  billId: string;
  /** till: a till bill; transfer: goods sent to a store under another GSTIN of the company (a tax invoice, plan 08 G10). */
  source: 'till' | 'transfer';
  number: string;
  date: string;
  kind: 'invoice' | 'credit_note';
  cancelled: boolean;
  storeId: string;
  registrationId: string;
  invoiceKind: string;
  buyerGstin: string | null;
  buyerName: string | null;
  placeOfSupply: string;
  interState: boolean;
  /** Audit 4: a supply to an SEZ unit (GSTR-1 SEWP / SEWOP). */
  sez?: boolean;
  /** Audit 4: the buyer pays the tax on reverse charge. */
  reverseCharge?: boolean;
  value: Decimal;
  figures: TaxFigures;
  section: Section;
  original: { number: string; date: string } | null;
  deadline: string | null;
  late: boolean;
  provisional: boolean;
  /** Audit 4 T15: the month the bill is reported in (its own, or the next open one); transfers use their date. */
  reportMonth?: string;
  lines: DocLine[];
}

interface Warnings {
  registrationFromStore: number;
  placeOfSupplyGuessed: number;
  hsnFromItem: number;
  noHsn: string[];
  longNumbers: string[];
  headsMismatch: string[];
  provisional: number;
}

interface Context {
  companyId: string;
  registration: GstRegistration;
  registrations: GstRegistration[];
  period: ReturnPeriod;
  scope: StoreScope;
  settings: { filingFrequency: string; hsnDigits: number; combineSmallSales: boolean; scheme: string };
  /** Stores reporting under this registration (within the user's stores). */
  storeIds: string[];
  isDefault: boolean;
}

const f2 = (f: TaxFigures) => ({ taxable: money(f.taxable), igst: money(f.igst), cgst: money(f.cgst), sgst: money(f.sgst), cess: money(f.cess), tax: money(figuresTax(f)) });
const h2 = (h: Heads) => ({ igst: money(h.igst), cgst: money(h.cgst), sgst: money(h.sgst), total: money(h.igst.add(h.cgst).add(h.sgst)) });
const rateKey = (r: Decimal) => r.toFixed(2);

@Injectable()
export class GstReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
    private readonly transferGst: TransferGstService,
    private readonly officialHsn: OfficialHsnService,
    private readonly inward: GstInwardService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // ---- Registrations, period and settings ----

  private async settings(companyId: string) {
    const s = await this.prisma.gstSettings.findUnique({ where: { companyId } });
    return { filingFrequency: s?.filingFrequency ?? 'quarterly', hsnDigits: s?.hsnDigits ?? 4, combineSmallSales: s?.combineSmallSales ?? true, scheme: s?.scheme ?? 'regular' };
  }

  /** The GSTINs this user may report on: those with at least one of their stores (all for all-store users). */
  async registrations(user: CurrentUser) {
    const company = await this.common.current();
    const scope = this.common.scope(user);
    const regs = await this.prisma.gstRegistration.findMany({ where: { companyId: company.id }, orderBy: [{ isDefault: 'desc' }, { gstin: 'asc' }] });
    const stores = await this.prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, code: true, name: true, gstRegistrationId: true } });
    const def = regs.find((r) => r.isDefault) ?? regs[0];
    const settings = await this.settings(company.id);
    const today = businessDate();
    return {
      filingFrequency: settings.filingFrequency,
      currentPeriod: returnPeriodOf(today, settings.filingFrequency),
      registrations: regs
        .map((r) => {
          const own = stores.filter((s) => (s.gstRegistrationId ?? def?.id) === r.id);
          return { id: r.id, gstin: r.gstin, stateCode: r.stateCode, isDefault: r.isDefault, active: r.active, stores: own.filter((s) => !scope.ids || scope.ids.includes(s.id)).map((s) => ({ id: s.id, code: s.code, name: s.name })) };
        })
        .filter((r) => !scope.ids || r.stores.length > 0),
    };
  }

  private async context(q: GstReturnQuery, user: CurrentUser): Promise<Context> {
    const company = await this.common.current();
    const scope = this.common.scope(user);
    const settings = await this.settings(company.id);
    const regs = await this.prisma.gstRegistration.findMany({ where: { companyId: company.id }, orderBy: [{ isDefault: 'desc' }, { gstin: 'asc' }] });
    if (!regs.length) throw new BadRequestException('The company has no GST registration yet; add its GSTIN under Company');
    const def = regs.find((r) => r.isDefault) ?? regs[0];
    const stores = await this.prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, gstRegistrationId: true } });
    const visible = (regId: string) => stores.some((s) => (s.gstRegistrationId ?? def.id) === regId && (!scope.ids || scope.ids.includes(s.id)));
    let registration: GstRegistration | undefined;
    if (q.gstRegistrationId) {
      registration = regs.find((r) => r.id === q.gstRegistrationId);
      if (!registration) throw new BadRequestException('Unknown GST registration');
      if (scope.ids && !visible(registration.id)) throw new ForbiddenException('You are not allowed to see this GSTIN');
    } else {
      registration = regs.find((r) => !scope.ids || visible(r.id));
      if (!registration) throw new ForbiddenException('None of your stores has a GST registration');
    }
    const period = gstReturnPeriod(q.period ?? returnPeriodOf(businessDate(), settings.filingFrequency));
    if (!period) throw new BadRequestException('Choose a month (2026-09) or a quarter (2026-Q2)');
    const storeIds = stores.filter((s) => (s.gstRegistrationId ?? def.id) === registration.id && (!scope.ids || scope.ids.includes(s.id))).map((s) => s.id);
    return { companyId: company.id, registration, registrations: regs, period, scope, settings, storeIds, isDefault: registration.id === def.id };
  }

  private header(c: Context) {
    return { gstin: c.registration.gstin, gstRegistrationId: c.registration.id, stateCode: c.registration.stateCode, period: c.period.period, periodLabel: c.period.label, from: c.period.from, to: c.period.to, fp: c.period.fp, filingFrequency: c.settings.filingFrequency };
  }

  // ---- The outward documents of a period (the sales tax register's source) ----

  /** Every till bill of the period under the registration, sorted into its GSTR-1 section. */
  async documents(c: Context): Promise<{ docs: OutDoc[]; warnings: Warnings }> {
    const def = c.registrations.find((r) => r.isDefault) ?? c.registrations[0];
    const regById = new Map(c.registrations.map((r) => [r.id, r]));
    const stores = await this.prisma.store.findMany({ where: { companyId: c.companyId }, select: { id: true, gstRegistrationId: true } });
    const storeReg = new Map(stores.map((s) => [s.id, s.gstRegistrationId ?? def.id]));
    // Audit 4 T15: a bill is reported in its GSTR-1 month (its own, or the next open one when its month was
    // marked filed); a return note reduces no GST and is not reported (T7, T9).
    const months: string[] = [];
    for (let m = c.period.from.slice(0, 7); m <= c.period.to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
    const bills = await this.prisma.posBill.findMany({
      where: {
        companyId: c.companyId,
        AND: [
          { OR: [{ gstPeriod: { in: months } }, { gstPeriod: null, businessDate: { gte: fromIso(c.period.from), lte: fromIso(c.period.to) } }] },
          { OR: [{ documentKind: null }, { documentKind: { not: 'return_note' } }] },
        ],
        ...(c.scope.ids ? { till: { storeId: { in: c.scope.ids } } } : {}),
      },
      include: {
        till: { select: { storeId: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { hsnCode: true } } } },
        returnOf: { select: { number: true, businessDate: true, invoiceKind: true, buyerGstin: true, buyerStateCode: true, placeOfSupply: true, total: true, gstRegistrationId: true, till: { select: { storeId: true } } } },
      },
      orderBy: [{ businessDate: 'asc' }, { soldAt: 'asc' }, { number: 'asc' }],
    });
    const situations = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...new Set(bills.map((b) => b.customerId))] } }, select: { id: true, taxSituation: true } })).map((x) => [x.id, x.taxSituation]));
    const units = new Map((await this.prisma.unit.findMany({ select: { id: true, code: true } })).map((u) => [u.id, u.code]));
    const rates = (await this.prisma.gstRate.findMany({ select: { hsnCode: true, rate: true, kind: true, priceFrom: true, priceUpTo: true, effectiveFrom: true } })).map((r) => ({ ...r, effectiveFrom: iso(r.effectiveFrom)! }));
    const w: Warnings = { registrationFromStore: 0, placeOfSupplyGuessed: 0, hsnFromItem: 0, noHsn: [], longNumbers: [], headsMismatch: [], provisional: 0 };
    const docs: OutDoc[] = [];
    for (const b of bills) {
      const regId = b.gstRegistrationId ?? storeReg.get(b.till.storeId) ?? def.id;
      if (regId !== c.registration.id) continue;
      if (!b.gstRegistrationId) w.registrationFromStore += 1;
      const sellerState = regById.get(regId)?.stateCode ?? c.registration.stateCode;
      const registered = b.invoiceKind === 'business' && !!b.buyerGstin;
      const pos = b.placeOfSupply ?? (registered ? b.buyerGstin!.slice(0, 2) : b.buyerStateCode) ?? sellerState;
      if (!b.placeOfSupply) w.placeOfSupplyGuessed += 1;
      const date = iso(b.businessDate)!;
      const kind = b.kind === 'return' ? 'credit_note' : 'invoice';
      const here: OutwardDoc = { invoiceKind: b.invoiceKind, buyerGstin: b.buyerGstin, placeOfSupply: pos, sellerState, value: D(b.total), date };
      let section: Section;
      let original: OutDoc['original'] = null;
      let deadline: string | null = null;
      if (kind === 'invoice') section = outwardSection(here);
      else {
        const o = b.returnOf;
        const oState = o ? (regById.get(o.gstRegistrationId ?? storeReg.get(o.till.storeId) ?? def.id)?.stateCode ?? sellerState) : sellerState;
        const oRegistered = !!o && o.invoiceKind === 'business' && !!o.buyerGstin;
        const oDoc: OutwardDoc | null = o
          ? { invoiceKind: o.invoiceKind, buyerGstin: o.buyerGstin, placeOfSupply: o.placeOfSupply ?? (oRegistered ? o.buyerGstin!.slice(0, 2) : o.buyerStateCode) ?? oState, sellerState: oState, value: D(o.total), date: iso(o.businessDate)! }
          : null;
        section = noteSection(oDoc);
        if (o) {
          original = { number: o.number, date: iso(o.businessDate)! };
          deadline = creditNoteDeadline(original.date);
        }
      }
      const lines: DocLine[] = b.lines.map((l) => {
        let hsn = l.hsnCode;
        if (!hsn && l.item.hsnCode) {
          hsn = l.item.hsnCode;
          w.hsnFromItem += 1;
        }
        if (!hsn && b.status === 'completed') w.noHsn.push(b.number);
        const rate = D(l.gstRate);
        let nilKind: DocLine['nilKind'] = null;
        if (rate.isZero()) nilKind = ratesInForce(rates, hsn, date).some((r) => r.kind === 'exempt') ? 'exempt' : 'nil';
        return {
          hsn: hsnForReturn(hsn, c.settings.hsnDigits),
          uqc: uqcFor(units.get(l.unitId)),
          quantity: D(l.quantity),
          rate,
          taxable: D(l.taxableAmount),
          igst: D(l.igst),
          cgst: D(l.cgst),
          sgst: D(l.sgst),
          nilKind,
        };
      });
      // Audit 4: a supply to an SEZ is inter-state even in the seller's own state (IGST Act s.7(5)(b)).
      // The situation saved on the bill (audit 4); older bills take the customer's.
      const situation = b.buyerSituation ?? situations.get(b.customerId);
      const sez = registered && situation === 'sez';
      // A supply to an SEZ under LUT is zero-rated (IGST Act s.16), not nil-rated: it stays in B2B (SEWOP) and 3.1(b).
      if (sez) for (const l of lines) l.nilKind = null;
      const interState = pos !== sellerState || sez;
      const figures = addFigures(emptyFigures(), { taxable: b.taxableAmount.toString(), igst: b.igst.toString(), cgst: b.cgst.toString(), sgst: b.sgst.toString() });
      if (b.status === 'completed') {
        if ((interState && !figures.cgst.add(figures.sgst).isZero()) || (!interState && !figures.igst.isZero())) w.headsMismatch.push(b.number);
        if (b.gstProvisional) w.provisional += 1;
      }
      if (invoiceNumberProblem(b.number)) w.longNumbers.push(b.number);
      docs.push({
        billId: b.id,
        source: 'till',
        number: b.number,
        date,
        kind,
        cancelled: b.status === 'cancelled',
        storeId: b.till.storeId,
        registrationId: regId,
        invoiceKind: registered ? 'business' : b.invoiceKind === 'bill_of_supply' ? 'bill_of_supply' : 'consumer',
        buyerGstin: registered ? b.buyerGstin : null,
        buyerName: b.buyerName,
        placeOfSupply: pos,
        interState,
        sez,
        reverseCharge: registered && situation === 'reverse_charge',
        value: D(b.total),
        figures,
        section,
        original,
        deadline,
        late: !!original && isCreditNoteLate(original.date, date),
        provisional: b.gstProvisional,
        reportMonth: b.gstPeriod ?? date.slice(0, 7),
        lines,
      });
    }
    docs.push(...(await this.transferDocs(c, storeReg)));
    w.noHsn = [...new Set(w.noHsn)];
    return { docs, warnings: w };
  }

  /**
   * Goods sent from a store of this GSTIN to a store under another GSTIN of
   * the company: supplies between distinct persons (CGST Act section 25(4),
   * Schedule I para 2), invoiced by the inventory module with output tax here
   * and input credit at the receiver. They are reported as B2B invoices to
   * the receiving GSTIN, so GSTR-1 agrees with the output tax in the accounts.
   */
  private async transferDocs(c: Context, storeReg: Map<string, string>): Promise<OutDoc[]> {
    const sends = await this.prisma.stockDocument.findMany({
      where: { companyId: c.companyId, kind: 'transfer_send', status: { in: ['finalised', 'cancelled'] }, postingDate: { gte: fromIso(c.period.from), lte: fromIso(c.period.to) }, toStoreId: { not: null }, ...(c.scope.ids ? { storeId: { in: c.scope.ids } } : {}) },
      include: { lines: { select: { id: true, itemId: true, basicQuantity: true, valueChange: true, unitCost: true } } },
      orderBy: [{ postingDate: 'asc' }, { number: 'asc' }],
    });
    const mine = sends.filter((d) => storeReg.get(d.storeId) === c.registration.id && storeReg.get(d.toStoreId!) !== c.registration.id);
    if (!mine.length) return [];
    const itemIds = [...new Set(mine.flatMap((d) => d.lines.map((l) => l.itemId)))];
    const units = new Map((await this.prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, baseUnit: { select: { code: true } } } })).map((i) => [i.id, i.baseUnit.code]));
    const out: OutDoc[] = [];
    for (const d of mine) {
      const tax = await this.transferGst.forPrint(this.prisma, { ...d, kind: d.kind as string, toStoreId: d.toStoreId });
      if (!tax || !tax.taxed) continue;
      const lineOf = new Map(d.lines.map((l) => [l.id, l]));
      const date = iso(d.postingDate)!;
      const value = tax.totals.total;
      const doc: OutwardDoc = { invoiceKind: 'business', buyerGstin: tax.to.gstin, placeOfSupply: tax.placeOfSupply, sellerState: tax.from.stateCode, value, date };
      out.push({
        billId: d.id,
        source: 'transfer',
        number: d.number,
        date,
        kind: 'invoice',
        cancelled: d.status === 'cancelled',
        storeId: d.storeId,
        registrationId: c.registration.id,
        invoiceKind: 'business',
        buyerGstin: tax.to.gstin,
        buyerName: 'Own store under another GSTIN',
        placeOfSupply: tax.placeOfSupply,
        interState: tax.interState,
        value,
        figures: addFigures(emptyFigures(), tax.totals),
        section: outwardSection(doc),
        original: null,
        deadline: null,
        late: false,
        provisional: false,
        lines: tax.lines.map((l) => {
          const src = lineOf.get(l.lineId)!;
          const zero = l.gstRate.isZero();
          return {
            hsn: hsnForReturn(l.hsnCode, c.settings.hsnDigits),
            uqc: uqcFor(units.get(src.itemId)),
            quantity: D(src.basicQuantity).abs(),
            rate: l.gstRate,
            taxable: l.taxable,
            igst: l.igst,
            cgst: l.cgst,
            sgst: l.sgst,
            nilKind: zero ? 'nil' : null,
          };
        }),
      });
    }
    return out;
  }

  private warningTexts(w: Warnings): string[] {
    const out: string[] = [];
    const some = (list: string[]) => `${list.slice(0, 5).join(', ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}`;
    if (w.longNumbers.length) out.push(`${w.longNumbers.length} bill numbers are longer than 16 characters or use other characters than letters, digits, "-" and "/" (for example ${some(w.longNumbers)}). The GST portal refuses such invoice numbers (CGST rule 46(b)); shorten the number pattern under Document numbering before filing.`);
    if (w.noHsn.length) out.push(`Bills with lines that have no HSN code: ${some(w.noHsn)}. Give the items their HSN code; the HSN summary cannot be uploaded without it.`);
    if (w.headsMismatch.length) out.push(`Bills whose tax heads do not match the place of supply (CGST + SGST for another state, or IGST within the state): ${some(w.headsMismatch)}. Ask your accountant to check them.`);
    if (w.registrationFromStore) out.push(`${w.registrationFromStore} older bills had no GST registration recorded; the registration of their store was used.`);
    if (w.placeOfSupplyGuessed) out.push(`${w.placeOfSupplyGuessed} older bills had no place of supply recorded; the buyer's state (or the store's state) was used.`);
    if (w.hsnFromItem) out.push(`${w.hsnFromItem} older bill lines had no HSN code recorded; the item's present HSN code was used.`);
    if (w.provisional) out.push(`${w.provisional} older bills were saved as GST provisional (before the GST settings applied straight away); check their GST before filing.`);
    return out;
  }

  // ---- Sales tax register ----

  async salesRegister(q: GstReturnQuery, user: CurrentUser) {
    const c = await this.context(q, user);
    const { docs, warnings } = await this.documents(c);
    const stores = await this.common.stores(c.companyId);
    const rows = docs
      .filter((d) => !d.cancelled)
      .filter((d) => !q.kind || (q.kind === 'business' ? d.invoiceKind === 'business' : d.invoiceKind !== 'business'))
      .filter((d) => !q.placeOfSupply || d.placeOfSupply === q.placeOfSupply);
    let total = emptyFigures();
    let value = ZERO;
    for (const d of rows) {
      total = addFigures(total, d.figures);
      value = value.add(d.value);
    }
    return {
      ...this.header(c),
      workedOutAt: new Date().toISOString(),
      rows: rows.map((d) => ({
        billId: d.billId,
        source: d.source,
        number: d.number,
        date: d.date,
        kind: d.kind,
        invoiceKind: d.invoiceKind,
        store: stores.get(d.storeId)?.code ?? '',
        buyerGstin: d.buyerGstin,
        buyerName: d.buyerName,
        placeOfSupply: d.placeOfSupply,
        interState: d.interState,
        section: d.section,
        original: d.original,
        value: money(d.value),
        ...f2(d.figures),
        provisional: d.provisional,
      })),
      totals: { documents: rows.length, value: money(value), ...f2(total) },
      warnings: this.warningTexts(warnings),
    };
  }

  // ---- GSTR-1 figures ----

  /** The GSTR-1 sections, each worked out from the documents, and the check that they add up to the register. */
  async gstr1(q: GstReturnQuery, user: CurrentUser) {
    const c = await this.context(q, user);
    // Audit 4 (C2): a quarterly filer's month is its IFF: business invoices and their credit notes only
    // (CGST Rule 59(2)); the third month has none, its invoices go into the quarter's GSTR-1.
    const iff = c.settings.filingFrequency === 'quarterly' && c.period.kind === 'month';
    if (iff && Number(c.period.from.slice(5, 7)) % 3 === 0) throw new BadRequestException('The third month of a quarter has no IFF: its business invoices go into the quarter’s GSTR-1');
    const found = await this.documents(c);
    const warnings = found.warnings;
    const docs = iff ? found.docs.filter((d) => d.section === 'b2b' || d.section === 'cdnr') : found.docs;
    // The quarter's GSTR-1 leaves out the business invoices and notes already filed in an IFF of its months.
    const iffMonths = c.period.kind === 'quarter' ? await this.filedIffMonths(c) : new Set<string>();
    const inIff = (d: OutDoc) => (d.section === 'b2b' || d.section === 'cdnr') && iffMonths.has(d.reportMonth ?? d.date.slice(0, 7));
    const live = docs.filter((d) => !d.cancelled);
    const sellerState = c.registration.stateCode;

    const items = (d: OutDoc): Gstr1Item[] => {
      const byRate = new Map<string, TaxFigures>();
      for (const l of d.lines.filter((x) => !x.nilKind)) byRate.set(rateKey(l.rate), addFigures(byRate.get(rateKey(l.rate)) ?? emptyFigures(), l));
      return [...byRate].map(([rate, f]) => ({ rate, ...f2s(f) }));
    };
    const invoice = (d: OutDoc): Gstr1Invoice => ({
      number: d.number,
      date: d.date,
      value: money(d.value),
      placeOfSupply: d.placeOfSupply,
      buyerGstin: d.buyerGstin,
      reverseCharge: !!d.reverseCharge,
      items: items(d),
      invType: d.sez ? (d.figures.igst.isZero() ? 'SEWOP' : 'SEWP') : 'R',
      interState: d.interState,
    });
    const note = (d: OutDoc): Gstr1Note & { originalNumber: string | null; originalDate: string | null; late: boolean } => ({ ...invoice(d), buyerGstin: d.section === 'cdnr' ? (d.buyerGstin ?? null) : null, noteType: 'C', originalNumber: d.original?.number ?? null, originalDate: d.original?.date ?? null, late: d.late });

    const invoices = live.filter((d) => d.kind === 'invoice');
    const notes = live.filter((d) => d.kind === 'credit_note');
    const b2b = invoices.filter((d) => d.section === 'b2b' && !inIff(d)).map(invoice).filter((x) => x.items.length);
    const b2cl = invoices.filter((d) => d.section === 'b2cl').map(invoice).filter((x) => x.items.length);
    // A credit note against a B2B invoice names the buyer of that invoice.
    const originalBuyer = new Map(docs.filter((d) => d.kind === 'invoice').map((d) => [d.number, d.buyerGstin]));
    const cdnrDocs = notes.filter((d) => d.section === 'cdnr' && !inIff(d)).map((d) => ({ ...d, buyerGstin: d.buyerGstin ?? (d.original ? (originalBuyer.get(d.original.number) ?? null) : null) }));
    const cdnr = cdnrDocs.map(note).filter((x) => x.items.length);
    const cdnur = notes.filter((d) => d.section === 'cdnur').map(note).filter((x) => x.items.length);

    // B2CS: by supply type, place of supply and rate, net of consumer credit notes.
    const b2csMap = new Map<string, { supplyType: 'INTER' | 'INTRA'; placeOfSupply: string; rate: string; f: TaxFigures }>();
    for (const d of live.filter((x) => x.section === 'b2cs')) {
      for (const l of d.lines.filter((x) => !x.nilKind)) {
        const supplyType = d.placeOfSupply !== sellerState ? 'INTER' : 'INTRA';
        const k = `${supplyType}|${d.placeOfSupply}|${rateKey(l.rate)}`;
        const g = b2csMap.get(k) ?? { supplyType, placeOfSupply: d.placeOfSupply, rate: rateKey(l.rate), f: emptyFigures() };
        g.f = addFigures(g.f, l);
        b2csMap.set(k, g);
      }
    }
    const b2cs: Gstr1B2csRow[] = [...b2csMap.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || D(a.rate).cmp(D(b.rate))).map((g) => ({ supplyType: g.supplyType, placeOfSupply: g.placeOfSupply, rate: g.rate, ...f2s(g.f) }));

    // Table 8: nil-rated and exempt, by supply type (credit notes reduce them).
    const nilMap = new Map<NilSupplyType, { nil: Decimal; exempt: Decimal }>();
    for (const d of live.filter((x) => x.section !== 'excluded')) {
      for (const l of d.lines.filter((x) => x.nilKind)) {
        const t = nilSupplyType(d.section === 'b2b' || d.section === 'cdnr', d.interState);
        const g = nilMap.get(t) ?? { nil: ZERO, exempt: ZERO };
        if (l.nilKind === 'exempt') g.exempt = g.exempt.add(l.taxable);
        else g.nil = g.nil.add(l.taxable);
        nilMap.set(t, g);
      }
    }
    const nil: Gstr1NilRow[] = (['INTRB2B', 'INTRAB2B', 'INTRB2C', 'INTRAB2C'] as NilSupplyType[]).filter((t) => nilMap.has(t)).map((t) => ({ supplyType: t, nil: money(nilMap.get(t)!.nil), exempt: money(nilMap.get(t)!.exempt), nonGst: '0.00' }));

    // Table 12: HSN summary, business (B2B and their notes) and consumer separately, at the configured digits.
    const descriptions = new Map((await this.prisma.hsnCode.findMany({ select: { code: true, description: true } })).map((h) => [h.code, h.description]));
    // Owner, 28 October 2026: a code the shop gave no description for takes the official one.
    const official = await this.officialHsn.descriptions([...new Set(live.flatMap((d) => d.lines.map((l) => l.hsn)))]);
    const hsnGroups = (business: boolean): Gstr1HsnRow[] => {
      const m = new Map<string, { hsn: string; uqc: string; rate: string; quantity: Decimal; f: TaxFigures }>();
      for (const d of live.filter((x) => x.section !== 'excluded' && (x.section === 'b2b' || x.section === 'cdnr') === business)) {
        for (const l of d.lines) {
          const k = `${l.hsn}|${l.uqc}|${rateKey(l.rate)}`;
          const g = m.get(k) ?? { hsn: l.hsn, uqc: l.uqc, rate: rateKey(l.rate), quantity: ZERO, f: emptyFigures() };
          g.quantity = g.quantity.add(l.quantity);
          g.f = addFigures(g.f, l);
          m.set(k, g);
        }
      }
      return [...m.values()]
        .sort((a, b) => a.hsn.localeCompare(b.hsn) || D(a.rate).cmp(D(b.rate)))
        .map((g) => ({ hsn: g.hsn, description: descriptions.get(g.hsn) ?? [...descriptions].find(([code]) => code.startsWith(g.hsn))?.[1] ?? official.get(g.hsn) ?? '', uqc: g.uqc, quantity: qty(g.quantity), rate: g.rate, ...f2s(g.f) }));
    };
    const hsnBusiness = hsnGroups(true);
    const hsnConsumer = hsnGroups(false);

    // Table 13: documents issued per series (cancelled ones included), invoices and credit notes apart.
    const reported = docs.filter((d) => d.section !== 'excluded');
    const documents: (Gstr1DocRow & { natureLabel: string })[] = [
      ...documentSeries(reported.filter((d) => d.kind === 'invoice').map((d) => ({ number: d.number, cancelled: d.cancelled }))).map((r) => ({ ...r, nature: 1 as const, natureLabel: 'Invoices for outward supply' })),
      ...documentSeries(reported.filter((d) => d.kind === 'credit_note').map((d) => ({ number: d.number, cancelled: d.cancelled }))).map((r) => ({ ...r, nature: 5 as const, natureLabel: 'Credit Note' })),
    ];
    // A till numbers its sales and returns in one series, so a gap is counted over the whole series, on its first row.
    // Audit 4: transfers of every GSTIN share one company-wide counter (numbers stay unique within each GSTIN);
    // numbers another GSTIN used, or a transfer within one GSTIN (a challan) used, are not missing.
    const transferNumbers = reported.some((d) => d.source === 'transfer')
      ? (await this.prisma.stockDocument.findMany({ where: { companyId: c.companyId, kind: 'transfer_send', status: { in: ['finalised', 'cancelled'] }, postingDate: { gte: fromIso(c.period.from), lte: fromIso(c.period.to) } }, select: { number: true } })).map((s) => s.number)
      : [];
    const reportedNumbers = new Set(reported.map((d) => d.number));
    const gaps = new Map(documentSeries([...reported.map((d) => ({ number: d.number, cancelled: d.cancelled })), ...transferNumbers.filter((n) => !reportedNumbers.has(n)).map((number) => ({ number, cancelled: false }))]).map((r) => [r.series, r.missing]));
    const seen = new Set<string>();
    for (const r of documents) {
      r.missing = seen.has(r.series) ? 0 : (gaps.get(r.series) ?? 0);
      seen.add(r.series);
    }

    // Sales under ₹200 shown as one combined invoice per day and store (a view only; the bills stay).
    const stores = await this.common.stores(c.companyId);
    const smallMap = new Map<string, { date: string; store: string; bills: number; value: Decimal; f: TaxFigures }>();
    if (c.settings.combineSmallSales) {
      for (const d of invoices.filter((x) => x.invoiceKind === 'consumer' && !x.buyerName && x.value.lt(200))) {
        const store = stores.get(d.storeId)?.code ?? '';
        const k = `${d.date}|${store}`;
        const g = smallMap.get(k) ?? { date: d.date, store, bills: 0, value: ZERO, f: emptyFigures() };
        g.bills += 1;
        g.value = g.value.add(d.value);
        g.f = addFigures(g.f, d.figures);
        smallMap.set(k, g);
      }
    }
    const smallSales = [...smallMap.values()].map((g) => ({ date: g.date, store: g.store, bills: g.bills, value: money(g.value), ...f2(g.f) }));

    // Every section adds up to the register (the check of scenario 8.8).
    const sumItems = (list: { items: Gstr1Item[] }[]) => list.reduce((t, x) => x.items.reduce((u, it) => addFigures(u, it), t), emptyFigures());
    const sumRows = (list: Gstr1Item[]) => list.reduce((t, it) => addFigures(t, it), emptyFigures());
    const nilTotal = nil.reduce((t, r) => t.add(D(r.nil)).add(D(r.exempt)), ZERO);
    const excluded = live.filter((d) => d.section === 'excluded').reduce((t, d) => addFigures(t, d.figures), emptyFigures());
    const sections = {
      b2b: sumItems(b2b),
      b2cl: sumItems(b2cl),
      b2cs: sumRows(b2cs),
      cdnr: sumItems(cdnr),
      cdnur: sumItems(cdnur),
      nil: addFigures(emptyFigures(), { taxable: nilTotal }),
      excluded,
      filedInIff: live.filter(inIff).reduce((t, d) => addFigures(t, addFigures(d.figures, { taxable: d.lines.filter((l) => l.nilKind).reduce((s, l) => s.add(l.taxable), ZERO) }, -1)), emptyFigures()),
    };
    const sectionsTotal = Object.values(sections).reduce((t, f) => addFigures(t, f), emptyFigures());
    const register = live.reduce((t, d) => addFigures(t, d.figures), emptyFigures());
    const hsnTotal = sumRows([...hsnBusiness, ...hsnConsumer]);
    const hsnExpected = addFigures(register, excluded, -1);
    const docsNet = documents.reduce((t, r) => t + r.net, 0);
    const reconciliation = {
      register: f2(register),
      sections: Object.fromEntries(Object.entries(sections).map(([k, f]) => [k, f2(f)])),
      sectionsTotal: f2(sectionsTotal),
      sectionsAgree: figuresEqual(sectionsTotal, register),
      hsnTotal: f2(hsnTotal),
      hsnAgrees: figuresEqual(hsnTotal, hsnExpected),
      documentsNet: docsNet,
      registerDocuments: live.filter((d) => d.section !== 'excluded').length,
      documentsAgree: docsNet === live.filter((d) => d.section !== 'excluded').length,
    };

    // An IFF has no nil, HSN or documents tables: those are reported for the whole quarter.
    const figures: Omit<Gstr1Figures, 'documents'> & { documents: typeof documents } = iff
      ? { gstin: c.registration.gstin, fp: c.period.fp, b2b, b2cl: [], b2cs: [], cdnr, cdnur: [], nil: [], hsnBusiness: [], hsnConsumer: [], documents: [] }
      : { gstin: c.registration.gstin, fp: c.period.fp, b2b, b2cl, b2cs, cdnr, cdnur, nil, hsnBusiness, hsnConsumer, documents };
    return {
      ...this.header(c),
      workedOutAt: new Date().toISOString(),
      ...figures,
      iff,
      filedInIff: live.filter(inIff).length,
      smallSales,
      combineSmallSales: c.settings.combineSmallSales,
      excludedBills: live.filter((d) => d.section === 'excluded').length,
      reconciliation,
      warnings: this.warningTexts(warnings),
    };
  }

  // ---- Composition: the quarterly statement (CMP-08; audit 4, T13) ----

  /**
   * What a composition dealer pays each quarter: 0.5% CGST and 0.5% SGST of
   * the turnover of taxable supplies in the State (CGST Act s.10(2), Rule 7,
   * "any other supplier": a shop), plus the reverse-charge tax on its
   * purchases. Exempt goods are shown but carry no tax. A month asked for
   * gives its whole quarter.
   */
  private async cmp08(c: Context) {
    const q = c.period.kind === 'quarter' ? c.period : gstReturnPeriod(returnPeriodOf(c.period.from, 'quarterly'))!;
    const qc: Context = { ...c, period: q };
    const { docs } = await this.documents(qc);
    let taxable = ZERO;
    let exempt = ZERO;
    for (const d of docs.filter((x) => !x.cancelled && x.section !== 'excluded')) {
      for (const l of d.lines) {
        if (l.nilKind) exempt = exempt.add(l.taxable);
        else taxable = taxable.add(l.taxable);
      }
    }
    const half = roundMoney(taxable.mul('0.005'));
    const ours = await this.storeRegistrations(qc);
    const bills = (
      await this.prisma.supplierBill.findMany({
        where: { companyId: c.companyId, status: { notIn: ['draft', 'cancelled'] }, reverseCharge: true, postingDate: { gte: fromIso(q.from), lte: fromIso(q.to) } },
        select: { gstRegistrationId: true, storeId: true, lines: { select: { taxableAmount: true, igst: true, cgst: true, sgst: true } } },
      })
    ).filter(ours);
    let rcm = emptyFigures();
    for (const b of bills) for (const l of b.lines) rcm = addFigures(rcm, { taxable: l.taxableAmount.toString(), igst: l.igst.toString(), cgst: l.cgst.toString(), sgst: l.sgst.toString() });
    const pay = { igst: rcm.igst, cgst: half.add(rcm.cgst), sgst: half.add(rcm.sgst) };
    return {
      period: q.period,
      periodLabel: q.label,
      outward: { taxable: money(taxable), exempt: money(exempt), rate: '1.00', cgst: money(half), sgst: money(half) },
      reverseCharge: f2(rcm),
      payable: h2(pay),
      note: 'Composition dealers file CMP-08 every quarter (and GSTR-4 once a year) instead of GSTR-1 and GSTR-3B. Interest for late payment is not included.',
    };
  }

  // ---- Returns marked as filed (audit 4, T15) ----

  private async filedIffMonths(c: Context) {
    const months: string[] = [];
    for (let m = c.period.from.slice(0, 7); m <= c.period.to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
    const rows = await this.prisma.gstFiledPeriod.findMany({ where: { gstRegistrationId: c.registration.id, returnType: 'iff', period: { in: months } }, select: { period: true } });
    return new Set(rows.map((r) => r.period));
  }

  /** The returns marked as filed for a GSTIN, newest first. */
  async filedPeriods(gstRegistrationId: string | undefined, user: CurrentUser) {
    const c = await this.context({ gstRegistrationId }, user);
    const rows = await this.prisma.gstFiledPeriod.findMany({ where: { gstRegistrationId: c.registration.id }, orderBy: [{ period: 'desc' }, { returnType: 'asc' }] });
    return rows.map((r) => ({ id: r.id, gstRegistrationId: r.gstRegistrationId, gstin: c.registration.gstin, period: r.period, returnType: r.returnType, filedOn: iso(r.filedOn), markedAt: r.createdAt }));
  }

  /**
   * Marks a return as filed on the portal. From then on a bill that arrives
   * for that month (an offline till syncing late) is reported in the next
   * open month. A quarter's GSTR-1 is kept under its last month.
   */
  async markFiled(input: GstFiledPeriodInput, user: CurrentUser, actor: Actor) {
    const c = await this.context({ gstRegistrationId: input.gstRegistrationId, period: input.period }, user);
    const quarterly = c.settings.filingFrequency === 'quarterly';
    if (input.returnType === 'iff') {
      if (!quarterly) throw new BadRequestException('IFF is only for quarterly filers; mark the month’s GSTR-1 instead');
      if (c.period.kind !== 'month' || Number(c.period.from.slice(5, 7)) % 3 === 0) throw new BadRequestException('An IFF is filed for the first or second month of a quarter');
    } else if (quarterly ? c.period.kind !== 'quarter' : c.period.kind !== 'month') {
      throw new BadRequestException(quarterly ? 'This GSTIN files GSTR-1 quarterly: choose the quarter (2026-Q2)' : 'This GSTIN files GSTR-1 monthly: choose the month (2026-09)');
    }
    if (input.filedOn <= c.period.to) throw new BadRequestException(`A return for ${c.period.label} can only be filed after ${c.period.to}`);
    if (input.filedOn > businessDate()) throw new BadRequestException('The filing date cannot be in the future');
    const period = c.period.to.slice(0, 7);
    const exists = await this.prisma.gstFiledPeriod.findFirst({ where: { gstRegistrationId: c.registration.id, period, returnType: input.returnType } });
    if (exists) throw new BadRequestException(`${input.returnType === 'iff' ? 'The IFF' : 'GSTR-1'} for ${c.period.label} is already marked as filed`);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.gstFiledPeriod.create({ data: { gstRegistrationId: c.registration.id, period, returnType: input.returnType, filedOn: fromIso(input.filedOn), createdById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'gst_filed_period', entityId: row.id, changes: { gstin: c.registration.gstin, period, returnType: input.returnType, filedOn: input.filedOn } });
      return { id: row.id, gstRegistrationId: row.gstRegistrationId, gstin: c.registration.gstin, period: row.period, returnType: row.returnType, filedOn: input.filedOn, markedAt: row.createdAt };
    });
  }

  /** Takes a "filed" mark off (marked by mistake). Bills already moved to a later month stay there. */
  async unmarkFiled(id: string, user: CurrentUser, actor: Actor) {
    const row = await this.prisma.gstFiledPeriod.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Filed return not found');
    const c = await this.context({ gstRegistrationId: row.gstRegistrationId }, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.gstFiledPeriod.delete({ where: { id } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'gst_filed_period', entityId: id, changes: { gstin: c.registration.gstin, period: row.period, returnType: row.returnType, filed: [true, false] } });
    });
  }

  // ---- GSTR-3B figures ----

  /** Account ids of the GST accounts, by role (missing reverse-charge accounts count as none). */
  private async taxAccounts(companyId: string) {
    const roles = ['gst_output_igst', 'gst_output_cgst', 'gst_output_sgst', 'gst_input_igst', 'gst_input_cgst', 'gst_input_sgst', 'gst_rcm_igst', 'gst_rcm_cgst', 'gst_rcm_sgst'];
    const defaults = await this.prisma.accountDefault.findMany({ where: { companyId, role: { in: roles } }, select: { role: true, accountId: true } });
    const byRole = new Map(defaults.map((d) => [d.role, d.accountId]));
    // Fall back to the standard accounts by their system key.
    const missing = roles.filter((r) => !byRole.has(r));
    if (missing.length) for (const a of await this.prisma.account.findMany({ where: { companyId, systemKey: { in: missing } }, select: { id: true, systemKey: true } })) byRole.set(a.systemKey!, a.id);
    return byRole;
  }

  /**
   * Output tax, input credit and reverse-charge tax per head from the
   * accounts, month by month up to the period's end, for the stores under
   * the registration (entries without a store count for the default one).
   */
  private async ledgerByMonth(c: Context) {
    const accounts = await this.taxAccounts(c.companyId);
    const ids = [...new Set(accounts.values())];
    const roleOf = new Map<string, string>();
    for (const [role, id] of accounts) roleOf.set(id, role);
    if (!ids.length) return new Map<string, Record<string, Decimal>>();
    const lines = await this.prisma.ledgerLine.groupBy({
      by: ['accountId', 'entryDate'],
      where: {
        companyId: c.companyId,
        accountId: { in: ids },
        entryDate: { lte: fromIso(c.period.to) },
        OR: [{ storeId: { in: c.storeIds } }, ...(c.isDefault && !c.scope.ids ? [{ storeId: null }] : [])],
      },
      _sum: { debit: true, credit: true },
    });
    const out = new Map<string, Record<string, Decimal>>();
    for (const l of lines) {
      const month = iso(l.entryDate)!.slice(0, 7);
      const row = out.get(month) ?? {};
      const role = roleOf.get(l.accountId)!;
      // Output and reverse-charge accounts are owed (credit); input accounts are claimed (debit).
      const amount = role.startsWith('gst_input') ? D(l._sum.debit).sub(D(l._sum.credit)) : D(l._sum.credit).sub(D(l._sum.debit));
      row[role] = (row[role] ?? ZERO).add(amount);
      out.set(month, row);
    }
    return out;
  }

  /** The position of each period from the first month in the accounts up to this one (credit carried forward). */
  private async positions(c: Context, user: CurrentUser) {
    const months = await this.ledgerByMonth(c);
    const checks = await this.creditChecks(c, user);
    const byPeriod = new Map<string, Record<string, Decimal>>();
    for (const [month, row] of months) {
      const p = returnPeriodOf(`${month}-01`, c.settings.filingFrequency);
      const acc = byPeriod.get(p) ?? {};
      for (const [k, v] of Object.entries(row)) acc[k] = (acc[k] ?? ZERO).add(v);
      byPeriod.set(p, acc);
    }
    byPeriod.set(c.period.period, byPeriod.get(c.period.period) ?? {});
    const ordered = [...byPeriod.keys()].sort((a, b) => gstReturnPeriod(a)!.from.localeCompare(gstReturnPeriod(b)!.from));
    const pick = (row: Record<string, Decimal>, kind: string) => ({ igst: row[`${kind}_igst`] ?? ZERO, cgst: row[`${kind}_cgst`] ?? ZERO, sgst: row[`${kind}_sgst`] ?? ZERO });
    const adjusted = (p: string) => {
      const books = pick(byPeriod.get(p)!, 'gst_input');
      const a = checks.adjustments.get(p);
      if (!a) return books;
      const f = (h: 'igst' | 'cgst' | 'sgst') => books[h].sub(a.notInStatement[h]).sub(a.timeBarred[h]).add(a.released[h]);
      return { igst: f('igst'), cgst: f('cgst'), sgst: f('sgst') };
    };
    const periods: PeriodTax[] = ordered.map((p) => ({ period: p, output: pick(byPeriod.get(p)!, 'gst_output'), credit: adjusted(p), reverseCharge: pick(byPeriod.get(p)!, 'gst_rcm') }));
    const all = gstPositions(periods);
    return { position: all.find((x) => x.period === c.period.period)!, input: adjusted(c.period.period), booksInput: pick(byPeriod.get(c.period.period)!, 'gst_input'), checks };
  }

  /**
   * Audit 4 (T11): credit is claimed only for supplier invoices in the
   * imported GSTR-2B (CGST Act s.16(2)(aa)) and never after the s.16(4) limit.
   * Each period with a GSTR-2B holds back what its suppliers have not reported
   * and claims earlier held-back bills once they appear; a period without one
   * keeps the credit in the accounts (with a note on this period).
   */
  private async creditChecks(c: Context, user: CurrentUser) {
    const freq = c.settings.filingFrequency;
    const uploads = await this.prisma.gstReturnUpload.findMany({
      where: { companyId: c.companyId, gstRegistrationId: c.registration.id, kind: 'gstr2b' },
      select: { id: true, period: true },
      orderBy: { createdAt: 'desc' },
    });
    // The latest file of each portal period, grouped by our return period.
    const latest = new Map<string, string>();
    for (const u of uploads) if (!latest.has(u.period)) latest.set(u.period, u.id);
    const byReturn = new Map<string, string[]>();
    for (const [p, id] of latest) {
      const rp = /^\d{4}-\d{2}$/.test(p) ? returnPeriodOf(`${p}-01`, freq) : freq === 'quarterly' ? p : null;
      if (!rp || gstReturnPeriod(rp)!.from > c.period.from) continue;
      byReturn.set(rp, [...(byReturn.get(rp) ?? []), id]);
    }
    const rows = new Map<string, MatchRow[]>();
    for (const [rp, ids] of byReturn) for (const id of ids) rows.set(rp, [...(rows.get(rp) ?? []), ...(await this.inward.match(id, user)).rows]);

    // Bills the rows name, and bills old enough to be past the s.16(4) limit.
    const rowIds = [...new Set([...rows.values()].flat().flatMap((r) => (r.books ? [r.books.id] : [])))];
    const to = c.period.to;
    const lastBarredFy = Number(to.slice(0, 4)) - (to.slice(5) >= '11-30' ? 0 : 1);
    const storeReg = await this.storeRegistrations(c);
    const found = await this.prisma.supplierBill.findMany({
      where: { companyId: c.companyId, status: { notIn: ['draft', 'cancelled'] }, postingDate: { lte: fromIso(to) }, OR: [{ id: { in: rowIds } }, { supplierBillDate: { lte: fromIso(`${lastBarredFy}-03-31`) } }] },
      select: { id: true, kind: true, reverseCharge: true, supplierBillDate: true, postingDate: true, gstRegistrationId: true, storeId: true, lines: { select: { igst: true, cgst: true, sgst: true, creditClaimable: true } } },
    });
    const bills = new Map<string, CreditBill>();
    for (const b of found) {
      if (!storeReg(b)) continue;
      const claim = b.lines.filter((l) => l.creditClaimable);
      bills.set(b.id, {
        id: b.id,
        kind: b.kind === 'debit_note' ? 'note' : 'invoice',
        reverseCharge: b.reverseCharge,
        invoiceDate: iso(b.supplierBillDate)!,
        postingPeriod: returnPeriodOf(iso(b.postingDate)!, freq),
        igst: claim.reduce((t, l) => t.add(l.igst), ZERO),
        cgst: claim.reduce((t, l) => t.add(l.cgst), ZERO),
        sgst: claim.reduce((t, l) => t.add(l.sgst), ZERO),
      });
    }
    const periods = new Set([...rows.keys(), ...[...bills.values()].map((b) => b.postingPeriod)]);
    const adjustments = new Map<string, CreditAdjustment>();
    for (const p of periods) {
      const range = gstReturnPeriod(p);
      if (!range || range.from > c.period.from) continue;
      adjustments.set(p, creditAdjustment({ period: p, periodTo: range.to, rows: rows.get(p) ?? null, bills, periodBills: [...bills.values()].filter((b) => b.postingPeriod === p).map((b) => b.id), heldBackEarlier: (q) => byReturn.has(q) }));
    }
    return { adjustments, statementImported: byReturn.has(c.period.period) };
  }

  /** Whether a supplier bill reports under the context's registration and stores. */
  private async storeRegistrations(c: Context) {
    const def = c.registrations.find((r) => r.isDefault) ?? c.registrations[0];
    const storeReg = new Map((await this.prisma.store.findMany({ where: { companyId: c.companyId }, select: { id: true, gstRegistrationId: true } })).map((s) => [s.id, s.gstRegistrationId ?? def.id]));
    return (b: { gstRegistrationId: string | null; storeId: string | null }) =>
      (b.gstRegistrationId ?? (b.storeId ? storeReg.get(b.storeId) : null) ?? def.id) === c.registration.id && (!c.scope.ids || !b.storeId || c.scope.ids.includes(b.storeId));
  }

  /**
   * Rule 37: forward-charge supplier invoices still unpaid 180 days after their
   * date, with the credit taken on them (a reminder; the shop decides).
   */
  private async unpaidAfter180Days(c: Context) {
    const ours = await this.storeRegistrations(c);
    const bills = (
      await this.prisma.supplierBill.findMany({
        where: { companyId: c.companyId, status: 'unpaid', kind: { not: 'debit_note' }, reverseCharge: false, supplierBillDate: { lte: fromIso(addDays(c.period.to, -180)) } },
        select: { id: true, gstRegistrationId: true, storeId: true, lines: { where: { creditClaimable: true }, select: { igst: true, cgst: true, sgst: true } } },
      })
    ).filter(ours);
    const open = await this.ledger.openAmounts(this.prisma, 'supplier_bill', bills.map((b) => b.id));
    let count = 0;
    let credit = ZERO;
    for (const b of bills) {
      if (!(open.get(b.id) ?? ZERO).gt(0)) continue;
      const tax = b.lines.reduce((t, l) => t.add(l.igst).add(l.cgst).add(l.sgst), ZERO);
      if (tax.lte(0)) continue;
      count += 1;
      credit = credit.add(tax);
    }
    return { count, credit };
  }

  async gstr3b(q: GstReturnQuery, user: CurrentUser) {
    const c = await this.context(q, user);
    const { docs, warnings } = await this.documents(c);
    const live = docs.filter((d) => !d.cancelled && d.section !== 'excluded');

    // 3.1 (a) taxable, (c) nil and exempt — from the bills, net of credit notes.
    let taxable = emptyFigures();
    // 3.1 (b) zero-rated: supplies to an SEZ, with IGST or under LUT (IGST Act s.16).
    let zeroRated = emptyFigures();
    let nilExempt = ZERO;
    const interStateConsumer = new Map<string, TaxFigures>();
    for (const d of live) {
      for (const l of d.lines) {
        if (d.sez) zeroRated = addFigures(zeroRated, l);
        else if (l.nilKind) nilExempt = nilExempt.add(l.taxable);
        else taxable = addFigures(taxable, l);
      }
      // 3.2 inter-state supplies to unregistered persons, by place of supply.
      if (d.interState && d.invoiceKind !== 'business' && d.section !== 'cdnr') {
        const taxed = d.lines.filter((l) => !l.nilKind).reduce((t, l) => addFigures(t, l), emptyFigures());
        interStateConsumer.set(d.placeOfSupply, addFigures(interStateConsumer.get(d.placeOfSupply) ?? emptyFigures(), taxed));
      }
    }

    // Purchases under the registration: reverse charge (3.1 d, 4 A 3) and credit that cannot be claimed (4 D).
    const def = c.registrations.find((r) => r.isDefault) ?? c.registrations[0];
    const stores = new Map((await this.prisma.store.findMany({ where: { companyId: c.companyId }, select: { id: true, gstRegistrationId: true } })).map((s) => [s.id, s.gstRegistrationId ?? def.id]));
    const bills = await this.prisma.supplierBill.findMany({
      where: { companyId: c.companyId, status: { not: 'draft' }, postingDate: { gte: fromIso(c.period.from), lte: fromIso(c.period.to) } },
      select: { id: true, status: true, reverseCharge: true, gstRegistrationId: true, storeId: true, supplier: { select: { gstin: true } }, lines: { select: { taxableAmount: true, igst: true, cgst: true, sgst: true, creditClaimable: true } } },
    });
    // 5: purchases with no tax (nil-rated, exempt, or from a composition supplier), split by the supplier's state.
    const inwardNoTax = { interState: ZERO, intraState: ZERO };
    const ownState = c.registration.gstin.slice(0, 2);
    let rcmInward = emptyFigures();
    let rcmCredit = emptyFigures();
    let blocked = emptyFigures();
    for (const b of bills) {
      if (b.status === 'cancelled') continue;
      const reg = b.gstRegistrationId ?? (b.storeId ? stores.get(b.storeId) : null) ?? def.id;
      if (reg !== c.registration.id) continue;
      if (c.scope.ids && b.storeId && !c.scope.ids.includes(b.storeId)) continue;
      for (const l of b.lines) {
        const f = { taxable: l.taxableAmount.toString(), igst: l.igst.toString(), cgst: l.cgst.toString(), sgst: l.sgst.toString() };
        if (b.reverseCharge) rcmInward = addFigures(rcmInward, f);
        if (b.reverseCharge && l.creditClaimable) rcmCredit = addFigures(rcmCredit, f);
        if (!l.creditClaimable) blocked = addFigures(blocked, f);
        if (!b.reverseCharge && l.igst.isZero() && l.cgst.isZero() && l.sgst.isZero()) {
          const inter = !!b.supplier.gstin && b.supplier.gstin.slice(0, 2) !== ownState;
          if (inter) inwardNoTax.interState = inwardNoTax.interState.add(l.taxableAmount);
          else inwardNoTax.intraState = inwardNoTax.intraState.add(l.taxableAmount);
        }
      }
    }

    const { position, input, checks } = await this.positions(c, user);
    const adj = checks.adjustments.get(c.period.period);
    const none = { igst: ZERO, cgst: ZERO, sgst: ZERO };
    const otherCredit = { igst: input.igst.sub(rcmCredit.igst), cgst: input.cgst.sub(rcmCredit.cgst), sgst: input.sgst.sub(rcmCredit.sgst) };
    const billsTax = { igst: taxable.igst.add(zeroRated.igst), cgst: taxable.cgst, sgst: taxable.sgst };
    const outputDiffers = HEADS.some((h) => !billsTax[h].eq(position.liability[h]));
    const notes = this.warningTexts(warnings);
    if (outputDiffers) notes.unshift('The tax on the bills differs from the output tax in the accounts. Till bills reach the accounts when their shift is closed; close every shift of the period before filing.');
    const sum = (h: { igst: Decimal; cgst: Decimal; sgst: Decimal }) => h.igst.add(h.cgst).add(h.sgst);
    if (!checks.statementImported) notes.push('No GSTR-2B is imported for this period, so the credit shown is all the credit in the accounts. Import the GSTR-2B (Purchases › GST inward) before filing: only credit your suppliers have reported can be claimed (CGST Act s.16(2)(aa)).');
    if (adj && sum(adj.notInStatement).gt(0)) notes.push(`Credit of ₹${money(sum(adj.notInStatement))} is held back: those supplier bills are not (or not fully) in this period’s GSTR-2B. It is claimed in the month the supplier reports them.`);
    if (adj && sum(adj.timeBarred).gt(0)) notes.push(`Credit of ₹${money(sum(adj.timeBarred))} is left out: the supplier invoices are past 30 November after their financial year (CGST Act s.16(4)).`);
    const unpaid = await this.unpaidAfter180Days(c);
    if (unpaid.count) notes.push(`Rule 37: ${unpaid.count} supplier bill${unpaid.count === 1 ? ' is' : 's are'} still unpaid 180 days after the invoice date (credit ₹${money(unpaid.credit)}). Pay the supplier, or pay that credit back with interest in this return (table 4(B)(2)); it can be claimed again once paid.`);
    return {
      ...this.header(c),
      workedOutAt: new Date().toISOString(),
      outward: {
        taxable: f2(taxable),
        zeroRated: f2(zeroRated),
        nilExempt: money(nilExempt),
        reverseChargeInward: f2(rcmInward),
        nonGst: '0.00',
      },
      interStateUnregistered: [...interStateConsumer].sort(([a], [b]) => a.localeCompare(b)).map(([pos, f]) => ({ placeOfSupply: pos, taxable: money(f.taxable), igst: money(f.igst) })),
      outputTaxFromBills: h2(billsTax),
      outputTaxFromAccounts: h2(position.liability),
      credit: {
        reverseCharge: h2({ igst: rcmCredit.igst, cgst: rcmCredit.cgst, sgst: rcmCredit.sgst }),
        allOther: h2(otherCredit),
        reversed: h2({ igst: ZERO, cgst: ZERO, sgst: ZERO }),
        net: h2(input),
        ineligible: h2({ igst: blocked.igst, cgst: blocked.cgst, sgst: blocked.sgst }),
        timeBarred: h2(adj?.timeBarred ?? none),
        notInGstr2b: h2(adj?.notInStatement ?? none),
        fromEarlierGstr2b: h2(adj?.released ?? none),
        gstr2bImported: checks.statementImported,
        broughtForward: h2(position.broughtForward),
        available: h2(position.credit),
      },
      setOff: {
        steps: position.steps.map((s) => ({ credit: s.credit, against: s.against, amount: money(s.amount) })),
        paidByCredit: h2(position.paidByCredit),
        cash: h2(position.cash),
      },
      inwardNoTax: { interState: money(inwardNoTax.interState), intraState: money(inwardNoTax.intraState) },
      composition: c.settings.scheme === 'composition' ? await this.cmp08(c) : null,
      reverseChargePayable: h2(position.reverseCharge),
      netPayable: h2(position.netPayable),
      totalPayable: money(position.totalPayable),
      creditCarriedForward: h2(position.creditLeft),
      notes,
    };
  }

  // ---- Credit and debit note register ----

  async notesRegister(q: GstReturnQuery, user: CurrentUser) {
    const c = await this.context(q, user);
    const { docs } = await this.documents(c);
    const stores = await this.common.stores(c.companyId);
    const daysTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    const credit = docs
      .filter((d) => d.kind === 'credit_note' && !d.cancelled)
      .map((d) => {
        const left = d.deadline ? daysTo(d.date, d.deadline) : null;
        return {
          billId: d.billId,
          kind: 'credit_note' as const,
          number: d.number,
          date: d.date,
          store: stores.get(d.storeId)?.code ?? '',
          party: d.buyerGstin ?? d.buyerName ?? 'Consumer',
          originalNumber: d.original?.number ?? null,
          originalDate: d.original?.date ?? null,
          deadline: d.deadline,
          status: !d.original ? 'no_original' : d.late ? 'late' : left !== null && left <= 30 ? 'near' : 'ok',
          section: d.section,
          value: money(d.value),
          ...f2(d.figures),
        };
      });
    // Debit notes to suppliers (goods sent back), with the bill they reduce.
    const def = c.registrations.find((r) => r.isDefault) ?? c.registrations[0];
    const storeReg = new Map((await this.prisma.store.findMany({ where: { companyId: c.companyId }, select: { id: true, gstRegistrationId: true } })).map((s) => [s.id, s.gstRegistrationId ?? def.id]));
    const debitBills = await this.prisma.supplierBill.findMany({
      where: { companyId: c.companyId, kind: 'debit_note', status: 'unpaid', postingDate: { gte: fromIso(c.period.from), lte: fromIso(c.period.to) } },
      include: { supplier: { select: { name: true, gstin: true } }, returnOf: { select: { supplierBillNo: true, supplierBillDate: true } }, lines: { select: { taxableAmount: true, igst: true, cgst: true, sgst: true } } },
      orderBy: [{ postingDate: 'asc' }, { number: 'asc' }],
    });
    const debit = debitBills
      .filter((b) => (b.gstRegistrationId ?? (b.storeId ? storeReg.get(b.storeId) : null) ?? def.id) === c.registration.id)
      .filter((b) => !c.scope.ids || !b.storeId || c.scope.ids.includes(b.storeId))
      .map((b) => {
        const f = b.lines.reduce((t, l) => addFigures(t, { taxable: l.taxableAmount.toString(), igst: l.igst.toString(), cgst: l.cgst.toString(), sgst: l.sgst.toString() }), emptyFigures());
        return {
          billId: b.id,
          kind: 'debit_note' as const,
          number: b.number,
          date: iso(b.postingDate)!,
          store: b.storeId ? (stores.get(b.storeId)?.code ?? '') : '',
          party: b.supplier.gstin ? `${b.supplier.name} (${b.supplier.gstin})` : b.supplier.name,
          originalNumber: b.returnOf?.supplierBillNo ?? null,
          originalDate: b.returnOf ? iso(b.returnOf.supplierBillDate) : null,
          deadline: null,
          status: b.returnOf ? 'ok' : 'no_original',
          section: 'purchase',
          value: money(D(b.total)),
          ...f2(f),
        };
      });
    const rows = [...credit, ...debit];
    return {
      ...this.header(c),
      workedOutAt: new Date().toISOString(),
      rows,
      totals: { creditNotes: credit.length, debitNotes: debit.length, late: credit.filter((r) => r.status === 'late').length, near: credit.filter((r) => r.status === 'near').length },
    };
  }

  // ---- The GST payable position (owner dashboard tile) ----

  /** This period's net payable in cash and the credit carried forward, over every GSTIN the user may see. */
  async payable(user: CurrentUser) {
    const { registrations, currentPeriod } = await this.registrations(user);
    let payable = ZERO;
    let carried = ZERO;
    const rows = [];
    for (const r of registrations) {
      const c = await this.context({ gstRegistrationId: r.id, period: currentPeriod }, user);
      const { position } = await this.positions(c, user);
      payable = payable.add(position.totalPayable);
      const left = position.creditLeft.igst.add(position.creditLeft.cgst).add(position.creditLeft.sgst);
      carried = carried.add(left);
      rows.push({ gstin: r.gstin, payable: money(position.totalPayable), creditCarriedForward: money(left) });
    }
    return { period: currentPeriod, label: gstReturnPeriod(currentPeriod)!.label, payable: money(payable), creditCarriedForward: money(carried), registrations: rows };
  }

  // ---- Downloads ----

  /** GSTR-1 as one Excel sheet per section, named like the offline tool's worksheets. */
  gstr1Sheets(r: Awaited<ReturnType<GstReturnsService['gstr1']>>) {
    const n = (s: string) => Number(s);
    const itemRows = (list: (Gstr1Invoice & { originalNumber?: string | null; originalDate?: string | null })[], withBuyer: boolean, note: boolean) =>
      list.flatMap((x) =>
        x.items.map((it) => [
          ...(withBuyer ? [x.buyerGstin ?? ''] : []),
          x.number,
          x.date,
          ...(note ? [x.originalNumber ?? '', x.originalDate ?? ''] : []),
          n(x.value),
          x.placeOfSupply,
          n(it.rate),
          n(it.taxable),
          n(it.igst),
          n(it.cgst),
          n(it.sgst),
          n(it.cess),
        ]),
      );
    const amounts = ['Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'];
    const hsn = (rows: Gstr1HsnRow[]) => [['HSN', 'Description', 'UQC', 'Total quantity', ...amounts], ...rows.map((h) => [h.hsn, h.description, h.uqc, n(h.quantity), n(h.rate), n(h.taxable), n(h.igst), n(h.cgst), n(h.sgst), n(h.cess)])];
    const rec = r.reconciliation;
    const recRow = (label: string, f: { taxable: string; igst: string; cgst: string; sgst: string }) => [label, n(f.taxable), n(f.igst), n(f.cgst), n(f.sgst)];
    return [
      {
        name: 'summary',
        rows: [
          ['GSTR-1 figures', `${r.gstin}, ${r.periodLabel} (return period ${r.fp})`],
          ['Section', 'Taxable value', 'IGST', 'CGST', 'SGST'],
          ...Object.entries(rec.sections).map(([k, f]) => recRow(k, f)),
          recRow('All sections', rec.sectionsTotal),
          recRow('Sales tax register', rec.register),
          ['Sections agree with the register', rec.sectionsAgree ? 'Yes' : 'No'],
          ['HSN summary agrees', rec.hsnAgrees ? 'Yes' : 'No'],
          ['Documents issued agree', rec.documentsAgree ? 'Yes' : 'No'],
          ...r.warnings.map((w) => ['Check', w]),
        ],
      },
      { name: 'b2b', rows: [['GSTIN of buyer', 'Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', ...amounts], ...itemRows(r.b2b, true, false)], textColumns: [0, 1, 4] },
      { name: 'b2cl', rows: [['Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', ...amounts], ...itemRows(r.b2cl, false, false)], textColumns: [0, 3] },
      { name: 'b2cs', rows: [['Supply type', 'Place of supply', ...amounts], ...r.b2cs.map((x) => [x.supplyType, x.placeOfSupply, n(x.rate), n(x.taxable), n(x.igst), n(x.cgst), n(x.sgst), n(x.cess)])], textColumns: [1] },
      { name: 'cdnr', rows: [['GSTIN of buyer', 'Note number', 'Note date', 'Original invoice', 'Original date', 'Note value', 'Place of supply', ...amounts], ...itemRows(r.cdnr, true, true)], textColumns: [0, 1, 3, 6] },
      { name: 'cdnur', rows: [['Note number', 'Note date', 'Original invoice', 'Original date', 'Note value', 'Place of supply', ...amounts], ...itemRows(r.cdnur, false, true)], textColumns: [0, 2, 5] },
      { name: 'exemp', rows: [['Supply type', 'Nil rated', 'Exempted', 'Non-GST'], ...r.nil.map((x) => [x.supplyType, n(x.nil), n(x.exempt), n(x.nonGst)])] },
      { name: 'hsn(b2b)', rows: hsn(r.hsnBusiness), textColumns: [0] },
      { name: 'hsn(b2c)', rows: hsn(r.hsnConsumer), textColumns: [0] },
      { name: 'docs', rows: [['Nature of document', 'Series', 'From', 'To', 'Total number', 'Cancelled', 'Net issued', 'Numbers missing'], ...r.documents.map((d) => [d.natureLabel, d.series, d.from, d.to, d.total, d.cancelled, d.net, d.missing])], textColumns: [1, 2, 3] },
      ...(r.combineSmallSales && r.smallSales.length ? [{ name: 'combined small sales', rows: [['Date', 'Store', 'Bills', 'Value', 'Taxable value', 'IGST', 'CGST', 'SGST'], ...r.smallSales.map((s) => [s.date, s.store, s.bills, n(s.value), n(s.taxable), n(s.igst), n(s.cgst), n(s.sgst)])] }] : []),
    ];
  }
}

/** Tax figures as decimal strings (cess is not charged by the till yet, so it stays zero). */
function f2s(f: TaxFigures): Omit<Gstr1Item, 'rate'> {
  return { taxable: money(f.taxable), igst: money(f.igst), cgst: money(f.cgst), sgst: money(f.sgst), cess: money(f.cess) };
}
