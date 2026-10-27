// Copyright (c) 2026, Rademics. All rights reserved.
// Addresses and contact people of customers and suppliers.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type AddressInput, type ContactInput, gstinStateCode, type UpdateAddressInput, type UpdateContactInput, stateWithCode } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { PartyType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assertParty(db: Db, partyType: PartyType, partyId: string): Promise<void> {
    const exists = partyType === 'customer' ? await db.customer.findUnique({ where: { id: partyId } }) : await db.supplier.findUnique({ where: { id: partyId } });
    if (!exists) throw new NotFoundException(`${partyType === 'customer' ? 'Customer' : 'Supplier'} not found`);
  }

  // ---- Addresses ----

  listAddresses(partyType: PartyType, partyId: string) {
    return this.prisma.address.findMany({ where: { partyType, partyId }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
  }

  /** Runs inside the caller's transaction (also used when a party is created). */
  async createAddressIn(db: Db, partyType: PartyType, partyId: string, input: AddressInput, actor: Actor) {
    if (input.gstin && gstinStateCode(input.gstin) !== input.stateCode) {
      throw new BadRequestException(`GSTIN ${input.gstin} is for ${stateWithCode(gstinStateCode(input.gstin))}`);
    }
    const count = await db.address.count({ where: { partyType, partyId, active: true } });
    const isMain = input.isMain ?? count === 0;
    if (isMain) await db.address.updateMany({ where: { partyType, partyId }, data: { isMain: false } });
    const created = await db.address.create({
      data: {
        partyType,
        partyId,
        label: input.label ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        stateCode: input.stateCode,
        pincode: input.pincode ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        gstin: input.gstin ?? null,
        taxSituation: input.taxSituation ?? null,
        isBilling: input.isBilling ?? true,
        isDelivery: input.isDelivery ?? true,
        isMain,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.audit.record(db, actor, { action: 'create', entityType: 'address', entityId: created.id, changes: { partyType, partyId, city: created.city, stateCode: created.stateCode, gstin: created.gstin, isMain } });
    return created;
  }

  async createAddress(partyType: PartyType, partyId: string, input: AddressInput, actor: Actor) {
    await this.assertParty(this.prisma, partyType, partyId);
    return this.prisma.$transaction((tx) => this.createAddressIn(tx, partyType, partyId, input, actor));
  }

  async updateAddress(partyType: PartyType, partyId: string, id: string, input: UpdateAddressInput, actor: Actor) {
    const before = await this.prisma.address.findFirst({ where: { id, partyType, partyId } });
    if (!before) throw new NotFoundException('Address not found');
    const gstin = input.gstin === undefined ? before.gstin : input.gstin;
    const stateCode = input.stateCode ?? before.stateCode;
    if (gstin && gstinStateCode(gstin) !== stateCode) throw new BadRequestException(`GSTIN ${gstin} is for ${stateWithCode(gstinStateCode(gstin))}, not ${stateWithCode(stateCode)}`);
    if (input.active === false && before.isMain) throw new BadRequestException('Make another address the main one before switching this off');
    return this.prisma.$transaction(async (tx) => {
      if (input.isMain) await tx.address.updateMany({ where: { partyType, partyId }, data: { isMain: false } });
      const after = await tx.address.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'address', id, before, after);
      return after;
    });
  }

  // ---- Contact people ----

  listContacts(partyType: PartyType, partyId: string) {
    return this.prisma.contactPerson.findMany({ where: { partyType, partyId }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
  }

  async createContactIn(db: Db, partyType: PartyType, partyId: string, input: ContactInput, actor: Actor) {
    const count = await db.contactPerson.count({ where: { partyType, partyId, active: true } });
    const isMain = input.isMain ?? count === 0;
    if (isMain) await db.contactPerson.updateMany({ where: { partyType, partyId }, data: { isMain: false } });
    const created = await db.contactPerson.create({
      data: {
        partyType,
        partyId,
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        email: input.email ?? null,
        mobile: input.mobile ?? null,
        isMain,
        noPromotions: input.noPromotions ?? false,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.audit.record(db, actor, { action: 'create', entityType: 'contact', entityId: created.id, changes: { partyType, partyId, name: created.name, isMain } });
    return created;
  }

  async createContact(partyType: PartyType, partyId: string, input: ContactInput, actor: Actor) {
    await this.assertParty(this.prisma, partyType, partyId);
    return this.prisma.$transaction((tx) => this.createContactIn(tx, partyType, partyId, input, actor));
  }

  async updateContact(partyType: PartyType, partyId: string, id: string, input: UpdateContactInput, actor: Actor) {
    const before = await this.prisma.contactPerson.findFirst({ where: { id, partyType, partyId } });
    if (!before) throw new NotFoundException('Contact not found');
    return this.prisma.$transaction(async (tx) => {
      if (input.isMain) await tx.contactPerson.updateMany({ where: { partyType, partyId }, data: { isMain: false } });
      const after = await tx.contactPerson.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'contact', id, before, after);
      return after;
    });
  }
}
