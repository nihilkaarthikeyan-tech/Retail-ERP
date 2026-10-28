// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type CreateStoreInput, type CurrentUser, INDIAN_STATES, type UpdateStoreInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { ensureStoreLocations } from '../inventory/location-defaults.js';
import { AccountingSetup } from '../ledger/accounting-setup.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const storeInclude = { gstRegistration: { select: { id: true, gstin: true } } };

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly accounts: AccountingSetup,
  ) {}

  /** Only the stores the user may work in (record restriction). */
  async list(user: CurrentUser) {
    const company = await this.company.current();
    const ids = allowedStoreIds(user);
    return this.prisma.store.findMany({
      where: { companyId: company.id, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { code: 'asc' },
      include: storeInclude,
    });
  }

  async get(id: string, user: CurrentUser) {
    assertStoreAccess(user, id);
    const store = await this.prisma.store.findUnique({ where: { id }, include: storeInclude });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async create(input: CreateStoreInput, actor: Actor) {
    const company = await this.company.current();
    return this.prisma.$transaction((tx) => this.createIn(tx, company.id, input, actor));
  }

  /** Shared with setup; runs inside the caller's transaction. */
  async createIn(db: Db, companyId: string, input: CreateStoreInput, actor: Actor) {
    if (await db.store.findUnique({ where: { companyId_code: { companyId, code: input.code } } })) {
      throw new ConflictException(`A store with code "${input.code}" already exists`);
    }
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    const registration = await this.registrationFor(db, companyId, input.gstRegistrationId);
    await this.assertSameState(db, companyId, input.stateCode ?? registration?.stateCode ?? company.stateCode, registration);
    const created = await db.store.create({
      data: {
        companyId,
        code: input.code,
        name: input.name,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
        stateCode: input.stateCode ?? registration?.stateCode ?? company.stateCode,
        phone: input.phone ?? null,
        email: input.email ?? null,
        gstRegistrationId: registration?.id ?? null,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.audit.record(db, actor, {
      action: 'create',
      entityType: 'store',
      entityId: created.id,
      changes: { code: created.code, name: created.name, gstin: registration?.gstin ?? null },
    });
    // Every store gets its stock locations at once (module 4, approved plan question 2).
    await ensureStoreLocations(db, created);
    // Decision L10 (owner, 28 October 2026): its cash accounts too, so its cash can be chosen on a
    // payment before its first till shift.
    await this.accounts.ensure(db, companyId);
    await this.accounts.ensureStore(db, companyId, created.id);
    return created;
  }

  async update(id: string, input: UpdateStoreInput, user: CurrentUser, actor: Actor) {
    assertStoreAccess(user, id);
    const before = await this.prisma.store.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Store not found');
    return this.prisma.$transaction(async (tx) => {
      const registration =
        input.gstRegistrationId !== undefined
          ? await this.registrationFor(tx, before.companyId, input.gstRegistrationId)
          : undefined;
      const stateCode = input.stateCode ?? before.stateCode;
      if (input.stateCode !== undefined || registration !== undefined) {
        const reg = registration !== undefined ? registration : before.gstRegistrationId ? await this.registrationFor(tx, before.companyId, before.gstRegistrationId) : null;
        await this.assertSameState(tx, before.companyId, stateCode, reg);
      }
      const after = await tx.store.update({
        where: { id },
        data: {
          ...input,
          ...(registration !== undefined ? { gstRegistrationId: registration?.id ?? null } : {}),
          updatedById: actor.userId,
        },
      });
      await this.audit.recordUpdate(tx, actor, 'store', id, before, after);
      return after;
    });
  }

  /**
   * A GSTIN belongs to one state (its first two digits), and a store reports under the
   * registration of the state it is in (blueprint 13: "Stores in several states: separate
   * registrations"). Found in the launch check of 27 October 2026: a Chennai store could be put
   * under a Karnataka GSTIN. No registration means the company default one.
   */
  private async assertSameState(db: Db, companyId: string, stateCode: string | null, registration: { gstin: string; stateCode: string } | null) {
    const reg =
      registration ??
      (await db.gstRegistration.findFirst({ where: { companyId, active: true }, orderBy: [{ isDefault: 'desc' }, { gstin: 'asc' }], select: { gstin: true, stateCode: true } }));
    if (!reg || !stateCode || reg.stateCode === stateCode) return;
    const name = (code: string) => INDIAN_STATES[code] ?? code;
    throw new BadRequestException(
      `This store is in ${name(stateCode)}, but GSTIN ${reg.gstin} is for ${name(reg.stateCode)}. Choose the GSTIN for ${name(stateCode)}, or add one under Company.`,
    );
  }

  private async registrationFor(db: Db, companyId: string, gstRegistrationId: string | null | undefined) {
    if (!gstRegistrationId) return null;
    const registration = await db.gstRegistration.findFirst({
      where: { id: gstRegistrationId, companyId, active: true },
    });
    if (!registration) throw new BadRequestException('GST registration not found or switched off');
    return registration;
  }
}
