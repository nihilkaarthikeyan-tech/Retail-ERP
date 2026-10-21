// Copyright (c) 2026, Rademics. All rights reserved.
// Till set-up: GST rate list, payment methods, tills, till computers, settings.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CurrentUser,
  Decimal,
  type GstRateInput,
  hasPermission,
  PAYMENT_ACCOUNT_ROLES,
  priceBandProblem,
  type PaymentMethodInput,
  type PosSettingsInput,
  type RegisterDeviceInput,
  type StoreDeliveryChargesInput,
  type TillInput,
  type UpdatePaymentMethodInput,
  type UpdateTillInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { GstRate, PaymentMethod, Store } from '../generated/prisma/client.js';
import { ensureGstSettings, rateRow } from '../gst/gst-core.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ensurePosDefaults, fromIso, iso, newToken, PosCommon, sha256 } from './pos-common.service.js';

@Injectable()
export class PosSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
  ) {}

  // ---- GST rate list ----

  async listGstRates() {
    const rows = await this.prisma.gstRate.findMany({ orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'desc' }] });
    return rows.map(gstDto);
  }

  async createGstRate(input: GstRateInput, actor: Actor) {
    const data = rateFields(input);
    await this.checkRateRow(null, { hsnCode: input.hsnCode, effectiveFrom: input.effectiveFrom, ...data });
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.gstRate.create({
        data: { hsnCode: input.hsnCode, rate: data.rate, cessRate: input.cessRate ?? '0', kind: data.kind, priceFrom: data.priceFrom, priceUpTo: data.priceUpTo, effectiveFrom: fromIso(input.effectiveFrom), note: input.note ?? null, createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'gst_rate', entityId: r.id, changes: { hsnCode: r.hsnCode, rate: r.rate.toString(), kind: r.kind, priceFrom: r.priceFrom?.toString() ?? null, priceUpTo: r.priceUpTo?.toString() ?? null, effectiveFrom: input.effectiveFrom } });
      return gstDto(r);
    });
  }

  /** Only before approval; an approved rate is changed by a new row with a later start date. */
  async updateGstRate(id: string, input: Partial<GstRateInput>, actor: Actor) {
    const before = await this.prisma.gstRate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('GST rate not found');
    if (before.approvedAt) throw new BadRequestException('An approved rate cannot be changed; add a new rate with a later start date');
    const merged = { rate: input.rate ?? before.rate.toString(), kind: input.kind ?? before.kind, priceFrom: input.priceFrom !== undefined ? input.priceFrom : (before.priceFrom?.toString() ?? null), priceUpTo: input.priceUpTo !== undefined ? input.priceUpTo : (before.priceUpTo?.toString() ?? null) };
    const data = rateFields(merged as GstRateInput);
    const effectiveFrom = input.effectiveFrom ?? iso(before.effectiveFrom)!;
    await this.checkRateRow(id, { hsnCode: before.hsnCode, effectiveFrom, ...data });
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.gstRate.update({
        where: { id },
        data: { rate: data.rate, kind: data.kind, priceFrom: data.priceFrom, priceUpTo: data.priceUpTo, cessRate: input.cessRate ?? undefined, effectiveFrom: input.effectiveFrom ? fromIso(input.effectiveFrom) : undefined, note: input.note !== undefined ? input.note : undefined, updatedById: actor.userId },
      });
      await this.audit.recordUpdate(tx, actor, 'gst_rate', id, gstDto(before), gstDto(after));
      return gstDto(after);
    });
  }

  /** Plan 08 G2: one plain rate per HSN code and date, or price bands that do not overlap. */
  private async checkRateRow(id: string | null, row: { hsnCode: string; effectiveFrom: string; rate: string; kind: string; priceFrom: string | null; priceUpTo: string | null }) {
    const others = (await this.prisma.gstRate.findMany({ where: { hsnCode: row.hsnCode, effectiveFrom: fromIso(row.effectiveFrom), ...(id ? { id: { not: id } } : {}) } })).map(rateRow);
    const banded = row.priceFrom !== null || row.priceUpTo !== null;
    if (!banded && others.length) throw new ConflictException(`HSN ${row.hsnCode} already has a rate starting ${row.effectiveFrom}`);
    if (banded && others.some((o) => o.priceFrom === null && o.priceUpTo === null)) throw new ConflictException(`HSN ${row.hsnCode} already has a plain rate starting ${row.effectiveFrom}; give it a price band too`);
    if (banded && others.some((o) => (o.priceFrom === null ? row.priceFrom === null : row.priceFrom !== null && new Decimal(o.priceFrom).eq(row.priceFrom)))) throw new ConflictException(`HSN ${row.hsnCode} already has a band from that price starting ${row.effectiveFrom}`);
    const problem = priceBandProblem([...others, { ...row }]);
    if (problem) throw new BadRequestException(problem);
  }

  async approveGstRate(id: string, actor: Actor) {
    const rate = await this.prisma.gstRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundException('GST rate not found');
    if (rate.approvedAt) throw new BadRequestException('Already approved');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.gstRate.update({ where: { id }, data: { approvedById: actor.userId, approvedAt: new Date() } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'gst_rate', entityId: id, changes: { approved: true, hsnCode: rate.hsnCode, rate: rate.rate.toString() } });
      return gstDto(after);
    });
  }

  // ---- Payment methods ----

  async listPaymentMethods() {
    const company = await this.common.currentCompany();
    await ensurePosDefaults(this.prisma, company.id);
    return (await this.prisma.paymentMethod.findMany({ where: { companyId: company.id }, orderBy: { code: 'asc' } })).map(methodDto);
  }

  async createPaymentMethod(input: PaymentMethodInput, actor: Actor) {
    const company = await this.common.currentCompany();
    if (await this.prisma.paymentMethod.findUnique({ where: { companyId_code: { companyId: company.id, code: input.code } } })) throw new ConflictException(`Payment method ${input.code} already exists`);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.paymentMethod.create({
        data: {
          companyId: company.id,
          code: input.code,
          name: input.name,
          kind: input.kind,
          allowRefund: input.allowRefund ?? true,
          needsReference: input.needsReference ?? input.kind !== 'cash',
          accountRole: PAYMENT_ACCOUNT_ROLES[input.kind],
          active: input.active ?? true,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'payment_method', entityId: m.id, changes: { code: m.code, kind: m.kind } });
      return methodDto(m);
    });
  }

  async updatePaymentMethod(id: string, input: UpdatePaymentMethodInput, actor: Actor) {
    const before = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Payment method not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.paymentMethod.update({
        where: { id },
        data: { ...input, ...(input.kind ? { accountRole: PAYMENT_ACCOUNT_ROLES[input.kind] } : {}), updatedById: actor.userId },
      });
      await this.audit.recordUpdate(tx, actor, 'payment_method', id, methodDto(before), methodDto(after));
      return methodDto(after);
    });
  }

  // ---- Tills ----

  async listTills(user: CurrentUser) {
    const company = await this.common.currentCompany();
    const tills = await this.prisma.till.findMany({
      where: { companyId: company.id, ...(user.allStores ? {} : { storeId: { in: user.stores.map((s) => s.id) } }) },
      include: { store: { select: { id: true, code: true, name: true } }, paymentMethods: true, devices: { where: { revokedAt: null } } },
      orderBy: [{ storeId: 'asc' }, { code: 'asc' }],
    });
    return tills.map((t) => tillDto(t));
  }

  async getTill(id: string, user: CurrentUser) {
    const t = await this.prisma.till.findUnique({ where: { id }, include: { store: { select: { id: true, code: true, name: true } }, paymentMethods: true, devices: { where: { revokedAt: null } } } });
    if (!t) throw new NotFoundException('Till not found');
    assertStoreAccess(user, t.storeId);
    return tillDto(t);
  }

  async createTill(input: TillInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.currentCompany();
    assertStoreAccess(user, input.storeId);
    return this.prisma.$transaction((tx) => this.createTillIn(tx, company.id, input, actor));
  }

  /** Shared with the guided setup (plan 12), which makes the first tills in its own transaction. */
  async createTillIn(tx: Db, companyId: string, input: TillInput, actor: Actor) {
    await this.checkTill(tx, companyId, input.storeId, input);
    if (await tx.till.findUnique({ where: { companyId_code: { companyId, code: input.code } } })) throw new ConflictException(`Till ${input.code} already exists`);
    const store = await tx.store.findUniqueOrThrow({ where: { id: input.storeId } });
    // Plan 08 (CGST rule 46(b)): bill numbers PREFIX/2627/000001 stay within 16 characters.
    if (input.numberPrefix && (await this.common.invoicePrefixTaken(tx, companyId, input.numberPrefix, null))) throw new ConflictException(`Invoice prefix ${input.numberPrefix} is used by another till`);
    const numberPrefix = input.numberPrefix ?? (await this.common.freeInvoicePrefix(tx, companyId, store.code, input.code, null));
    const t = await tx.till.create({
      data: {
        companyId,
        storeId: input.storeId,
        code: input.code,
        name: input.name,
        locationId: input.locationId,
        priceListId: input.priceListId,
        // Bill numbers: PREFIX/2627/000001, made by the till itself (pos-offline §3).
        seriesKind: numberPrefix,
        cashierDiscountPercent: input.cashierDiscountPercent ?? '5',
        allowPriceChange: input.allowPriceChange ?? false,
        autoPrint: input.autoPrint ?? true,
        receiptFooter: input.receiptFooter ?? null,
        active: input.active ?? true,
        paymentMethods: { create: input.paymentMethods.map((m) => ({ paymentMethodId: m.paymentMethodId, isDefault: !!m.isDefault })) },
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      include: { store: { select: { id: true, code: true, name: true } }, paymentMethods: true, devices: true },
    });
    await this.audit.record(tx, actor, { action: 'create', entityType: 'till', entityId: t.id, changes: { code: t.code, store: store.code } });
    return tillDto(t);
  }

  async updateTill(id: string, input: UpdateTillInput, actor: Actor, user: CurrentUser) {
    const before = await this.prisma.till.findUnique({ where: { id }, include: { store: { select: { id: true, code: true, name: true } }, paymentMethods: true, devices: { where: { revokedAt: null } } } });
    if (!before) throw new NotFoundException('Till not found');
    assertStoreAccess(user, before.storeId);
    await this.checkTill(this.prisma, before.companyId, before.storeId, { locationId: input.locationId ?? before.locationId, priceListId: input.priceListId ?? before.priceListId, paymentMethods: input.paymentMethods ?? before.paymentMethods });
    if (input.active === false && (await this.prisma.shift.count({ where: { tillId: id, status: 'open' } }))) throw new BadRequestException('A till with an open shift cannot be switched off');
    return this.prisma.$transaction(async (tx) => {
      if (input.paymentMethods) {
        await tx.tillPaymentMethod.deleteMany({ where: { tillId: id } });
        await tx.tillPaymentMethod.createMany({ data: input.paymentMethods.map((m) => ({ tillId: id, paymentMethodId: m.paymentMethodId, isDefault: !!m.isDefault })) });
      }
      const { paymentMethods: _pm, numberPrefix, ...rest } = input;
      void _pm;
      // Plan 08: a new invoice prefix starts a new series; one used by another till is never taken.
      if (numberPrefix && numberPrefix !== before.seriesKind && (await this.common.invoicePrefixTaken(tx, before.companyId, numberPrefix, id))) throw new ConflictException(`Invoice prefix ${numberPrefix} is used by another till`);
      const after = await tx.till.update({ where: { id }, data: { ...rest, ...(numberPrefix ? { seriesKind: numberPrefix } : {}), updatedById: actor.userId }, include: { store: { select: { id: true, code: true, name: true } }, paymentMethods: true, devices: { where: { revokedAt: null } } } });
      await this.audit.recordUpdate(tx, actor, 'till', id, tillDto(before), tillDto(after));
      return tillDto(after);
    });
  }

  private async checkTill(db: Db, companyId: string, storeId: string, input: { locationId: string; priceListId: string; paymentMethods: { paymentMethodId: string; isDefault?: boolean }[] }) {
    const loc = await db.stockLocation.findUnique({ where: { id: input.locationId } });
    if (!loc || loc.companyId !== companyId || loc.storeId !== storeId || loc.kind !== 'shelf' || !loc.active) throw new BadRequestException('The till must sell from an active shelf location of its store');
    const list = await db.priceList.findUnique({ where: { id: input.priceListId } });
    if (!list || !list.active || !list.forSelling) throw new BadRequestException('Choose an active selling price list');
    const methods = await db.paymentMethod.findMany({ where: { id: { in: input.paymentMethods.map((m) => m.paymentMethodId) }, companyId } });
    if (methods.length !== new Set(input.paymentMethods.map((m) => m.paymentMethodId)).size) throw new BadRequestException('Payment method not found');
    if (input.paymentMethods.filter((m) => m.isDefault).length !== 1) throw new BadRequestException('Choose exactly one default payment method');
  }

  /** Pairs a till computer; the token is shown once and stored only as a hash (pos-offline §9). */
  async registerDevice(tillId: string, input: RegisterDeviceInput, actor: Actor, user: CurrentUser) {
    const till = await this.common.usableTill(this.prisma, tillId, user);
    const token = newToken();
    return this.prisma.$transaction(async (tx) => {
      // One computer per till: an older registration stops working.
      await tx.tillDevice.updateMany({ where: { tillId, revokedAt: null }, data: { revokedAt: new Date() } });
      const d = await tx.tillDevice.create({ data: { tillId, deviceName: input.deviceName, tokenHash: sha256(token), registeredById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'till_device', entityId: d.id, changes: { till: till.code, deviceName: input.deviceName } });
      return { deviceId: d.id, token };
    });
  }

  // ---- Settings ----

  async getSettings() {
    const company = await this.common.currentCompany();
    return settingsDto(await ensurePosDefaults(this.prisma, company.id));
  }

  async updateSettings(input: PosSettingsInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.currentCompany();
    // Plan 06 answer 1: only the Owner switches tills live, and only once some rates are approved.
    if (input.liveAllowed !== undefined) {
      if (!user.isOwnerAdmin) throw new ForbiddenException('Only the Owner can switch the tills live');
      if (input.liveAllowed && !(await this.prisma.gstRate.count({ where: { approvedAt: { not: null } } }))) {
        throw new BadRequestException('No GST rate has been approved yet; the accountant approves the rates first');
      }
      // Plan 08 §5, 8.11: live billing needs the CA's approval of the GST settings.
      if (input.liveAllowed && !(await ensureGstSettings(this.prisma, company.id)).approvedAt) {
        throw new BadRequestException('The GST settings are not approved by the accountant yet; until then every bill is provisional and live billing stays off');
      }
    }
    // Plan 11 B4: the delivery charge is billed as a sellable service item (no stock).
    if (input.deliveryItemId) {
      const item = await this.prisma.item.findUnique({ where: { id: input.deliveryItemId } });
      if (!item || !item.active || !item.canSell) throw new BadRequestException('The delivery charge item must be an item in use that can be sold');
      if (item.isStockItem) throw new BadRequestException(`${item.code} is a stock item; the delivery charge needs a service item`);
      if (!item.hsnCode) throw new BadRequestException(`${item.code} needs an HSN (SAC) code so its GST rate is known`);
    }
    // Plan 11 part 2: the alteration charge too is a sellable service item.
    if (input.alterationItemId) {
      const item = await this.prisma.item.findUnique({ where: { id: input.alterationItemId } });
      if (!item || !item.active || !item.canSell) throw new BadRequestException('The alteration charge item must be an item in use that can be sold');
      if (item.isStockItem) throw new BadRequestException(`${item.code} is a stock item; the alteration charge needs a service item`);
      if (!item.hsnCode) throw new BadRequestException(`${item.code} needs an HSN (SAC) code so its GST rate is known`);
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await ensurePosDefaults(tx, company.id);
      const after = await tx.posSettings.update({ where: { companyId: company.id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'pos_settings', company.id, settingsDto(before), settingsDto(after));
      return settingsDto(after);
    });
  }

  // ---- Delivery charges per store (plan 11 B4, decision 47) ----

  async deliveryCharges(user: CurrentUser) {
    const company = await this.common.currentCompany();
    const own = allowedStoreIds(user);
    const stores = await this.prisma.store.findMany({ where: { companyId: company.id, active: true, ...(own ? { id: { in: own } } : {}) }, orderBy: { code: 'asc' } });
    return stores.map(chargesDto);
  }

  async updateDeliveryCharges(storeId: string, input: StoreDeliveryChargesInput, actor: Actor, user: CurrentUser) {
    assertStoreAccess(user, storeId);
    const before = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!before) throw new NotFoundException('Store not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.store.update({ where: { id: storeId }, data: { deliveryCharge: input.deliveryCharge, deliveryFreeAbove: input.deliveryFreeAbove ?? null, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'store', storeId, chargesDto(before), chargesDto(after));
      return chargesDto(after);
    });
  }

  canSetup(user: CurrentUser) {
    return hasPermission(user, 'pos.setup');
  }
}

