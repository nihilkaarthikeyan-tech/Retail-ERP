// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { businessDate, type CreateSupplierInput, type CurrentUser, gstinStateCode, hasPermission, panFromGstin, type SupplierHoldInput, type SupplierQuery, type UpdateSupplierInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Prisma, Supplier } from '../generated/prisma/client.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from './contacts.service.js';
import { PartyMastersService } from './party-masters.service.js';
import { PartySettingsService, SUPPLIER_NUMBER_SERIES } from './party-settings.service.js';

export const supplierInclude = {
  supplierGroup: { select: { id: true, code: true, name: true } },
  priceList: { select: { id: true, code: true, name: true } },
  paymentTerms: { select: { id: true, code: true, name: true } },
  linkedCustomers: { select: { id: true, code: true, name: true } },
} satisfies Prisma.SupplierInclude;
export type SupplierRow = Prisma.SupplierGetPayload<{ include: typeof supplierInclude }>;

const date = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly numbering: NumberingService,
    private readonly masters: PartyMastersService,
    private readonly settings: PartySettingsService,
    private readonly contacts: ContactsService,
  ) {}

  async list(q: SupplierQuery) {
    const company = await this.company.current();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.SupplierWhereInput = {
      companyId: company.id,
      ...(q.groupId ? { supplierGroupId: q.groupId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.transporters ? { isTransporter: q.transporters === 'true' } : {}),
      ...(q.search
        ? { OR: [{ code: { contains: q.search.toUpperCase() } }, { name: { contains: q.search, mode: 'insensitive' } }, { mobile: { contains: q.search } }, { gstin: { contains: q.search.toUpperCase() } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, include: supplierInclude, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.supplier.count({ where }),
    ]);
    return { rows: rows.map(toSupplierDto), total, page, pageSize };
  }

  async getRow(db: Db, id: string): Promise<SupplierRow> {
    const supplier = await db.supplier.findUnique({ where: { id }, include: supplierInclude });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async get(id: string) {
    const supplier = await this.getRow(this.prisma, id);
    const [addresses, contacts] = await Promise.all([this.contacts.listAddresses('supplier', id), this.contacts.listContacts('supplier', id)]);
    return { ...toSupplierDto(supplier), addresses, contacts };
  }

  async create(input: CreateSupplierInput, actor: Actor) {
    const company = await this.company.current();
    const settings = await this.settings.get();
    const groupId = input.supplierGroupId ?? settings.defaultSupplierGroupId;
    if (!groupId) throw new BadRequestException('Choose a supplier group');
    const group = await this.masters.assertLeafSupplierGroup(this.prisma, groupId);
    const { stateCode, pan } = this.checkTax(input.gstin ?? null, input.pan ?? null, input.stateCode ?? null);
    await this.checkRefs(input);
    if (input.code && (await this.prisma.supplier.findUnique({ where: { code: input.code } }))) throw new ConflictException(`Supplier code ${input.code} already exists`);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = input.code ?? (await this.numbering.allocate(tx, { companyId: company.id, documentKind: SUPPLIER_NUMBER_SERIES.documentKind }));
      const supplier = await tx.supplier.create({
        data: {
          companyId: company.id,
          code,
          name: input.name,
          isBusiness: input.isBusiness ?? true,
          mobile: input.mobile ?? null,
          email: input.email ?? null,
          notes: input.notes ?? null,
          supplierGroupId: group.id,
          isTransporter: input.isTransporter ?? false,
          gstin: input.gstin ?? null,
          pan,
          stateCode,
          priceListId: input.priceListId ?? group.priceListId,
          paymentTermsId: input.paymentTermsId ?? group.paymentTermsId ?? settings.defaultPaymentTermsId,
          bankAccountNote: input.bankAccountNote ?? null,
          allowBillWithoutOrder: input.allowBillWithoutOrder ?? false,
          allowBillWithoutReceipt: input.allowBillWithoutReceipt ?? false,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: supplierInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'supplier', entityId: supplier.id, changes: { code: supplier.code, name: supplier.name, group: group.code, gstin: supplier.gstin } });
      if (input.linkedCustomerId) await this.linkCustomer(tx, supplier.id, input.linkedCustomerId, actor);
      if (input.mobile || input.email) {
        await this.contacts.createContactIn(tx, 'supplier', supplier.id, { name: input.name, mobile: input.mobile ?? null, email: input.email ?? null, isMain: true }, actor);
      }
      if (input.address) await this.contacts.createAddressIn(tx, 'supplier', supplier.id, { ...input.address, isMain: true }, actor);
      return tx.supplier.findUniqueOrThrow({ where: { id: supplier.id }, include: supplierInclude });
    });
    return toSupplierDto(created);
  }

  /**
   * The customer↔supplier link (decision 25) is stored once, on the customer.
   * Linking from the supplier side points that customer at this supplier;
   * null removes every customer link to this supplier.
   */
  private async linkCustomer(tx: Db, supplierId: string, customerId: string | null, actor: Actor): Promise<void> {
    const current = await tx.customer.findMany({ where: { linkedSupplierId: supplierId }, select: { id: true, code: true } });
    const keep = current.filter((c) => c.id === customerId);
    for (const c of current.filter((c) => c.id !== customerId)) {
      await tx.customer.update({ where: { id: c.id }, data: { linkedSupplierId: null, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'customer', entityId: c.id, changes: { linkedSupplierId: { old: supplierId, new: null } } });
    }
    if (customerId && keep.length === 0) {
      const before = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      await tx.customer.update({ where: { id: customerId }, data: { linkedSupplierId: supplierId, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'customer', entityId: customerId, changes: { linkedSupplierId: { old: before.linkedSupplierId, new: supplierId } } });
    }
  }

  async update(id: string, input: UpdateSupplierInput, actor: Actor) {
    const before = await this.getRow(this.prisma, id);
    const tax =
      input.gstin !== undefined || input.pan !== undefined || input.stateCode !== undefined
        ? this.checkTax(input.gstin === undefined ? before.gstin : input.gstin, input.pan === undefined ? before.pan : input.pan, input.stateCode === undefined ? before.stateCode : input.stateCode)
        : undefined;
    if (input.supplierGroupId && input.supplierGroupId !== before.supplierGroupId) await this.masters.assertLeafSupplierGroup(this.prisma, input.supplierGroupId);
    await this.checkRefs(input);
    const { linkedCustomerId, ...data } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id },
        data: { ...data, ...(tax ? { stateCode: tax.stateCode, pan: tax.pan } : {}), updatedById: actor.userId },
      });
      if (linkedCustomerId !== undefined) await this.linkCustomer(tx, id, linkedCustomerId, actor);
      const after = await tx.supplier.findUniqueOrThrow({ where: { id }, include: supplierInclude });
      await this.audit.recordUpdate(tx, actor, 'supplier', id, summarise(before), summarise(after));
      return after;
    });
    return toSupplierDto(updated);
  }

  /** suppliers.hold only: holds and status, always with a history row. */
  async setHold(id: string, input: SupplierHoldInput, actor: Actor) {
    const before = await this.getRow(this.prisma, id);
    if (input.holdUntil && input.holdUntil < businessDate()) throw new BadRequestException('The hold end date is already in the past');
    const holdType = input.holdType ?? before.holdType;
    // A new or removed hold starts afresh: an old end date or reason never carries over.
    const holdChanged = holdType !== before.holdType;
    const holdUntil =
      holdType === 'none' ? null : input.holdUntil !== undefined ? (input.holdUntil ? new Date(`${input.holdUntil}T00:00:00Z`) : null) : holdChanged ? null : undefined;
    const holdReason = holdType === 'none' ? null : input.holdReason !== undefined ? input.holdReason : holdChanged ? null : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.supplier.update({
        where: { id },
        data: { holdType, holdUntil, holdReason, status: input.status, updatedById: actor.userId },
        include: supplierInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'supplier', id, summarise(before), summarise(after), input.reason ?? input.holdReason ?? null);
      return after;
    });
    return toSupplierDto(updated);
  }

  // ---- Helpers for later modules ----

  /** The hold in force today, after automatic expiry. */
  effectiveHold(supplier: Pick<Supplier, 'holdType' | 'holdUntil'>, today = businessDate()): Supplier['holdType'] {
    if (supplier.holdType === 'none') return 'none';
    if (supplier.holdUntil && date(supplier.holdUntil)! < today) return 'none';
    return supplier.holdType;
  }

  /**
   * Throws unless the supplier may be used for a new order/bill or a payment.
   * Blocked suppliers need suppliers.hold; held suppliers are refused for what the hold covers.
   */
  async assertSupplierUsable(db: Db, id: string, purpose: 'bills' | 'payments', user: CurrentUser): Promise<Supplier> {
    const supplier = await db.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (supplier.status === 'off') throw new BadRequestException(`Supplier ${supplier.code} is switched off`);
    if (supplier.status === 'blocked' && !hasPermission(user, 'suppliers.hold')) {
      throw new ForbiddenException(`Supplier ${supplier.code} is blocked; only the trusted role may post for them`);
    }
    const hold = this.effectiveHold(supplier);
    if (hold === 'all' || hold === purpose) {
      const until = supplier.holdUntil ? ` until ${date(supplier.holdUntil)}` : '';
      throw new BadRequestException(`Supplier ${supplier.code} is on hold for ${hold === 'all' ? 'orders, bills and payments' : hold}${until}${supplier.holdReason ? `: ${supplier.holdReason}` : ''}`);
    }
    return supplier;
  }

  // ---- Checks ----

  private checkTax(gstin: string | null, pan: string | null, stateCode: string | null) {
    if (!gstin) return { stateCode, pan };
    const fromGstin = gstinStateCode(gstin);
    if (stateCode && stateCode !== fromGstin) throw new BadRequestException(`GSTIN ${gstin} belongs to state code ${fromGstin}, not ${stateCode}`);
    const panInGstin = panFromGstin(gstin);
    if (pan && pan !== panInGstin) throw new BadRequestException(`PAN ${pan} does not match the PAN inside GSTIN ${gstin}`);
    return { stateCode: fromGstin, pan: pan ?? panInGstin };
  }

  private async checkRefs(input: { priceListId?: string | null; paymentTermsId?: string | null; linkedCustomerId?: string | null }) {
    if (input.priceListId) {
      const list = await this.prisma.priceList.findUnique({ where: { id: input.priceListId } });
      if (!list?.active || !list.forBuying) throw new BadRequestException('Price list must be an active buying list');
    }
    if (input.paymentTermsId && !(await this.prisma.paymentTerms.findFirst({ where: { id: input.paymentTermsId, active: true } }))) {
      throw new BadRequestException('Payment terms not found or switched off');
    }
    if (input.linkedCustomerId && !(await this.prisma.customer.findUnique({ where: { id: input.linkedCustomerId } }))) {
      throw new BadRequestException('Linked customer not found');
    }
  }
}

