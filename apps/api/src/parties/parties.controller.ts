// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type AddressInput,
  addressSchema,
  type ContactInput,
  contactSchema,
  type CreateCustomerGroupInput,
  createCustomerGroupSchema,
  type CreateCustomerInput,
  createCustomerSchema,
  type CreatePaymentTermsInput,
  createPaymentTermsSchema,
  type CreateSupplierGroupInput,
  createSupplierGroupSchema,
  type CreateSupplierInput,
  createSupplierSchema,
  type CustomerCreditInput,
  customerCreditSchema,
  type CustomerQuery,
  customerQuerySchema,
  isIsoDate,
  type QuickAddCustomerInput,
  quickAddCustomerSchema,
  type SupplierHoldInput,
  supplierHoldSchema,
  type SupplierQuery,
  supplierQuerySchema,
  type UpdateAddressInput,
  updateAddressSchema,
  type UpdateContactInput,
  updateContactSchema,
  type UpdateCustomerGroupInput,
  updateCustomerGroupSchema,
  type UpdateCustomerInput,
  updateCustomerSchema,
  type UpdatePartySettingsInput,
  updatePartySettingsSchema,
  type UpdatePaymentTermsInput,
  updatePaymentTermsSchema,
  type UpdateSupplierGroupInput,
  updateSupplierGroupSchema,
  type UpdateSupplierInput,
  updateSupplierSchema,
  businessDate,
} from 'shared';
import { OwnerAdminOnly, RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { z } from 'zod';
import { ContactsService } from './contacts.service.js';
import { CustomerHistoryService } from './customer-history.service.js';
import { CustomersService } from './customers.service.js';
import { PartyMastersService } from './party-masters.service.js';
import { PartySettingsService } from './party-settings.service.js';
import { SuppliersService } from './suppliers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly contacts: ContactsService,
    private readonly history: CustomerHistoryService,
  ) {}

  @Get() @RequirePermission('customers.view') list(@Query(new ZodValidationPipe(customerQuerySchema)) q: CustomerQuery) {
    return this.customers.list(q);
  }
  @Post() @RequirePermission('customers.manage') create(@Body(new ZodValidationPipe(createCustomerSchema)) input: CreateCustomerInput, @ReqActor() actor: Actor) {
    return this.customers.create(input, actor);
  }
  @Post('quick-add') @RequirePermission('customers.quick_add') quickAdd(@Body(new ZodValidationPipe(quickAddCustomerSchema)) input: QuickAddCustomerInput, @ReqActor() actor: Actor) {
    return this.customers.quickAdd(input, actor);
  }
  /** Plan 11 C10: birthdays and anniversaries in the next days (declared before ':id'). */
  @Get('birthdays') @RequirePermission('customers.view') birthdays(@Query(new ZodValidationPipe(z.object({ days: z.coerce.number().int().min(1).max(31).optional() }))) q: { days?: number }) {
    return this.history.upcoming(q.days ?? 7);
  }
  @Get(':id') @RequirePermission('customers.view') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }
  @Patch(':id') @RequirePermission('customers.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCustomerSchema)) input: UpdateCustomerInput, @ReqActor() actor: Actor) {
    return this.customers.update(id, input, actor);
  }
  @Patch(':id/credit') @RequirePermission('customers.credit') credit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(customerCreditSchema)) input: CustomerCreditInput, @ReqActor() actor: Actor) {
    return this.customers.setCredit(id, input, actor);
  }

  /** Plan 11 C9: till bills and returns, newest first, with this and last year's totals. */
  @Get(':id/purchases') @RequirePermission('customers.view') purchases(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() }))) q: { page?: number; pageSize?: number },
    @ReqUser() user: AuthUser,
  ) {
    return this.history.purchases(id, q, user);
  }

  @Get(':id/addresses') @RequirePermission('customers.view') addresses(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.listAddresses('customer', id);
  }
  @Post(':id/addresses') @RequirePermission('customers.manage') addAddress(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addressSchema)) input: AddressInput, @ReqActor() actor: Actor) {
    return this.contacts.createAddress('customer', id, input, actor);
  }
  @Patch(':id/addresses/:aid') @RequirePermission('customers.manage') updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Body(new ZodValidationPipe(updateAddressSchema)) input: UpdateAddressInput,
    @ReqActor() actor: Actor,
  ) {
    return this.contacts.updateAddress('customer', id, aid, input, actor);
  }
  @Get(':id/contacts') @RequirePermission('customers.view') contactsOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.listContacts('customer', id);
  }
  @Post(':id/contacts') @RequirePermission('customers.manage') addContact(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(contactSchema)) input: ContactInput, @ReqActor() actor: Actor) {
    return this.contacts.createContact('customer', id, input, actor);
  }
  @Patch(':id/contacts/:cid') @RequirePermission('customers.manage') updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @Body(new ZodValidationPipe(updateContactSchema)) input: UpdateContactInput,
    @ReqActor() actor: Actor,
  ) {
    return this.contacts.updateContact('customer', id, cid, input, actor);
  }
}