/** Exempt and nil-rated rows carry no tax (rate 0); bands are kept as typed. */
function rateFields(input: Pick<GstRateInput, 'rate' | 'kind' | 'priceFrom' | 'priceUpTo'>) {
  const kind = input.kind ?? 'taxable';
  if (kind !== 'taxable' && Number(input.rate) !== 0) throw new BadRequestException('An exempt or nil-rated HSN code has a rate of 0');
  return { rate: input.rate, kind, priceFrom: input.priceFrom ?? null, priceUpTo: input.priceUpTo ?? null };
}

function gstDto(r: GstRate) {
  return { id: r.id, hsnCode: r.hsnCode, rate: r.rate.toString(), cessRate: r.cessRate.toString(), kind: r.kind, priceFrom: r.priceFrom?.toFixed(2) ?? null, priceUpTo: r.priceUpTo?.toFixed(2) ?? null, effectiveFrom: iso(r.effectiveFrom), approved: !!r.approvedAt, approvedAt: r.approvedAt, approvedById: r.approvedById, note: r.note };
}

function methodDto(m: PaymentMethod) {
  return { id: m.id, code: m.code, name: m.name, kind: m.kind, allowRefund: m.allowRefund, needsReference: m.needsReference, accountRole: m.accountRole, active: m.active };
}

