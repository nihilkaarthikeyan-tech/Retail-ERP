// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateGstRegistrationInput,
  gstinStateCode,
  type UpdateCompanyInput,
  type UpdateGstRegistrationInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Company } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Version 1 runs one company (decision 2); this returns it. */
  async current(db: Db = this.prisma): Promise<Company> {
    const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) throw new NotFoundException('The company has not been set up yet');
    return company;
  }

  async get() {
    return publicCompany(await this.current());
  }

  async update(input: UpdateCompanyInput, actor: Actor) {
    const before = await this.current();
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.company.update({
        where: { id: before.id },
        data: { ...input, updatedById: actor.userId },
      });
      await this.audit.recordUpdate(tx, actor, 'company', before.id, before, after);
      return after;
    });
    return publicCompany(updated);
  }

  // ---- GST registrations (decision 4: several GSTINs from the start) ----

  async listGstRegistrations() {
    const company = await this.current();
    return this.prisma.gstRegistration.findMany({
      where: { companyId: company.id },
      orderBy: [{ isDefault: 'desc' }, { gstin: 'asc' }],
    });
  }

  async createGstRegistration(input: CreateGstRegistrationInput, actor: Actor) {
    const company = await this.current();
    return this.prisma.$transaction((tx) => this.createGstRegistrationIn(tx, company.id, input, actor));
  }

  /** Shared with setup; runs inside the caller's transaction. */
  async createGstRegistrationIn(db: Db, companyId: string, input: CreateGstRegistrationInput, actor: Actor) {
    if (await db.gstRegistration.findFirst({ where: { gstin: input.gstin } })) {
      throw new ConflictException(`GSTIN ${input.gstin} is already recorded`);
    }
    const stateCode = gstinStateCode(input.gstin);
    if (input.stateCode && input.stateCode !== stateCode) {
      throw new BadRequestException(`GSTIN ${input.gstin} belongs to state code ${stateCode}`);
    }
    const count = await db.gstRegistration.count({ where: { companyId, active: true } });
    const isDefault = input.isDefault ?? count === 0;
    if (isDefault) {
      await db.gstRegistration.updateMany({ where: { companyId }, data: { isDefault: false } });
    }
    const created = await db.gstRegistration.create({
      data: {
        companyId,
        gstin: input.gstin,
        stateCode,
        legalNameOnCertificate: input.legalNameOnCertificate ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
        isDefault,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.audit.record(db, actor, {
      action: 'create',
      entityType: 'gst_registration',
      entityId: created.id,
      changes: { gstin: created.gstin, stateCode, isDefault },
    });
    return created;
  }

  async updateGstRegistration(id: string, input: UpdateGstRegistrationInput, actor: Actor) {
    const company = await this.current();
    const before = await this.prisma.gstRegistration.findFirst({ where: { id, companyId: company.id } });
    if (!before) throw new NotFoundException('GST registration not found');
    if (input.stateCode && input.stateCode !== before.stateCode) {
      throw new BadRequestException(`GSTIN ${before.gstin} belongs to state code ${before.stateCode}`);
    }
    if (input.active === false) {
      if (before.isDefault) {
        throw new BadRequestException('Make another registration the default before switching this one off');
      }
      const inUse = await this.prisma.store.count({ where: { gstRegistrationId: id, active: true } });
      if (inUse > 0) throw new BadRequestException(`${inUse} active store(s) still use this registration`);
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.gstRegistration.updateMany({ where: { companyId: company.id }, data: { isDefault: false } });
      }
      const { stateCode: _ignored, ...data } = input;
      const after = await tx.gstRegistration.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'gst_registration', id, before, after);
      return after;
    });
  }
}

export function publicCompany(company: Company) {
  const { logo, ...rest } = company;
  return { ...rest, hasLogo: logo !== null };
}