@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly contacts: ContactsService,
  ) {}

  @Get() @RequirePermission('suppliers.view') list(@Query(new ZodValidationPipe(supplierQuerySchema)) q: SupplierQuery) {
    return this.suppliers.list(q);
  }
  @Post() @RequirePermission('suppliers.manage') create(@Body(new ZodValidationPipe(createSupplierSchema)) input: CreateSupplierInput, @ReqActor() actor: Actor) {
    return this.suppliers.create(input, actor);
  }
  @Get(':id') @RequirePermission('suppliers.view') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.get(id);
  }
  @Patch(':id') @RequirePermission('suppliers.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSupplierSchema)) input: UpdateSupplierInput, @ReqActor() actor: Actor) {
    return this.suppliers.update(id, input, actor);
  }
  @Patch(':id/hold') @RequirePermission('suppliers.hold') hold(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(supplierHoldSchema)) input: SupplierHoldInput, @ReqActor() actor: Actor) {
    return this.suppliers.setHold(id, input, actor);
  }

  @Get(':id/addresses') @RequirePermission('suppliers.view') addresses(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.listAddresses('supplier', id);
  }
  @Post(':id/addresses') @RequirePermission('suppliers.manage') addAddress(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addressSchema)) input: AddressInput, @ReqActor() actor: Actor) {
    return this.contacts.createAddress('supplier', id, input, actor);
  }
  @Patch(':id/addresses/:aid') @RequirePermission('suppliers.manage') updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Body(new ZodValidationPipe(updateAddressSchema)) input: UpdateAddressInput,
    @ReqActor() actor: Actor,
  ) {
    return this.contacts.updateAddress('supplier', id, aid, input, actor);
  }
  @Get(':id/contacts') @RequirePermission('suppliers.view') contactsOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.listContacts('supplier', id);
  }
  @Post(':id/contacts') @RequirePermission('suppliers.manage') addContact(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(contactSchema)) input: ContactInput, @ReqActor() actor: Actor) {
    return this.contacts.createContact('supplier', id, input, actor);
  }
  @Patch(':id/contacts/:cid') @RequirePermission('suppliers.manage') updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @Body(new ZodValidationPipe(updateContactSchema)) input: UpdateContactInput,
    @ReqActor() actor: Actor,
  ) {
    return this.contacts.updateContact('supplier', id, cid, input, actor);
  }
}

@Controller()
export class PartyMastersController {
  constructor(
    private readonly masters: PartyMastersService,
    private readonly settings: PartySettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('customer-groups') @RequirePermission('customers.view') customerGroups() {
    return this.masters.customerGroupTree();
  }
  @Post('customer-groups') @RequirePermission('customers.manage') createCustomerGroup(@Body(new ZodValidationPipe(createCustomerGroupSchema)) input: CreateCustomerGroupInput, @ReqActor() actor: Actor) {
    return this.masters.createCustomerGroup(input, actor);
  }
  @Patch('customer-groups/:id') @RequirePermission('customers.manage') updateCustomerGroup(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCustomerGroupSchema)) input: UpdateCustomerGroupInput, @ReqActor() actor: Actor) {
    return this.masters.updateCustomerGroup(id, input, actor);
  }

  @Get('supplier-groups') @RequirePermission('suppliers.view') supplierGroups() {
    return this.masters.supplierGroupTree();
  }
  @Post('supplier-groups') @RequirePermission('suppliers.manage') createSupplierGroup(@Body(new ZodValidationPipe(createSupplierGroupSchema)) input: CreateSupplierGroupInput, @ReqActor() actor: Actor) {
    return this.masters.createSupplierGroup(input, actor);
  }
  @Patch('supplier-groups/:id') @RequirePermission('suppliers.manage') updateSupplierGroup(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSupplierGroupSchema)) input: UpdateSupplierGroupInput, @ReqActor() actor: Actor) {
    return this.masters.updateSupplierGroup(id, input, actor);
  }

  /** Anyone who can see customers or suppliers needs the terms list to read a party. */
  @Get('payment-terms') @RequireAnyPermission('customers.view', 'suppliers.view') paymentTerms() {
    return this.masters.listTerms();
  }
  @Post('payment-terms') @RequirePermission('payment_terms.manage') createTerms(@Body(new ZodValidationPipe(createPaymentTermsSchema)) input: CreatePaymentTermsInput, @ReqActor() actor: Actor) {
    return this.masters.createTerms(input, actor);
  }
  @Patch('payment-terms/:id') @RequirePermission('payment_terms.manage') updateTerms(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePaymentTermsSchema)) input: UpdatePaymentTermsInput, @ReqActor() actor: Actor) {
    return this.masters.updateTerms(id, input, actor);
  }
  @Get('payment-terms/:id/due-date') @RequireAnyPermission('customers.view', 'suppliers.view') dueDate(@Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string) {
    return this.masters.dueDatesFor(this.prisma, id, from && isIsoDate(from) ? from : businessDate());
  }

  @Get('party-settings') @RequireAnyPermission('customers.view', 'suppliers.view') getSettings() {
    return this.settings.get();
  }
  @Patch('party-settings') @OwnerAdminOnly() updateSettings(@Body(new ZodValidationPipe(updatePartySettingsSchema)) input: UpdatePartySettingsInput, @ReqActor() actor: Actor) {
    return this.settings.update(input, actor);
  }
}
