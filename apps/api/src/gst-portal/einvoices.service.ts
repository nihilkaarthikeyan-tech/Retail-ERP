// Copyright (c) 2026, Rademics. All rights reserved.
// E-invoices as portal files (plan 08 §4; decisions 57 and 63; scenario 8.10).
// When the company must e-invoice, every business invoice from the till and
// every credit note against one gets an e-invoice row, "waiting". The rows are
// exported as the e-invoice portal's bulk JSON, the portal's answer file is
// imported to attach the reference number (IRN), acknowledgement and signed QR
// code ("registered") or the errors ("failed"). Cancelling is allowed within 24
// hours of registration; after that a credit note is needed. Since audit 4 (28 October
// 2026) transfers to a store under another GSTIN are e-invoiced too ("stock_document").
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  buildEInvoiceJson,
  businessDate,
  type CurrentUser,
  Decimal,
  EINVOICE_CANCEL_REASONS,
  eInvoiceCancellable,
  type EInvoiceCancelInput,
  type EInvoiceExportInput,
  eInvoiceLastDay,
  type EInvoiceManualInput,
  eInvoiceNearLimit,
  eInvoiceProblems,
  type EInvoiceQuery,
  type EInvoiceSource,
  encodeQr,
  parseEInvoiceResults,
  parsePortalDateTime,
  PORTAL_UPLOAD_MAX_BYTES,
  qrSvgPath,
  stringifyPortalJson,
  THIRTY_DAY_BANDS,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds, canAccessStore } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { EInvoice, Prisma } from '../generated/prisma/client.js';
import { ensureGstSettings } from '../gst/gst-core.service.js';
import { TransferGstService } from '../inventory/transfer-gst.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { eInvoiceSourceOf, eInvoiceSourceOfTransfer, isoDay, sellerOf } from './portal-sources.js';

const D = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : '0');

/** An instant as Indian date and time, "2026-10-18 15:18". */
export const istDateTime = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ') : '');

/** Shown on prints and screens until the portal has registered the invoice. */
export const NOT_REGISTERED_NOTICE = 'E-invoice not yet registered on the government portal: this is not a valid tax invoice until the reference number (IRN) and QR code are printed on it.';

/**
 * Audit 4 (28 October 2026): true when the document has an IRN registered on the portal and not
 * cancelled. A bill with a live IRN must not be cancelled in the shop alone: cancel the IRN on the
 * portal first (within 24 hours), or make a credit note (a return). Called by the till's bill cancel.
 */
export { hasLiveIrn } from '../common/live-irn.js';

/** Facts about the document behind an e-invoice row (a till bill or a transfer between GSTINs). */
interface DocFacts {
  storeId: string;
  date: string;
  typ: 'INV' | 'CRN';
  total: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  cancelled: boolean;
}

export interface PrintQr {
  label: string;
  /** SVG path of the dark modules, one unit per module. */
  path: string;
  /** Modules per side, without the quiet zone. */
  size: number;
}

