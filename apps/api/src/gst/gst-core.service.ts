// Copyright (c) 2026, Rademics. All rights reserved.
// GST common core on the server (plan 08 §2, §5): the company's GST settings
// with defaults, the CA's approval, the seller's registration for a store, the
// rate in force for an item (by HSN, date and selling price) and the place of
// supply of a document. Used by the till, the offline till snapshot,
// purchases and the GST reports; the rules themselves live in shared/gst-core.
import { BadRequestException, Injectable } from '@nestjs/common';
import { type DecimalInput, type GstApprovalInput, type GstSettingsInput, pickGstRate, resolveSupply, type Supply, type SupplyInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { GstRate, GstSettings, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);

/** The seller side of a document: the GST registration of the store (else the company's main one). */
export interface Seller {
  registrationId: string | null;
  gstin: string | null;
  stateCode: string;
}

/**
 * Idempotent: the company's GST settings, created with the defaults of plan 08
 * §5 (regular scheme, quarterly returns, up to ₹5 crore, 4-digit HSN, no
 * e-invoice, combined small sales on, tax table on receipts, ₹50,000 e-way limit).
 */
export async function ensureGstSettings(db: Db, companyId: string): Promise<GstSettings> {
  await db.gstSettings.createMany({ data: [{ companyId }], skipDuplicates: true });
  return db.gstSettings.findUniqueOrThrow({ where: { companyId } });
}

export function gstSettingsDto(s: GstSettings) {
  return {
    scheme: s.scheme,
    filingFrequency: s.filingFrequency,
    turnoverBand: s.turnoverBand,
    hsnDigits: s.hsnDigits,
    eInvoiceApplies: s.eInvoiceApplies,
    combineSmallSales: s.combineSmallSales,
    freeSampleTax: s.freeSampleTax,
    receiptTaxTable: s.receiptTaxTable,
    eWayLimit: s.eWayLimit.toFixed(2),
    eWayStateLimits: (s.eWayStateLimits ?? {}) as Record<string, string>,
    defaultTransporterId: s.defaultTransporterId,
    defaultTransporterName: s.defaultTransporterName,
    approved: !!s.approvedAt,
    approvedAt: s.approvedAt,
    approvedById: s.approvedById,
    approvalNote: s.approvalNote,
    updatedAt: s.updatedAt,
  };
}
export type GstSettingsDto = ReturnType<typeof gstSettingsDto>;

/** A rate row as the shared rules read it. */
export function rateRow(r: GstRate) {
  return {
    id: r.id,
    hsnCode: r.hsnCode,
    rate: r.rate.toString(),
    cessRate: r.cessRate.toString(),
    kind: r.kind,
    priceFrom: r.priceFrom?.toString() ?? null,
    priceUpTo: r.priceUpTo?.toString() ?? null,
    effectiveFrom: iso(r.effectiveFrom),
    approved: !!r.approvedAt,
  };
}

@Injectable()
export class GstCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  // ---- Settings (plan 08 §5) ----

  async settingsFor(db: Db, companyId: string): Promise<GstSettings> {
    return ensureGstSettings(db, companyId);
  }

  async getSettings() {
    const company = await this.company.current();
    return gstSettingsDto(await ensureGstSettings(this.prisma, company.id));
  }

  async updateSettings(input: GstSettingsInput, actor: Actor) {
    const company = await this.company.current();
    return this.prisma.$transaction(async (tx) => {
      const before = await ensureGstSettings(tx, company.id);
      const data: Prisma.GstSettingsUpdateInput = { ...input, eWayStateLimits: input.eWayStateLimits as Prisma.InputJsonValue | undefined, updatedById: actor.userId };
      const after = await tx.gstSettings.update({ where: { companyId: company.id }, data });
      const { updatedAt: _a, ...b } = gstSettingsDto(before);
      const { updatedAt: _b, ...a } = gstSettingsDto(after);
      await this.audit.recordUpdate(tx, actor, 'gst_settings', company.id, b, a);
      return gstSettingsDto(after);
    });
  }

  /** "GST settings approved by the CA" (plan 08 §5, 8.11): who, when and a note. */
  async approve(input: GstApprovalInput, actor: Actor) {
    const company = await this.company.current();
    return this.prisma.$transaction(async (tx) => {
      const before = await ensureGstSettings(tx, company.id);
      if (before.approvedAt) throw new BadRequestException('The GST settings are already approved');
      const after = await tx.gstSettings.update({ where: { companyId: company.id }, data: { approvedAt: new Date(), approvedById: actor.userId, approvalNote: input.note, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'gst_settings', entityId: company.id, changes: { approved: { old: false, new: true }, note: input.note, scheme: after.scheme, turnoverBand: after.turnoverBand } });
      return gstSettingsDto(after);
    });
  }

  /** Taking the approval back (for example when the CA asks for a change): bills are provisional again and live billing goes off. */
  async withdrawApproval(reason: string, actor: Actor) {
    const company = await this.company.current();
    return this.prisma.$transaction(async (tx) => {
      const before = await ensureGstSettings(tx, company.id);
      if (!before.approvedAt) throw new BadRequestException('The GST settings are not approved');
      const after = await tx.gstSettings.update({ where: { companyId: company.id }, data: { approvedAt: null, approvedById: null, updatedById: actor.userId } });
      await tx.posSettings.updateMany({ where: { companyId: company.id, liveAllowed: true }, data: { liveAllowed: false, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'gst_settings', entityId: company.id, changes: { approved: { old: true, new: false } }, reason });
      return gstSettingsDto(after);
    });
  }

  // ---- Seller and place of supply (G1, G3) ----

  /** The registration a store's documents are reported under, and its state. */
  async sellerFor(db: Db, storeId: string | null): Promise<Seller> {
    const store = storeId ? await db.store.findUnique({ where: { id: storeId }, include: { gstRegistration: true } }) : null;
    const companyId = store?.companyId ?? (await this.company.current(db)).id;
    const reg = store?.gstRegistration ?? (await db.gstRegistration.findFirst({ where: { companyId, active: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    return { registrationId: reg?.id ?? null, gstin: reg?.gstin ?? null, stateCode: reg?.stateCode ?? store?.stateCode ?? company.stateCode };
  }

  /** Place of supply, tax situation and invoice kind of a document (shared resolveSupply). */
  supply(input: SupplyInput): Supply {
    return resolveSupply(input);
  }

  // ---- Rates (G2, decision 56) ----

  /** Every row in force for an HSN code on a date (one plain rate, or one per price band). */
  async ratesFor(db: Db, hsnCode: string, date: string): Promise<GstRate[]> {
    const codes = [hsnCode.slice(0, 8), hsnCode.slice(0, 6), hsnCode.slice(0, 4)].filter((c, i, a) => c.length >= 4 && a.indexOf(c) === i);
    return db.gstRate.findMany({ where: { hsnCode: { in: codes }, effectiveFrom: { lte: fromIso(date) } } });
  }

  /**
   * The GST rate for an item on a date: the longest matching HSN code, the
   * latest start date on or before the date, and for price-banded codes the
   * band of the selling price per unit (GST included). Refuses when none is set.
   * Purchases: pass the price per unit the supplier charges (GST included) or none.
   */
  async rateFor(db: Db, item: { code: string; hsnCode: string | null }, date: string, unitPrice?: DecimalInput | null): Promise<GstRate> {
    if (!item.hsnCode) throw new BadRequestException(`${item.code} has no HSN code, so its GST rate is not known`);
    const rows = await this.ratesFor(db, item.hsnCode, date);
    const picked = pickGstRate(
      rows.map((r) => ({ ...rateRow(r), row: r })),
      item.hsnCode,
      date,
      unitPrice,
    );
    if (!picked) throw new BadRequestException(`No GST rate is set for HSN ${item.hsnCode} (${item.code}); add it to the GST rate list`);
    return picked.row;
  }
}