function tillDto(t: {
  id: string;
  code: string;
  name: string;
  storeId: string;
  store: { id: string; code: string; name: string };
  locationId: string;
  priceListId: string;
  seriesKind: string;
  cashierDiscountPercent: { toString(): string };
  allowPriceChange: boolean;
  autoPrint: boolean;
  receiptFooter: string | null;
  active: boolean;
  paymentMethods: { paymentMethodId: string; isDefault: boolean }[];
  devices?: { id: string; deviceName: string; lastSeenAt: Date | null }[];
}) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    store: t.store,
    locationId: t.locationId,
    priceListId: t.priceListId,
    numberPrefix: t.seriesKind,
    cashierDiscountPercent: t.cashierDiscountPercent.toString(),
    allowPriceChange: t.allowPriceChange,
    autoPrint: t.autoPrint,
    receiptFooter: t.receiptFooter,
    active: t.active,
    paymentMethods: t.paymentMethods.map((m) => ({ paymentMethodId: m.paymentMethodId, isDefault: m.isDefault })),
    devices: (t.devices ?? []).map((d) => ({ id: d.id, deviceName: d.deviceName, lastSeenAt: d.lastSeenAt })),
  };
}

function settingsDto(s: { cashDifferenceApprovalAmount: { toFixed(n: number): string }; printReceiptCopies: number; liveAllowed: boolean; deliveryItemId: string | null; alterationItemId: string | null }) {
  return { cashDifferenceApprovalAmount: s.cashDifferenceApprovalAmount.toFixed(2), printReceiptCopies: s.printReceiptCopies, liveAllowed: s.liveAllowed, deliveryItemId: s.deliveryItemId, alterationItemId: s.alterationItemId };
}

function chargesDto(s: Store) {
  return { storeId: s.id, code: s.code, name: s.name, deliveryCharge: s.deliveryCharge.toFixed(2), deliveryFreeAbove: s.deliveryFreeAbove?.toFixed(2) ?? null };
}