@Injectable()
export class EInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly transferGst: TransferGstService,
  ) {}

  /** Audit 4 (28 October 2026): store, date, type and buyer of each document, for bills and transfers alike. */
  private async docFacts(db: Db, rows: { documentType: string; documentId: string }[]): Promise<Map<string, DocFacts>> {
    const out = new Map<string, DocFacts>();
    const billIds = rows.filter((r) => r.documentType === 'pos_bill').map((r) => r.documentId);
    const bills = billIds.length
      ? await db.posBill.findMany({
          where: { id: { in: billIds } },
          select: { id: true, kind: true, businessDate: true, total: true, buyerName: true, buyerGstin: true, status: true, returnOf: { select: { buyerName: true, buyerGstin: true } }, till: { select: { storeId: true } } },
        })
      : [];
    for (const b of bills) {
      out.set(b.id, {
        storeId: b.till.storeId,
        date: isoDay(b.businessDate)!,
        typ: b.kind === 'return' ? 'CRN' : 'INV',
        total: D(b.total).abs().toFixed(2),
        buyerName: b.buyerName ?? b.returnOf?.buyerName ?? null,
        buyerGstin: b.buyerGstin ?? b.returnOf?.buyerGstin ?? null,
        cancelled: b.status === 'cancelled',
      });
    }
    for (const r of rows.filter((x) => x.documentType === 'stock_document')) {
      const t = await eInvoiceSourceOfTransfer(db, r.documentId, this.transferGst).catch(() => null);
      if (t) out.set(r.documentId, { storeId: t.document.storeId, date: t.document.date, typ: 'INV', total: D(t.source.total).toFixed(2), buyerName: t.source.buyer.legalName, buyerGstin: t.source.buyer.gstin || null, cancelled: t.document.cancelled });
    }
    return out;
  }

  /** The e-invoice source of a row's document (a till bill or a transfer between GSTINs). */
  private async sourceOf(db: Db, documentType: string, documentId: string): Promise<{ storeId: string; source: EInvoiceSource }> {
    if (documentType === 'stock_document') {
      const t = await eInvoiceSourceOfTransfer(db, documentId, this.transferGst);
      if (!t) throw new BadRequestException('This transfer is not on a tax invoice, so it needs no e-invoice');
      return { storeId: t.document.storeId, source: t.source };
    }
    const { bill, source } = await eInvoiceSourceOf(db, documentId);
    return { storeId: bill.till.storeId, source };
  }

  // ---- Keeping the list complete ----

  /**
   * Adds a "waiting" e-invoice for every business invoice (and credit note against one)
   * that has none yet, when e-invoicing applies; trial bills before the go-live date are
   * left out. Waiting or failed ones whose bill was cancelled need no registration.
   * Safe to run at any time and by two people at once (skip-duplicate inserts).
   */
  async sync(db: Db = this.prisma): Promise<void> {
    const company = await this.company.current(db);
    const settings = await ensureGstSettings(db, company.id);
    if (settings.eInvoiceApplies) {
      const bills = await db.posBill.findMany({
        where: {
          companyId: company.id,
          status: 'completed',
          ...(company.goLiveDate ? { businessDate: { gte: company.goLiveDate } } : {}),
          OR: [{ invoiceKind: 'business' }, { returnOf: { is: { invoiceKind: 'business' } } }],
        },
        select: { id: true, number: true, gstRegistrationId: true, till: { select: { storeId: true } } },
      });
      const have = new Set((await db.eInvoice.findMany({ where: { documentType: 'pos_bill', documentId: { in: bills.map((b) => b.id) } }, select: { documentId: true } })).map((e) => e.documentId));
      const rows: Prisma.EInvoiceCreateManyInput[] = [];
      for (const b of bills.filter((x) => !have.has(x.id))) {
        const seller = await sellerOf(db, b.till.storeId, b.gstRegistrationId);
        if (seller.registrationId) rows.push({ companyId: company.id, gstRegistrationId: seller.registrationId, documentType: 'pos_bill', documentId: b.id, documentNumber: b.number });
      }
      // Audit 4 (28 October 2026): a transfer to a store under another GSTIN is a tax invoice between
      // distinct persons (CGST Act s.25(4)), so it is e-invoiced like a business invoice from the till.
      const transfers = await db.stockDocument.findMany({
        where: { companyId: company.id, kind: 'transfer_send', status: 'finalised', toStoreId: { not: null }, ...(company.goLiveDate ? { postingDate: { gte: company.goLiveDate } } : {}) },
        select: { id: true, number: true, storeId: true, toStoreId: true },
      });
      const haveTransfers = new Set((await db.eInvoice.findMany({ where: { documentType: 'stock_document', documentId: { in: transfers.map((t) => t.id) } }, select: { documentId: true } })).map((e) => e.documentId));
      for (const t of transfers.filter((x) => !haveTransfers.has(x.id))) {
        const regs = await this.transferGst.registrations(db, t.storeId, t.toStoreId);
        if (!regs) continue;
        // Only a tax invoice: not a bill of supply (composition) nor a transfer sent before values were frozen.
        const invoice = await eInvoiceSourceOfTransfer(db, t.id, this.transferGst).catch(() => null);
        if (invoice) rows.push({ companyId: company.id, gstRegistrationId: regs.from.id, documentType: 'stock_document', documentId: t.id, documentNumber: t.number });
      }
      if (rows.length) await db.eInvoice.createMany({ data: rows, skipDuplicates: true });
    }
    const open = await db.eInvoice.findMany({ where: { companyId: company.id, status: { in: ['waiting', 'failed'] } }, select: { id: true, documentType: true, documentId: true } });
    const cancelledBills = new Set((await db.posBill.findMany({ where: { id: { in: open.filter((o) => o.documentType === 'pos_bill').map((o) => o.documentId) }, status: 'cancelled' }, select: { id: true } })).map((b) => b.id));
    const cancelledTransfers = new Set((await db.stockDocument.findMany({ where: { id: { in: open.filter((o) => o.documentType === 'stock_document').map((o) => o.documentId) }, status: 'cancelled' }, select: { id: true } })).map((d) => d.id));
    const done = open.filter((o) => cancelledBills.has(o.documentId) || cancelledTransfers.has(o.documentId)).map((o) => o.id);
    if (done.length) await db.eInvoice.updateMany({ where: { id: { in: done }, status: { in: ['waiting', 'failed'] } }, data: { status: 'cancelled', cancelledAt: new Date(), error: 'The document was cancelled before registration' } });
  }

  // ---- Lists ----

  async list(q: EInvoiceQuery, user: CurrentUser) {
    await this.sync();
    const company = await this.company.current();
    const settings = await ensureGstSettings(this.prisma, company.id);
    const where: Prisma.EInvoiceWhereInput = {
      companyId: company.id,
      ...(q.status && q.status !== 'near_limit' ? { status: q.status } : {}),
      ...(q.status === 'near_limit' ? { status: { in: ['waiting', 'failed'] } } : {}),
      ...(q.search ? { documentNumber: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.eInvoice.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 1000 });
    const dtos = await this.dtos(rows, settings.turnoverBand);
    const own = allowedStoreIds(user);
    const filtered = dtos.filter(
      (r) => (!own || own.includes(r.storeId)) && (!q.from || r.documentDate >= q.from) && (!q.to || r.documentDate <= q.to) && (q.status !== 'near_limit' || r.nearLimit),
    );
    const counts = { waiting: 0, registered: 0, failed: 0, cancelled: 0, near_limit: 0 };
    for (const r of filtered) {
      counts[r.status as keyof typeof counts] += 1;
      if (r.nearLimit) counts.near_limit += 1;
    }
    return { applies: settings.eInvoiceApplies, thirtyDayLimit: THIRTY_DAY_BANDS.includes(settings.turnoverBand), counts, rows: filtered.slice(0, 500) };
  }

  private async dtos(rows: EInvoice[], turnoverBand: string) {
    const facts = await this.docFacts(this.prisma, rows);
    const stores = new Map((await this.prisma.store.findMany({ select: { id: true, code: true } })).map((s) => [s.id, s.code]));
    const today = businessDate();
    const now = new Date();
    return rows.map((r) => {
      const b = facts.get(r.documentId);
      const documentDate = b?.date ?? businessDate(r.createdAt);
      return {
        id: r.id,
        documentType: r.documentType,
        documentId: r.documentId,
        documentNumber: r.documentNumber,
        documentKind: r.documentType === 'stock_document' ? 'Transfer invoice' : b?.typ === 'CRN' ? 'Credit note' : 'Invoice',
        documentDate,
        storeId: b?.storeId ?? '',
        store: b ? (stores.get(b.storeId) ?? null) : null,
        buyerName: b?.buyerName ?? null,
        buyerGstin: b?.buyerGstin ?? null,
        total: b?.total ?? null,
        billCancelled: !!b?.cancelled,
        status: r.status,
        irn: r.irn,
        ackNumber: r.ackNumber,
        ackDate: r.ackDate,
        error: r.error,
        exportedAt: r.exportedAt,
        registeredAt: r.registeredAt,
        cancelledAt: r.cancelledAt,
        lastDay: THIRTY_DAY_BANDS.includes(turnoverBand) ? eInvoiceLastDay(documentDate) : null,
        nearLimit: eInvoiceNearLimit({ status: r.status, documentDate, today, turnoverBand }),
        canCancel: r.status === 'registered' && eInvoiceCancellable(r.registeredAt, now),
      };
    });
  }

  private async getRow(id: string, user: CurrentUser): Promise<EInvoice> {
    const row = await this.prisma.eInvoice.findUnique({ where: { id } });
    const company = await this.company.current();
    if (!row || row.companyId !== company.id) throw new NotFoundException('E-invoice not found');
    const doc = (await this.docFacts(this.prisma, [row])).get(row.documentId);
    if (doc && !canAccessStore(user, doc.storeId)) throw new ForbiddenException('You are not allowed to work in this store');
    return row;
  }

  // ---- Export: the portal's bulk upload file (an array of invoices) ----

  async exportFile(input: EInvoiceExportInput, actor: Actor, user: CurrentUser) {
    await this.sync();
    const company = await this.company.current();
    const where: Prisma.EInvoiceWhereInput = input.ids?.length ? { companyId: company.id, id: { in: input.ids } } : { companyId: company.id, status: 'waiting' };
    const rows = await this.prisma.eInvoice.findMany({ where, orderBy: { createdAt: 'asc' }, take: input.ids?.length ? undefined : 200 });
    if (!rows.length) throw new BadRequestException('There are no e-invoices waiting to be registered');
    const invoices: Record<string, unknown>[] = [];
    const included: string[] = [];
    const skipped: { id: string; documentNumber: string; problems: string[] }[] = [];
    let gstin: string | null = null;
    for (const r of rows) {
      if (r.status === 'registered' || r.status === 'cancelled') {
        skipped.push({ id: r.id, documentNumber: r.documentNumber, problems: [`Already ${r.status}`] });
        continue;
      }
      const { storeId, source } = await this.sourceOf(this.prisma, r.documentType, r.documentId);
      if (!canAccessStore(user, storeId)) throw new ForbiddenException('You are not allowed to work in this store');
      const problems = eInvoiceProblems(source);
      if (gstin && source.seller.gstin !== gstin) problems.push(`One file is for one GSTIN; this invoice is under ${source.seller.gstin}, export it separately`);
      if (problems.length) {
        skipped.push({ id: r.id, documentNumber: r.documentNumber, problems });
        continue;
      }
      gstin = source.seller.gstin;
      invoices.push(buildEInvoiceJson(source));
      included.push(r.id);
    }
    if (!invoices.length) return { fileName: null, content: null, count: 0, skipped };
    const content = stringifyPortalJson(invoices);
    if (Buffer.byteLength(content) > PORTAL_UPLOAD_MAX_BYTES) throw new BadRequestException('The file would be larger than the portal’s 1 MB upload limit; choose fewer invoices');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.eInvoice.updateMany({ where: { id: { in: included } }, data: { exportedAt: now, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'export', entityType: 'e_invoice', changes: { count: included.length, documents: rows.filter((r) => included.includes(r.id)).map((r) => r.documentNumber), gstin } });
    });
    return { fileName: `e-invoices-${gstin}-${businessDate(now)}.json`, content, count: included.length, skipped };
  }

  // ---- Import: the portal's answer (JSON or CSV) ----

  async importResults(file: { buffer: Buffer; originalname?: string } | undefined, actor: Actor, user: CurrentUser) {
    if (!file) throw new BadRequestException('Choose the file downloaded from the e-invoice portal');
    let results: ReturnType<typeof parseEInvoiceResults>;
    try {
      results = parseEInvoiceResults(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('This is not a JSON or CSV file from the e-invoice portal');
    }
    if (!results.length) throw new BadRequestException('No e-invoice results were found in the file');
    const company = await this.company.current();
    const summary = { registered: 0, failed: 0, cancelled: 0, unchanged: 0, unmatched: [] as string[], problems: [] as string[] };
    await this.prisma.$transaction(async (tx) => {
      for (const res of results) {
        const label = res.documentNumber ?? res.irn ?? '(no document number)';
        // Audit 4 (28 October 2026): the portal's key is seller GSTIN + document type + number + date, so
        // an answer is matched on all of them that the file gives, never on the number alone.
        const byIrn = res.irn ? await tx.eInvoice.findFirst({ where: { companyId: company.id, irn: res.irn } }) : null;
        let row = byIrn;
        if (!row && res.documentNumber) {
          const same = await tx.eInvoice.findMany({ where: { companyId: company.id, documentNumber: { equals: res.documentNumber, mode: 'insensitive' } } });
          const regs = new Map((await tx.gstRegistration.findMany({ where: { id: { in: same.map((x) => x.gstRegistrationId) } }, select: { id: true, gstin: true } })).map((g) => [g.id, g.gstin]));
          const facts = await this.docFacts(tx, same);
          const fits = same.filter((x) => {
            const f = facts.get(x.documentId);
            return (!res.sellerGstin || regs.get(x.gstRegistrationId)?.toUpperCase() === res.sellerGstin) && (!res.documentType || f?.typ === res.documentType) && (!res.documentDate || f?.date === res.documentDate);
          });
          if (fits.length > 1) {
            summary.problems.push(`${label}: more than one invoice has this number; the file must give the seller GSTIN, document type and date`);
            continue;
          }
          row = fits[0] ?? null;
        }
        if (!row) {
          summary.unmatched.push(label);
          continue;
        }
        const doc = (await this.docFacts(tx, [row])).get(row.documentId);
        if (doc && !canAccessStore(user, doc.storeId)) {
          summary.problems.push(`${row.documentNumber}: you are not allowed to work in its store`);
          continue;
        }
        const before = { status: row.status, irn: row.irn, ackNumber: row.ackNumber, error: row.error };
        let data: Prisma.EInvoiceUpdateInput | null = null;
        if (res.outcome === 'registered') {
          if (!res.irn || !/^[0-9a-fA-F]{64}$/.test(res.irn) || !res.ackNumber || !res.signedQr) {
            summary.problems.push(`${row.documentNumber}: the file has no complete IRN, acknowledgement number and signed QR code`);
            continue;
          }
          if (row.status === 'registered' && row.irn === res.irn) {
            summary.unchanged += 1;
            continue;
          }
          if (row.status === 'registered' || row.status === 'cancelled') {
            summary.problems.push(`${row.documentNumber}: already ${row.status} with another reference number`);
            continue;
          }
          data = { status: 'registered', irn: res.irn, ackNumber: res.ackNumber, ackDate: res.ackDate, signedQr: res.signedQr, error: null, registeredAt: res.ackDate ?? new Date() };
          summary.registered += 1;
        } else if (res.outcome === 'failed') {
          // A later error (for example "duplicate IRN") never undoes a registration.
          if (row.status !== 'waiting' && row.status !== 'failed') {
            summary.unchanged += 1;
            continue;
          }
          data = { status: 'failed', error: (res.error ?? 'Refused by the portal').slice(0, 1000) };
          summary.failed += 1;
        } else {
          if (row.status === 'cancelled') {
            summary.unchanged += 1;
            continue;
          }
          data = { status: 'cancelled', cancelledAt: res.cancelledAt ?? new Date() };
          summary.cancelled += 1;
        }
        await tx.eInvoice.update({ where: { id: row.id }, data: { ...data, updatedById: actor.userId } });
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'e_invoice',
          entityId: row.id,
          changes: { document: row.documentNumber, file: file.originalname ?? null, status: { old: before.status, new: data.status as string }, irn: { old: before.irn, new: (data.irn as string | undefined) ?? before.irn }, error: (data.error as string | null | undefined) ?? null },
        });
      }
    });
    return summary;
  }

  /** The reference number and QR typed or pasted from the portal by hand, for one invoice. */
  async enterManually(id: string, input: EInvoiceManualInput, actor: Actor, user: CurrentUser) {
    const row = await this.getRow(id, user);
    if (row.status === 'registered' || row.status === 'cancelled') throw new BadRequestException(`This e-invoice is already ${row.status}`);
    const ackDate = parsePortalDateTime(input.ackDate);
    if (!ackDate) throw new BadRequestException('The acknowledgement date is not a date');
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.eInvoice.updateMany({
        where: { id, status: { in: ['waiting', 'failed'] } },
        data: { status: 'registered', irn: input.irn.toLowerCase(), ackNumber: input.ackNumber, ackDate, signedQr: input.signedQr, registeredAt: ackDate, error: null, updatedById: actor.userId },
      });
      if (done.count !== 1) throw new BadRequestException('This e-invoice was changed by someone else; open it again');
      await this.audit.record(tx, actor, { action: 'update', entityType: 'e_invoice', entityId: id, changes: { document: row.documentNumber, status: { old: row.status, new: 'registered' }, irn: input.irn, by: 'typed in' } });
    });
    return this.one(id, user);
  }

  /** Puts a failed e-invoice back in the queue after the bill or customer was corrected. */
  async retry(id: string, actor: Actor, user: CurrentUser) {
    const row = await this.getRow(id, user);
    if (row.status !== 'failed') throw new BadRequestException('Only a failed e-invoice can be tried again');
    await this.prisma.$transaction(async (tx) => {
      await tx.eInvoice.update({ where: { id }, data: { status: 'waiting', error: null, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'e_invoice', entityId: id, changes: { document: row.documentNumber, status: { old: 'failed', new: 'waiting' }, error: row.error } });
    });
    return this.one(id, user);
  }

  /**
   * Records a cancellation made on the portal. The portal allows it within 24 hours of
   * registration only; after that the invoice stays and a credit note is needed.
   */
  async cancel(id: string, input: EInvoiceCancelInput, actor: Actor, user: CurrentUser) {
    const row = await this.getRow(id, user);
    if (row.status === 'cancelled') throw new BadRequestException('This e-invoice is already cancelled');
    const at = input.cancelledAt ? new Date(input.cancelledAt) : new Date();
    if (row.status === 'registered' && !eInvoiceCancellable(row.registeredAt, at)) {
      throw new BadRequestException('More than 24 hours have passed since the invoice was registered, so the portal no longer allows cancelling it. Make a credit note (a return against the invoice) instead.');
    }
    // Audit 4 (28 October 2026), official cancel-IRN page: an IRN cannot be cancelled while a valid
    // (active) e-way bill exists for it. A generated one with only Part A has no end date yet and is active.
    if (row.status === 'registered') {
      const eway = await this.prisma.eWayBill.findFirst({ where: { documentType: row.documentType, documentId: row.documentId, status: 'generated', OR: [{ validUntil: null }, { validUntil: { gte: at } }] } });
      if (eway) throw new BadRequestException(`${eway.number ? `E-way bill ${eway.number}` : 'An e-way bill'} is still valid for ${row.documentNumber}. The portal does not allow cancelling the IRN while it is: cancel the e-way bill first, then the IRN.`);
    }
    const reason = `${EINVOICE_CANCEL_REASONS[input.reason]}${input.remark ? `: ${input.remark}` : ''}`;
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.eInvoice.updateMany({ where: { id, status: row.status }, data: { status: 'cancelled', cancelledAt: at, updatedById: actor.userId } });
      if (done.count !== 1) throw new BadRequestException('This e-invoice was changed by someone else; open it again');
      await this.audit.record(tx, actor, { action: 'update', entityType: 'e_invoice', entityId: id, changes: { document: row.documentNumber, status: { old: row.status, new: 'cancelled' }, irn: row.irn }, reason });
    });
    // Audit 4: without its IRN the bill is no longer a valid tax invoice, so the shop must cancel it too (or make a return).
    const message =
      row.status === 'registered'
        ? `The IRN of ${row.documentNumber} is cancelled. Without an IRN this ${row.documentType === 'stock_document' ? 'transfer invoice' : 'bill'} is not a valid tax invoice: now cancel the ${row.documentType === 'stock_document' ? 'transfer' : 'bill'} itself in the shop (or make a return against it).`
        : `The e-invoice of ${row.documentNumber} is cancelled; it was never registered on the portal.`;
    return { ...(await this.one(id, user)), message };
  }

  async one(id: string, user: CurrentUser) {
    const row = await this.getRow(id, user);
    const company = await this.company.current();
    const settings = await ensureGstSettings(this.prisma, company.id);
    const [dto] = await this.dtos([row], settings.turnoverBand);
    return { ...dto, signedQr: row.signedQr, gstRegistrationId: row.gstRegistrationId };
  }

  /** The e-invoice of a document, for the bill screens and prints (null when e-invoicing does not apply to it). */
  async forDocument(documentType: string, documentId: string): Promise<EInvoice | null> {
    await this.sync();
    return this.prisma.eInvoice.findUnique({ where: { documentType_documentId: { documentType, documentId } } });
  }

  /** The QR drawing of a signed QR code. */
  static qr(signedQr: string): PrintQr {
    const code = encodeQr(signedQr);
    return { label: 'e-invoice QR code', path: qrSvgPath(code), size: code.size };
  }

  // ---- On the printed tax invoice (the print service's "pos_bill" print) ----

  /**
   * What the printed invoice shows about its e-invoice: "not yet registered" until the
   * portal's answer is imported, then the IRN, acknowledgement and the signed QR code.
   * Empty for bills that need no e-invoice.
   */
  async printBlock(billId: string, documentType: 'pos_bill' | 'stock_document' = 'pos_bill'): Promise<{ details: [string, string][]; notice: string | null; qr: PrintQr | null }> {
    const e = await this.forDocument(documentType, billId);
    if (!e) return { details: [], notice: null, qr: null };
    if (e.status === 'registered') {
      return {
        details: [
          ['IRN', e.irn ?? ''],
          ['Ack. no.', e.ackNumber ?? ''],
          ['Ack. date', istDateTime(e.ackDate)],
        ],
        notice: null,
        qr: e.signedQr ? EInvoicesService.qr(e.signedQr) : null,
      };
    }
    if (e.status === 'cancelled') return { details: [['E-invoice', `Cancelled${e.cancelledAt ? ` on ${istDateTime(e.cancelledAt)}` : ''}`]], notice: null, qr: null };
    return { details: [['E-invoice', e.status === 'failed' ? 'Not yet registered (refused by the portal; being corrected)' : 'Not yet registered']], notice: NOT_REGISTERED_NOTICE, qr: null };
  }
}