function summarise(s: SupplierRow): Record<string, unknown> {
  return {
    name: s.name,
    isBusiness: s.isBusiness,
    mobile: s.mobile,
    email: s.email,
    notes: s.notes,
    group: s.supplierGroup.code,
    isTransporter: s.isTransporter,
    gstin: s.gstin,
    pan: s.pan,
    stateCode: s.stateCode,
    priceList: s.priceList?.code ?? null,
    paymentTerms: s.paymentTerms?.code ?? null,
    bankAccountNote: s.bankAccountNote,
    status: s.status,
    holdType: s.holdType,
    holdUntil: date(s.holdUntil),
    holdReason: s.holdReason,
    allowBillWithoutOrder: s.allowBillWithoutOrder,
    allowBillWithoutReceipt: s.allowBillWithoutReceipt,
    linkedCustomers: s.linkedCustomers.map((c) => c.code),
  };
}

export function toSupplierDto(s: SupplierRow) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    isBusiness: s.isBusiness,
    mobile: s.mobile,
    email: s.email,
    notes: s.notes,
    supplierGroup: s.supplierGroup,
    isTransporter: s.isTransporter,
    gstin: s.gstin,
    pan: s.pan,
    stateCode: s.stateCode,
    priceList: s.priceList,
    paymentTerms: s.paymentTerms,
    bankAccountNote: s.bankAccountNote,
    status: s.status,
    holdType: s.holdType,
    holdUntil: date(s.holdUntil),
    holdReason: s.holdReason,
    allowBillWithoutOrder: s.allowBillWithoutOrder,
    allowBillWithoutReceipt: s.allowBillWithoutReceipt,
    linkedCustomers: s.linkedCustomers,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
