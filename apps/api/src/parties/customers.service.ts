// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CreateCustomerInput,
  type CurrentUser,
  type CustomerCreditInput,
  dayMonthYearProblem,
  type CustomerQuery,
  Decimal,
  gstinStateCode,
  hasPermission,
  type QuickAddCustomerInput,
  type UpdateCustomerInput, stateWithCode } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Customer, Prisma } from '../generated/prisma/client.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { assertModuleOn } from '../modules/module-map.js';
import { GstinCheckService } from '../gst/gstin-check/gstin-check.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from './contacts.service.js';
import { PartyMastersService } from './party-masters.service.js';
import { CUSTOMER_NUMBER_SERIES, PartySettingsService } from './party-settings.service.js';

export const customerInclude = {
  customerGroup: { select: { id: true, code: true, name: true } },
  priceList: { select: { id: true, code: true, name: true } },
  paymentTerms: { select: { id: true, code: true, name: true } },
  linkedSupplier: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CustomerInclude;
export type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;


@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly numbering: NumberingService,
    private readonly masters: PartyMastersService,
    private readonly settings: PartySettingsService,
    private readonly contacts: ContactsService,
    private readonly gstinCheck: GstinCheckService,
  ) {}

  // ---- Reading ----

  async list(q: CustomerQuery) {
    const company = await this.company.current();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.CustomerWhereInput = {
      companyId: company.id,
      ...(q.groupId ? { customerGroupId: q.groupId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [{ code: { contains: q.search.toUpperCase() } }, { name: { contains: q.search, mode: 'insensitive' } }, { mobile: { contains: q.search } }, { gstin: { contains: q.search.toUpperCase() } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({ where, include: customerInclude, orderBy: [{ isWalkIn: 'desc' }, { name: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.customer.count({ where }),
    ]);
    return { rows: rows.map(toCustomerDto), total, page, pageSize };
  }

  async getRow(db: Db, id: string): Promise<CustomerRow> {
    const customer = await db.customer.findUnique({ where: { id }, include: customerInclude });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async get(id: string) {
    const customer = await this.getRow(this.prisma, id);
    const [addresses, contacts] = await Promise.all([this.contacts.listAddresses('customer', id), this.contacts.listContacts('customer', id)]);
    return { ...toCustomerDto(customer), addresses, contacts };
  }

  // ---- Creating ----

  async quickAdd(input: QuickAddCustomerInput, actor: Actor) {
    return this.create(
      {
        name: input.name,
        mobile: input.mobile,
        email: input.email ?? null,
        birthday: input.birthday ?? null,
        birthYear: input.birthYear ?? null,
        anniversary: input.anniversary ?? null,
        anniversaryYear: input.anniversaryYear ?? null,
        confirmDuplicate: input.confirmDuplicate,
      },
      actor,
    );
  }

  async create(input: CreateCustomerInput, actor: Actor) {
    const company = await this.company.current();
    const settings = await this.settings.get();
    const groupId = input.customerGroupId ?? settings.defaultCustomerGroupId;
    if (!groupId) throw new BadRequestException('Choose a customer group');
    const group = await this.masters.assertLeafCustomerGroup(this.prisma, groupId);
    const stateCode = this.checkGstin(input.gstin ?? null, input.stateCode ?? null);
    await this.checkRefs(input);
    if (input.code && (await this.prisma.customer.findFirst({ where: { code: input.code } }))) throw new ConflictException(`Customer code ${input.code} already exists`);
    if (input.mobile) await this.checkDuplicateMobile(company.id, input.mobile, null, input.confirmDuplicate ?? false);
    await this.gstinCheck.checkBeforeSave(input.gstin, actor);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = input.code ?? (await this.numbering.allocate(tx, { companyId: company.id, documentKind: CUSTOMER_NUMBER_SERIES.documentKind }));
      const customer = await tx.customer.create({
        data: {
          companyId: company.id,
          code,
          name: input.name,
          isBusiness: input.isBusiness ?? !!input.gstin,
          mobile: input.mobile ?? null,
          email: input.email ?? null,
          notes: input.notes ?? null,
          ...this.checkDates(input, null),
          customerGroupId: group.id,
          gstin: input.gstin ?? null,
          taxSituation: input.taxSituation ?? null,
          stateCode,
          // Group defaults are copied once at creation (scenario 3.8).
          priceListId: input.priceListId ?? group.priceListId,
          paymentTermsId: input.paymentTermsId ?? group.paymentTermsId ?? settings.defaultPaymentTermsId,
          creditLimit: group.creditLimit.gt(0) ? group.creditLimit : settings.defaultCreditLimit,
          overdueLimit: group.overdueLimit,
          creditCheckAtDelivery: input.creditCheckAtDelivery ?? false,
          linkedSupplierId: input.linkedSupplierId ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: customerInclude,
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'customer',
        entityId: customer.id,
        changes: { code: customer.code, name: customer.name, mobile: customer.mobile, group: group.code, gstin: customer.gstin },
      });
      if (input.mobile || input.email) {
        await this.contacts.createContactIn(tx, 'customer', customer.id, { name: input.name, mobile: input.mobile ?? null, email: input.email ?? null, isMain: true }, actor);
      }
      if (input.address) await this.contacts.createAddressIn(tx, 'customer', customer.id, { ...input.address, isMain: true }, actor);
      if (customer.gstin) {
        await this.gstinCheck.applyToParty(tx, 'customer', customer.id, customer.gstin);
        return tx.customer.findUniqueOrThrow({ where: { id: customer.id }, include: customerInclude });
      }
      return customer;
    });
    return toCustomerDto(created);
  }

  async update(id: string, input: UpdateCustomerInput, actor: Actor) {
    const before = await this.getRow(this.prisma, id);
    if (before.isWalkIn && (input.gstin || input.linkedSupplierId)) throw new BadRequestException('The walk-in customer has no GSTIN or supplier link');
    const stateCode = input.gstin !== undefined || input.stateCode !== undefined ? this.checkGstin(input.gstin === undefined ? before.gstin : input.gstin, input.stateCode === undefined ? before.stateCode : input.stateCode) : undefined;
    if (input.customerGroupId && input.customerGroupId !== before.customerGroupId) await this.masters.assertLeafCustomerGroup(this.prisma, input.customerGroupId);
    await this.checkRefs(input);
    if (input.mobile && input.mobile !== before.mobile) await this.checkDuplicateMobile(before.companyId, input.mobile, id, input.confirmDuplicate ?? false);
    const { confirmDuplicate: _c, ...data } = input;
    const dates = this.checkDates(input, before);
    const gstinChanged = input.gstin !== undefined && (input.gstin ?? null) !== before.gstin;
    if (gstinChanged) await this.gstinCheck.checkBeforeSave(input.gstin, actor);
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.customer.update({ where: { id }, data: { ...data, ...dates, stateCode, updatedById: actor.userId }, include: customerInclude });
      await this.audit.recordUpdate(tx, actor, 'customer', id, summarise(before), summarise(after));
      if (!gstinChanged) return after;
      await this.gstinCheck.applyToParty(tx, 'customer', id, after.gstin);
      return tx.customer.findUniqueOrThrow({ where: { id }, include: customerInclude });
    });
    return toCustomerDto(updated);
  }

  /** Credit controller only (customers.credit): limits and status, always with a history row. */
  async setCredit(id: string, input: CustomerCreditInput, actor: Actor) {
    const before = await this.getRow(this.prisma, id);
    if (before.isWalkIn && (input.status || (input.creditLimit && Number(input.creditLimit) > 0))) {
      throw new BadRequestException('The walk-in customer cannot be blocked, switched off or given credit');
    }
    // Plan 12: changing the limits belongs to "Credit sales"; blocking or switching off a customer stays available.
    const limitChanged = (v: string | undefined, old: { toString(): string }) => v !== undefined && !new Decimal(v).eq(old.toString());
    if (limitChanged(input.creditLimit, before.creditLimit) || limitChanged(input.overdueLimit, before.overdueLimit)) await assertModuleOn(this.prisma, 'credit_sales');
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.customer.update({
        where: { id },
        data: {
          creditLimit: input.creditLimit === undefined ? undefined : new Decimal(input.creditLimit),
          overdueLimit: input.overdueLimit === undefined ? undefined : new Decimal(input.overdueLimit),
          status: input.status,
          updatedById: actor.userId,
        },
        include: customerInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'customer', id, summarise(before), summarise(after), input.reason ?? null);
      return after;
    });
    return toCustomerDto(updated);
  }

  // ---- Helpers for later modules ----

  /** Throws unless the customer may be used on a new document. Blocked customers need the credit controller. */
  async assertCustomerUsable(db: Db, id: string, user: CurrentUser): Promise<Customer> {
    const customer = await db.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status === 'off') throw new BadRequestException(`Customer ${customer.code} is switched off`);
    if (customer.status === 'blocked' && !hasPermission(user, 'customers.credit')) {
      throw new ForbiddenException(`Customer ${customer.code} is blocked; only a credit controller may post for them`);
    }
    return customer;
  }

  /**
   * Credit limits in force (plan 11 A7): none when the group skips credit checks; else the
   * customer's own when set, else the group's, else the company default.
   */
  async creditTermsFor(db: Db, customer: Customer): Promise<{ skip: boolean; creditLimit: Decimal; overdueLimit: Decimal }> {
    const group = await db.customerGroup.findUnique({ where: { id: customer.customerGroupId } });
    if (group?.skipCreditCheck) return { skip: true, creditLimit: new Decimal(0), overdueLimit: new Decimal(0) };
    if (customer.creditLimit.gt(0)) return { skip: false, creditLimit: customer.creditLimit, overdueLimit: customer.overdueLimit };
    if (group && group.creditLimit.gt(0)) return { skip: false, creditLimit: group.creditLimit, overdueLimit: group.overdueLimit };
    return { skip: false, creditLimit: (await this.settings.get(db)).defaultCreditLimit, overdueLimit: customer.overdueLimit };
  }

  /** Credit limit in force: the customer's → the group's (unless it skips checks) → the company default. 0 = no limit. */
  async creditLimitFor(db: Db, customer: Customer): Promise<Decimal> {
    if (customer.creditLimit.gt(0)) return customer.creditLimit;
    const group = await db.customerGroup.findUnique({ where: { id: customer.customerGroupId } });
    if (group?.skipCreditCheck) return new Decimal(0);
    if (group && group.creditLimit.gt(0)) return group.creditLimit;
    return (await this.settings.get(db)).defaultCreditLimit;
  }

  // ---- Checks ----

  /** Plan 11 C10: a birthday or anniversary is a real day and month; the year (optional) must fit it. */
  private checkDates(input: Pick<CreateCustomerInput, 'birthday' | 'birthYear' | 'anniversary' | 'anniversaryYear'>, before: Customer | null) {
    const pick = <K extends 'birthday' | 'birthYear' | 'anniversary' | 'anniversaryYear'>(k: K) => (input[k] !== undefined ? input[k] : (before?.[k] ?? null));
    const out = { birthday: pick('birthday'), birthYear: pick('birthYear'), anniversary: pick('anniversary'), anniversaryYear: pick('anniversaryYear') };
    // A cleared day and month clears its year too.
    if (input.birthday === null && input.birthYear === undefined) out.birthYear = null;
    if (input.anniversary === null && input.anniversaryYear === undefined) out.anniversaryYear = null;
    for (const [what, dm, yr] of [
      ['Birthday', out.birthday, out.birthYear],
      ['Anniversary', out.anniversary, out.anniversaryYear],
    ] as const) {
      const problem = dayMonthYearProblem(dm, yr, businessDate());
      if (problem) throw new BadRequestException(`${what}: ${problem}`);
    }
    return out;
  }

  private checkGstin(gstin: string | null, stateCode: string | null): string | null {
    if (!gstin) return stateCode;
    const fromGstin = gstinStateCode(gstin);
    if (stateCode && stateCode !== fromGstin) throw new BadRequestException(`GSTIN ${gstin} is for ${stateWithCode(fromGstin)}, not ${stateWithCode(stateCode)}`);
    return fromGstin;
  }

  private async checkRefs(input: { priceListId?: string | null; paymentTermsId?: string | null; linkedSupplierId?: string | null }) {
    if (input.priceListId) {
      const list = await this.prisma.priceList.findUnique({ where: { id: input.priceListId } });
      if (!list?.active || !list.forSelling) throw new BadRequestException('Price list must be an active selling list');
    }
    if (input.paymentTermsId && !(await this.prisma.paymentTerms.findFirst({ where: { id: input.paymentTermsId, active: true } }))) {
      throw new BadRequestException('Payment terms not found or switched off');
    }
    if (input.linkedSupplierId && !(await this.prisma.supplier.findUnique({ where: { id: input.linkedSupplierId } }))) {
      throw new BadRequestException('Linked supplier not found');
    }
  }

  /** Decision 20: warn and show the existing customer; never merge. */
  private async checkDuplicateMobile(companyId: string, mobile: string, exceptId: string | null, confirmed: boolean) {
    const matches = await this.prisma.customer.findMany({
      where: { companyId, mobile, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, code: true, name: true, mobile: true },
    });
    if (matches.length && !confirmed) {
      throw new ConflictException({
        message: `Mobile ${mobile} already belongs to ${matches.map((m) => `${m.name} (${m.code})`).join(', ')}`,
        code: 'DUPLICATE_MOBILE',
        matches,
      });
    }
  }
}

function summarise(c: CustomerRow): Record<string, unknown> {
  return {
    name: c.name,
    isBusiness: c.isBusiness,
    mobile: c.mobile,
    email: c.email,
    notes: c.notes,
    birthday: c.birthday ? `${c.birthday}${c.birthYear ? `-${c.birthYear}` : ''}` : null,
    anniversary: c.anniversary ? `${c.anniversary}${c.anniversaryYear ? `-${c.anniversaryYear}` : ''}` : null,
    group: c.customerGroup.code,
    gstin: c.gstin,
    taxSituation: c.taxSituation,
    stateCode: c.stateCode,
    priceList: c.priceList?.code ?? null,
    paymentTerms: c.paymentTerms?.code ?? null,
    creditLimit: c.creditLimit.toString(),
    overdueLimit: c.overdueLimit.toString(),
    creditCheckAtDelivery: c.creditCheckAtDelivery,
    status: c.status,
    linkedSupplier: c.linkedSupplier?.code ?? null,
  };
}

export function toCustomerDto(c: CustomerRow) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    isBusiness: c.isBusiness,
    mobile: c.mobile,
    email: c.email,
    notes: c.notes,
    birthday: c.birthday,
    birthYear: c.birthYear,
    anniversary: c.anniversary,
    anniversaryYear: c.anniversaryYear,
    customerGroup: c.customerGroup,
    gstin: c.gstin,
    /** Plan 15: what the GST network said, when last checked (null: not checked yet). */
    gstinCheck: c.gstinStatus ? { status: c.gstinStatus, legalName: c.gstinLegalName, tradeName: c.gstinTradeName, cancelledOn: c.gstinCancelledOn ? c.gstinCancelledOn.toISOString().slice(0, 10) : null, checkedAt: c.gstinCheckedAt } : null,
    taxSituation: c.taxSituation,
    stateCode: c.stateCode,
    priceList: c.priceList,
    paymentTerms: c.paymentTerms,
    creditLimit: c.creditLimit.toString(),
    overdueLimit: c.overdueLimit.toString(),
    creditCheckAtDelivery: c.creditCheckAtDelivery,
    status: c.status,
    isWalkIn: c.isWalkIn,
    linkedSupplier: c.linkedSupplier,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
