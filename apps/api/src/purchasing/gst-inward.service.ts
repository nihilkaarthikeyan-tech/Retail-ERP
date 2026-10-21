// Copyright (c) 2026, Rademics. All rights reserved.
// GST on purchases, reports (plan 08 §3): the purchase tax register per GSTIN
// and period (blueprint 13 "Purchase tax register") and input-credit matching
// against the inward statement (GSTR-2B) downloaded from the GST portal
// (blueprint 13 "Input credit matching"). Both are per GSTIN (decision 64).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type BookDocument,
  type CurrentUser,
  Decimal,
  matchInward,
  matchSummary,
  parseGstr2b,
  periodRange,
  type PurchaseTaxRegisterQuery,
} from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { GstRegistration, Prisma } from '../generated/prisma/client.js';
import { type Cell, writeCsv, writeXlsx } from '../imports/spreadsheet.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';

const billSelect = {
  id: true,
  number: true,
  kind: true,
  status: true,
  supplierBillNo: true,
  supplierBillDate: true,
  postingDate: true,
  storeId: true,
  reverseCharge: true,
  placeOfSupply: true,
  gstRegistrationId: true,
  taxableAmount: true,
  total: true,
  supplier: { select: { id: true, code: true, name: true, gstin: true } },
  lines: { select: { gstRate: true, cgst: true, sgst: true, igst: true, creditClaimable: true } },
} satisfies Prisma.SupplierBillSelect;
type BillForGst = Prisma.SupplierBillGetPayload<{ select: typeof billSelect }>;

export interface PurchaseTaxRow {
  billId: string;
  number: string;
  kind: 'invoice' | 'debit_note';
  supplierBillNo: string;
  supplierBillDate: string;
  postingDate: string;
  supplier: { id: string; code: string; name: string };
  supplierGstin: string | null;
  placeOfSupply: string | null;
  rates: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  /** Input credit the shop can claim. */
  creditClaimable: string;
  /** Tax that cannot be claimed (added to cost). */
  creditNotClaimable: string;
  reverseCharge: boolean;
  /** What the supplier is owed. */
  total: string;
}

