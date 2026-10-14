// Copyright (c) 2026, Rademics. All rights reserved.
import { ConflictException, Injectable } from '@nestjs/common';
import { codeFromName, type SetupInput, SYSTEM_ROLES } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RolesService } from '../roles/roles.service.js';
import { StoresService } from '../stores/stores.service.js';

/**
 * First-time setup (blueprint 02, process 1, reduced to what version 1 needs):
 * the owner's login, the company, its GSTIN, the first financial year and the
 * first store, all in one transaction. Refused once a company exists.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly roles: RolesService,
    private readonly company: CompanyService,
    private readonly years: FinancialYearsService,
    private readonly stores: StoresService,
  ) {}

  async status(): Promise<{ needed: boolean }> {
    return { needed: (await this.prisma.company.count()) === 0 };
  }

  async run(input: SetupInput, ipAddress: string | null): Promise<{ companyId: string; userId: string }> {
    if ((await this.prisma.company.count()) > 0) {
      throw new ConflictException('Setup has already been completed');
    }
    await this.auth.assertPasswordAllowed(input.admin.password);
    const passwordHash = await hashPassword(input.admin.password);

    return this.prisma.$transaction(async (tx) => {
      await this.roles.ensureSystemRoles(tx);
      const ownerRole = await tx.role.findUniqueOrThrow({ where: { code: SYSTEM_ROLES.OWNER_ADMIN } });

      const admin = await tx.user.create({
        data: {
          email: input.admin.email,
          firstName: input.admin.firstName,
          lastName: input.admin.lastName ?? null,
          passwordHash,
          mustChangePassword: false,
          allStores: true,
          roles: { create: [{ roleId: ownerRole.id }] },
        },
      });
      await tx.user.update({ where: { id: admin.id }, data: { createdById: admin.id, updatedById: admin.id } });
      const actor: Actor = { userId: admin.id, ipAddress };
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'user',
        entityId: admin.id,
        changes: { email: admin.email, roles: [SYSTEM_ROLES.OWNER_ADMIN], allStores: true },
      });

      const code = input.company.code ?? codeFromName(input.company.legalName);
      if (await tx.company.findUnique({ where: { code } })) {
        throw new ConflictException(`Company code ${code} is already used`);
      }
      const company = await tx.company.create({
        data: {
          code,
          legalName: input.company.legalName,
          tradeName: input.company.tradeName ?? null,
          pan: input.company.pan ?? null,
          stateCode: input.company.stateCode,
          addressLine1: input.company.addressLine1 ?? null,
          addressLine2: input.company.addressLine2 ?? null,
          city: input.company.city ?? null,
          pincode: input.company.pincode ?? null,
          phone: input.company.phone ?? null,
          email: input.company.email ?? null,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        changes: { code, legalName: company.legalName, stateCode: company.stateCode },
      });

      let gstRegistrationId: string | null = null;
      if (input.gstRegistration) {
        const registration = await this.company.createGstRegistrationIn(
          tx,
          company.id,
          { ...input.gstRegistration, isDefault: true },
          actor,
        );
        gstRegistrationId = registration.id;
      }

      await this.years.createIn(
        tx,
        company.id,
        { ...input.financialYear, isIrregular: true /* a short first year is allowed */ },
        actor,
        false,
      );

      await this.stores.createIn(tx, company.id, { ...input.store, gstRegistrationId }, actor);

      await this.audit.record(tx, actor, { action: 'setup', entityType: 'company', entityId: company.id });
      return { companyId: company.id, userId: admin.id };
    });
  }
}