@Injectable()
export class GstInwardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PurchaseCommon,
  ) {}

  // ---- Registrations ----

  private async registrations(companyId: string): Promise<GstRegistration[]> {
    return this.prisma.gstRegistration.findMany({ where: { companyId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  }

  /** The registration asked for, or the company's default one. */
  private async registration(companyId: string, id: string | undefined): Promise<GstRegistration> {
    const regs = await this.registrations(companyId);
    const reg = id ? regs.find((r) => r.id === id) : regs[0];
    if (!reg) throw new BadRequestException(id ? 'GST registration not found' : 'Record the company’s GSTIN first');
    return reg;
  }

  /** The GSTIN a bill reports under: as recorded on it, else its store's, else the company's default. */
  private async registrationOf(companyId: string): Promise<(b: { gstRegistrationId: string | null; storeId: string | null }) => string | null> {
    const regs = await this.registrations(companyId);
    const stores = new Map((await this.prisma.store.findMany({ where: { companyId }, select: { id: true, gstRegistrationId: true } })).map((s) => [s.id, s.gstRegistrationId]));
    const fallback = regs[0]?.id ?? null;
    return (b) => b.gstRegistrationId ?? (b.storeId ? stores.get(b.storeId) : null) ?? fallback;
  }

  /** The supplier's GSTIN: on the supplier, else on its main address. */
  private async supplierGstins(supplierIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, gstin: true } });
    for (const s of suppliers) if (s.gstin) out.set(s.id, s.gstin.toUpperCase());
    const missing = suppliers.filter((s) => !s.gstin).map((s) => s.id);
    if (missing.length) {
      const addresses = await this.prisma.address.findMany({ where: { partyType: 'supplier', partyId: { in: missing }, gstin: { not: null }, active: true }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
      for (const a of addresses) if (!out.has(a.partyId)) out.set(a.partyId, a.gstin!.toUpperCase());
    }
    return out;
  }

  // ---- Purchase tax register ----

  async register(q: PurchaseTaxRegisterQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const reg = await this.registration(company.id, q.gstRegistrationId);
    const range = q.period ? periodRange(q.period) : { from: q.from!, to: q.to! };
    if (!range) throw new BadRequestException('Unknown period');
    const stores = this.common.storeFilter(user);
    const bills = await this.prisma.supplierBill.findMany({
      where: {
        companyId: company.id,
        status: { notIn: ['draft', 'cancelled'] },
        postingDate: { gte: fromIso(range.from), lte: fromIso(range.to) },
        ...(stores ? { OR: [{ storeId: null }, { storeId: { in: stores } }] } : {}),
      },
      select: billSelect,
      orderBy: [{ postingDate: 'asc' }, { number: 'asc' }],
    });
    const regOf = await this.registrationOf(company.id);
    const gstins = await this.supplierGstins([...new Set(bills.map((b) => b.supplier.id))]);
    const rows = bills.filter((b) => regOf(b) === reg.id).map((b) => this.registerRow(b, gstins.get(b.supplier.id) ?? null));
    const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'tax' | 'creditClaimable' | 'creditNotClaimable' | 'total') => rows.reduce((s, r) => s.add(D(r[k])), new Decimal(0)).toFixed(2);
    const reverseChargeTax = rows.filter((r) => r.reverseCharge).reduce((s, r) => s.add(D(r.tax)), new Decimal(0)).toFixed(2);
    return {
      gstin: reg.gstin,
      gstRegistrationId: reg.id,
      from: range.from,
      to: range.to,
      rows,
      totals: { taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), tax: sum('tax'), creditClaimable: sum('creditClaimable'), creditNotClaimable: sum('creditNotClaimable'), reverseChargeTax, total: sum('total') },
    };
  }

  private registerRow(b: BillForGst, supplierGstin: string | null): PurchaseTaxRow {
    let cgst = new Decimal(0);
    let sgst = new Decimal(0);
    let igst = new Decimal(0);
    let claimable = new Decimal(0);
    let notClaimable = new Decimal(0);
    const rates = new Set<string>();
    for (const l of b.lines) {
      const tax = D(l.cgst).add(D(l.sgst)).add(D(l.igst));
      cgst = cgst.add(D(l.cgst));
      sgst = sgst.add(D(l.sgst));
      igst = igst.add(D(l.igst));
      if (l.creditClaimable) claimable = claimable.add(tax);
      else notClaimable = notClaimable.add(tax);
      rates.add(`${D(l.gstRate).toString()}%`);
    }
    const tax = cgst.add(sgst).add(igst);
    return {
      billId: b.id,
      number: b.number,
      kind: b.kind === 'debit_note' ? 'debit_note' : 'invoice',
      supplierBillNo: b.supplierBillNo,
      supplierBillDate: iso(b.supplierBillDate)!,
      postingDate: iso(b.postingDate)!,
      supplier: { id: b.supplier.id, code: b.supplier.code, name: b.supplier.name },
      supplierGstin,
      placeOfSupply: b.placeOfSupply,
      rates: [...rates].join(', '),
      taxable: D(b.taxableAmount).toFixed(2),
      cgst: cgst.toFixed(2),
      sgst: sgst.toFixed(2),
      igst: igst.toFixed(2),
      tax: tax.toFixed(2),
      creditClaimable: claimable.toFixed(2),
      creditNotClaimable: notClaimable.toFixed(2),
      reverseCharge: b.reverseCharge,
      total: D(b.total).toFixed(2),
    };
  }

  /** The register as an Excel (or CSV) file; the download is recorded in the history. */
  async registerFile(q: PurchaseTaxRegisterQuery, format: 'xlsx' | 'csv', actor: Actor, user: CurrentUser) {
    const r = await this.register(q, user);
    const head: Cell[] = ['Our number', 'Kind', 'Supplier', 'Supplier GSTIN', 'Supplier bill no.', 'Bill date', 'Posting date', 'Place of supply', 'Rates', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax', 'Credit claimable', 'Credit not claimable', 'Reverse charge', 'Owed to supplier'];
    const n = (v: string) => Number(v);
    const rows: Cell[][] = [
      head,
      ...r.rows.map((x) => [x.number, x.kind === 'debit_note' ? 'Debit note' : 'Bill', x.supplier.name, x.supplierGstin ?? '', x.supplierBillNo, x.supplierBillDate, x.postingDate, x.placeOfSupply ?? '', x.rates, n(x.taxable), n(x.cgst), n(x.sgst), n(x.igst), n(x.tax), n(x.creditClaimable), n(x.creditNotClaimable), x.reverseCharge ? 'Yes' : 'No', n(x.total)]),
      ['Total', '', '', '', '', '', '', '', '', n(r.totals.taxable), n(r.totals.cgst), n(r.totals.sgst), n(r.totals.igst), n(r.totals.tax), n(r.totals.creditClaimable), n(r.totals.creditNotClaimable), `₹${r.totals.reverseChargeTax}`, n(r.totals.total)],
    ];
    const base = `purchase-tax-register-${r.gstin}-${r.from}-to-${r.to}`;
    await this.audit.recordNow(actor, { action: 'export', entityType: 'purchase_tax_register', entityId: null, changes: { gstin: r.gstin, from: r.from, to: r.to, rows: r.rows.length, format } });
    if (format === 'csv') return { fileName: `${base}.csv`, data: Buffer.from(writeCsv(rows), 'utf8'), contentType: 'text/csv; charset=utf-8' };
    return { fileName: `${base}.xlsx`, data: writeXlsx('Purchase tax register', rows, { textColumns: [3, 4] }) };
  }

  // ---- Inward statement (GSTR-2B) ----

  /** The JSON file as downloaded from the portal (Returns > GSTR-2B > Download JSON). */
  async upload(file: { originalname: string; buffer: Buffer } | undefined, actor: Actor) {
    if (!file) throw new BadRequestException('Choose the GSTR-2B JSON file downloaded from the GST portal');
    const company = await this.common.currentCompany();
    const input = { fileName: file.originalname.slice(0, 200) };
    let raw: unknown;
    try {
      raw = JSON.parse(file.buffer.toString('utf8').replace(/^﻿/, ''));
    } catch {
      throw new BadRequestException('The file is not JSON; download the GSTR-2B as JSON from the GST portal (a ZIP must be opened first)');
    }
    let statement;
    try {
      statement = parseGstr2b(raw);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const reg = (await this.registrations(company.id)).find((r) => r.gstin.toUpperCase() === statement.gstin);
    if (!reg) throw new BadRequestException(`The statement is for GSTIN ${statement.gstin}, which is not one of this company’s registrations`);
    const created = await this.prisma.$transaction(async (tx) => {
      const u = await tx.gstReturnUpload.create({
        data: { companyId: company.id, gstRegistrationId: reg.id, kind: 'gstr2b', period: statement.period, fileName: input.fileName, data: raw as Prisma.InputJsonValue, createdById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'gst_return_upload', entityId: u.id, changes: { kind: 'gstr2b', gstin: reg.gstin, period: statement.period, fileName: input.fileName, documents: statement.documents.length } });
      return u;
    });
    return { id: created.id, gstin: reg.gstin, gstRegistrationId: reg.id, period: statement.period, fileName: created.fileName, documents: statement.documents.length, uploadedAt: created.createdAt };
  }

  async uploads(gstRegistrationId: string | undefined) {
    const company = await this.common.currentCompany();
    const regs = new Map((await this.registrations(company.id)).map((r) => [r.id, r.gstin]));
    const rows = await this.prisma.gstReturnUpload.findMany({
      where: { companyId: company.id, kind: 'gstr2b', ...(gstRegistrationId ? { gstRegistrationId } : {}) },
      select: { id: true, gstRegistrationId: true, period: true, fileName: true, createdAt: true },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => ({ id: r.id, gstRegistrationId: r.gstRegistrationId, gstin: regs.get(r.gstRegistrationId) ?? null, period: r.period, fileName: r.fileName, uploadedAt: r.createdAt }));
  }

  /**
   * Matches an uploaded statement with our supplier bills and debit notes of
   * the same GSTIN: our bills of the statement's month, plus any earlier bill
   * that a portal document names (suppliers often report late).
   */
  async match(uploadId: string, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const upload = await this.prisma.gstReturnUpload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.companyId !== company.id || upload.kind !== 'gstr2b') throw new NotFoundException('Statement not found');
    const statement = parseGstr2b(upload.data);
    const range = periodRange(statement.period)!;
    const regOf = await this.registrationOf(company.id);
    const stores = this.common.storeFilter(user);
    const portalGstins = [...new Set(statement.documents.map((d) => d.supplierGstin))];
    const suppliersByGstin = await this.prisma.supplier.findMany({ where: { companyId: company.id, OR: [{ gstin: { in: portalGstins, mode: 'insensitive' } }] }, select: { id: true } });
    const addressSuppliers = await this.prisma.address.findMany({ where: { partyType: 'supplier', gstin: { in: portalGstins, mode: 'insensitive' } }, select: { partyId: true } });
    const named = [...new Set([...suppliersByGstin.map((s) => s.id), ...addressSuppliers.map((a) => a.partyId)])];
    const bills = await this.prisma.supplierBill.findMany({
      where: {
        companyId: company.id,
        status: { notIn: ['draft', 'cancelled'] },
        OR: [{ postingDate: { gte: fromIso(range.from), lte: fromIso(range.to) } }, { supplierId: { in: named }, postingDate: { lte: fromIso(range.to) } }],
        ...(stores ? { AND: [{ OR: [{ storeId: null }, { storeId: { in: stores } }] }] } : {}),
      },
      select: billSelect,
    });
    const gstins = await this.supplierGstins([...new Set(bills.map((b) => b.supplier.id))]);
    const books: BookDocument[] = [];
    for (const b of bills) {
      if (regOf(b) !== upload.gstRegistrationId) continue;
      const gstin = gstins.get(b.supplier.id);
      if (!gstin) continue; // unregistered suppliers never appear in the statement
      const row = this.registerRow(b, gstin);
      books.push({
        id: b.id,
        ourNumber: b.number,
        supplierGstin: gstin,
        supplierName: b.supplier.name,
        kind: b.kind === 'debit_note' ? 'note' : 'invoice',
        number: b.supplierBillNo,
        date: row.supplierBillDate,
        taxable: row.taxable,
        igst: row.igst,
        cgst: row.cgst,
        sgst: row.sgst,
        reverseCharge: b.reverseCharge,
        inPeriod: row.postingDate >= range.from && row.postingDate <= range.to,
      });
    }
    const rows = matchInward(statement.documents, books);
    const order = { value_difference: 0, only_portal: 1, only_books: 2, matched: 3 } as const;
    rows.sort((a, b) => order[a.status] - order[b.status] || a.supplierGstin.localeCompare(b.supplierGstin) || a.number.localeCompare(b.number));
    return {
      upload: { id: upload.id, gstRegistrationId: upload.gstRegistrationId, gstin: statement.gstin, period: statement.period, fileName: upload.fileName, uploadedAt: upload.createdAt },
      summary: matchSummary(rows),
      rows,
    };
  }
}
