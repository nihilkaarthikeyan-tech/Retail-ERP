// Copyright (c) 2026, Rademics. All rights reserved.
// Module 7 endpoints (plan 07 §7). Every endpoint checks the permission here and
// the store inside the service (rule 11).
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AsOfQuery,
  asOfQuerySchema,
  approveChartSchema,
  type BankAccountInput,
  bankAccountSchema,
  cancelSchema,
  type CreateAccountInput,
  createAccountSchema,
  type DocListQuery,
  docListQuerySchema,
  type JournalInput,
  journalSchema,
  type LedgerQuery,
  ledgerQuerySchema,
  lockAccountSchema,
  lockDateSchema,
  type OpeningBillInput,
  openingBillSchema,
  type PaymentInput,
  paymentSchema,
  type PeriodQuery,
  periodQuerySchema,
  type SetDefaultsInput,
  setDefaultsSchema,
  type SettleInput,
  settleSchema,
  type UpdateAccountInput,
  updateAccountSchema,
  updateBankAccountSchema,
  type YearEndClosingInput,
  yearEndClosingSchema,
} from 'shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { ChartService } from './chart.service.js';
import { ClosingService } from './closing.service.js';
import { JournalsService } from './journals.service.js';
import { LedgerReportsService } from './ledger-reports.service.js';
import { PaymentsService } from './payments.service.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);
const partyTypeSchema = z.enum(['customer', 'supplier']);
const statementQuerySchema = z.object({ from: z.string().optional(), to: z.string().optional() });

@Controller()
export class AccountingController {
  constructor(
    private readonly chart: ChartService,
    private readonly journals: JournalsService,
    private readonly payments: PaymentsService,
    private readonly closing: ClosingService,
    private readonly reports: LedgerReportsService,
  ) {}

  // ---- Chart of accounts ----
  @Get('accounts') @RequireAnyPermission('accounts.view', 'journals.post', 'payments.post', 'cash.deposit') tree(@ReqUser() user: AuthUser) {
    return this.chart.tree(user);
  }
  @Post('accounts') @RequirePermission('accounts.manage') createAccount(@Body(zod(createAccountSchema)) input: CreateAccountInput, @ReqActor() actor: Actor) {
    return this.chart.create(input, actor);
  }
  @Patch('accounts/:id') @RequirePermission('accounts.manage') updateAccount(@Param('id', id()) accountId: string, @Body(zod(updateAccountSchema)) input: UpdateAccountInput, @ReqActor() actor: Actor) {
    return this.chart.update(accountId, input, actor);
  }
  @Post('accounts/:id/lock') @HttpCode(200) @RequirePermission('books.lock') lockAccount(@Param('id', id()) accountId: string, @Body(zod(lockAccountSchema)) input: { locked: boolean }, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.chart.lock(accountId, input.locked, actor, user);
  }
  @Post('accounts/approve-chart') @HttpCode(200) @RequirePermission('accounts.approve_chart') approveChart(@Body(zod(approveChartSchema)) input: { note: string }, @ReqActor() actor: Actor) {
    return this.chart.approveChart(input.note, actor);
  }
  @Get('accounting/settings') @RequireAnyPermission('accounts.view', 'journals.post', 'payments.post', 'cash.deposit') settings() {
    return this.chart.settings();
  }
  @Get('accounting/defaults') @RequireAnyPermission('accounts.view', 'accounts.manage') defaults() {
    return this.chart.defaults();
  }
  @Put('accounting/defaults') @RequirePermission('accounts.manage') setDefaults(@Body(zod(setDefaultsSchema)) input: SetDefaultsInput, @ReqActor() actor: Actor) {
    return this.chart.setDefaults(input, actor);
  }
  @Get('bank-accounts') @RequireAnyPermission('accounts.view', 'payments.post', 'cash.deposit') bankAccounts() {
    return this.chart.bankAccounts();
  }
  @Post('bank-accounts') @RequirePermission('accounts.manage') createBankAccount(@Body(zod(bankAccountSchema)) input: BankAccountInput, @ReqActor() actor: Actor) {
    return this.chart.createBankAccount(input, actor);
  }
  @Patch('bank-accounts/:id') @RequirePermission('accounts.manage') updateBankAccount(@Param('id', id()) bankId: string, @Body(zod(updateBankAccountSchema)) input: Partial<BankAccountInput> & { active?: boolean }, @ReqActor() actor: Actor) {
    return this.chart.updateBankAccount(bankId, input, actor);
  }

  // ---- Journals ----
  @Get('journals') @RequireAnyPermission('accounts.view', 'journals.post', 'cash.deposit') listJournals(@Query(zod(docListQuerySchema)) q: DocListQuery) {
    return this.journals.list(q);
  }
  @Get('journals/:id') @RequireAnyPermission('accounts.view', 'journals.post', 'cash.deposit') journal(@Param('id', id()) journalId: string) {
    return this.journals.get(journalId);
  }
  @Post('journals') @RequireAnyPermission('journals.post', 'cash.deposit') createJournal(@Body(zod(journalSchema)) input: JournalInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.journals.create(input, actor, user);
  }
  @Patch('journals/:id') @RequireAnyPermission('journals.post', 'cash.deposit') updateJournal(@Param('id', id()) journalId: string, @Body(zod(journalSchema)) input: JournalInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.journals.update(journalId, input, actor, user);
  }
  @Post('journals/:id/post') @HttpCode(200) @RequireAnyPermission('journals.post', 'cash.deposit') postJournal(@Param('id', id()) journalId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.journals.post(journalId, actor, user);
  }
  @Post('journals/:id/cancel') @HttpCode(200) @RequireAnyPermission('journals.post', 'cash.deposit') cancelJournal(@Param('id', id()) journalId: string, @Body(zod(cancelSchema)) input: { reason: string }, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.journals.cancel(journalId, input.reason, actor, user);
  }

  // ---- Receipts, payments, transfers ----
  @Get('payments') @RequireAnyPermission('accounts.view', 'payments.post', 'cash.deposit') listPayments(@Query(zod(docListQuerySchema)) q: DocListQuery) {
    return this.payments.list(q);
  }
  @Get('payments/:id') @RequireAnyPermission('accounts.view', 'payments.post', 'cash.deposit') payment(@Param('id', id()) paymentId: string) {
    return this.payments.get(paymentId);
  }
  @Post('payments') @RequireAnyPermission('payments.post', 'cash.deposit') createPayment(@Body(zod(paymentSchema)) input: PaymentInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.payments.create(input, actor, user);
  }
  @Patch('payments/:id') @RequireAnyPermission('payments.post', 'cash.deposit') updatePayment(@Param('id', id()) paymentId: string, @Body(zod(paymentSchema)) input: PaymentInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.payments.update(paymentId, input, actor, user);
  }
  @Post('payments/:id/post') @HttpCode(200) @RequireAnyPermission('payments.post', 'cash.deposit') postPayment(@Param('id', id()) paymentId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.payments.post(paymentId, actor, user);
  }
  @Post('payments/:id/cancel') @HttpCode(200) @RequireAnyPermission('payments.post', 'cash.deposit') cancelPayment(@Param('id', id()) paymentId: string, @Body(zod(cancelSchema)) input: { reason: string }, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.payments.cancel(paymentId, input.reason, actor, user);
  }
  @Get('parties/:type/:id/open-items') @RequireAnyPermission('accounts.view', 'payments.post', 'journals.post') openItems(@Param('type', zod(partyTypeSchema)) type: 'customer' | 'supplier', @Param('id', id()) partyId: string) {
    return this.payments.openItems(type, partyId);
  }
  @Get('parties/:type/:id/settlements') @RequireAnyPermission('accounts.view', 'payments.post') settlements(@Param('type', zod(partyTypeSchema)) type: 'customer' | 'supplier', @Param('id', id()) partyId: string) {
    return this.payments.settlements(type, partyId);
  }
  @Post('settlements') @RequirePermission('payments.post') settle(@Body(zod(settleSchema)) input: SettleInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.payments.settle(input, actor, user);
  }
  @Post('settlements/:id/undo') @HttpCode(200) @RequirePermission('payments.post') undoSettlement(@Param('id', id()) settlementId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.payments.undoSettlement(settlementId, actor, user);
  }

  // ---- Opening balances and protecting the books ----
  @Get('opening-bills') @RequireAnyPermission('accounts.view', 'journals.post') openingBills() {
    return this.closing.openingBills();
  }
  @Post('opening-bills') @RequirePermission('journals.post') createOpeningBill(@Body(zod(openingBillSchema)) input: OpeningBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.closing.createOpeningBill(input, actor, user);
  }
  @Post('opening-bills/:id/cancel') @HttpCode(200) @RequirePermission('journals.post') cancelOpeningBill(@Param('id', id()) billId: string, @Body(zod(cancelSchema)) input: { reason: string }, @ReqActor() actor: Actor) {
    return this.closing.cancelOpeningBill(billId, input.reason, actor);
  }
  @Get('accounting/opening-check') @RequireAnyPermission('accounts.view', 'journals.post') openingCheck() {
    return this.closing.openingCheck();
  }
  @Patch('accounting/lock-date') @RequirePermission('books.lock') setLockDate(@Body(zod(lockDateSchema)) input: { lockDate: string | null; reason: string }, @ReqActor() actor: Actor) {
    return this.closing.setLockDate(input.lockDate, input.reason, actor);
  }
  @Get('year-end-closings') @RequireAnyPermission('accounts.view', 'books.lock') closings() {
    return this.closing.closings();
  }
  @Post('year-end-closings') @RequirePermission('books.lock') close(@Body(zod(yearEndClosingSchema)) input: YearEndClosingInput, @ReqActor() actor: Actor) {
    return this.closing.close(input, actor);
  }
  @Post('year-end-closings/:id/cancel') @HttpCode(200) @RequirePermission('books.lock') cancelClosing(@Param('id', id()) closingId: string, @Body(zod(cancelSchema)) input: { reason: string }, @ReqActor() actor: Actor) {
    return this.closing.cancelClosing(closingId, input.reason, actor);
  }

  // ---- Reports ----
  @Get('ledger/entries') @RequirePermission('accounts.view') documentEntries(@Query(zod(z.object({ documentType: z.string().max(40), documentId: z.string().uuid() }))) q: { documentType: string; documentId: string }, @ReqUser() user: AuthUser) {
    return this.reports.forDocument(q.documentType, q.documentId, user);
  }
  @Get('reports/general-ledger') @RequirePermission('accounts.view') generalLedger(@Query(zod(ledgerQuerySchema)) q: LedgerQuery, @ReqUser() user: AuthUser) {
    return this.reports.generalLedger(q, user);
  }
  @Get('reports/day-book') @RequirePermission('accounts.view') dayBook(@Query(zod(periodQuerySchema)) q: PeriodQuery, @ReqUser() user: AuthUser) {
    this.reports.assertPeriod(q);
    return this.reports.dayBook(q, user);
  }
  @Get('reports/trial-balance') @RequirePermission('accounts.view') trialBalance(@Query(zod(periodQuerySchema)) q: PeriodQuery, @ReqUser() user: AuthUser) {
    this.reports.assertPeriod(q);
    return this.reports.trialBalance(q, user);
  }
  @Get('reports/profit-and-loss') @RequirePermission('accounts.view') profitAndLoss(@Query(zod(periodQuerySchema)) q: PeriodQuery, @ReqUser() user: AuthUser) {
    this.reports.assertPeriod(q);
    return this.reports.profitAndLoss(q, user);
  }
  @Get('reports/balance-sheet') @RequirePermission('accounts.view') balanceSheet(@Query(zod(asOfQuerySchema)) q: AsOfQuery, @ReqUser() user: AuthUser) {
    return this.reports.balanceSheet(q, user);
  }
  @Get('reports/party-statement/:type/:id') @RequireAnyPermission('accounts.view', 'payments.post') partyStatement(
    @Param('type', zod(partyTypeSchema)) type: 'customer' | 'supplier',
    @Param('id', id()) partyId: string,
    @Query(zod(statementQuerySchema)) q: { from?: string; to?: string },
    @ReqUser() user: AuthUser,
  ) {
    return this.reports.partyStatement(type, partyId, q, user);
  }
  @Get('reports/ageing') @RequireAnyPermission('accounts.view', 'payments.post') ageing(@Query(zod(asOfQuerySchema)) q: AsOfQuery, @ReqUser() user: AuthUser) {
    return this.reports.ageing(q, user);
  }
  @Get('reports/stock-vs-accounts') @RequirePermission('accounts.view') stockVsAccounts(@ReqUser() user: AuthUser) {
    return this.reports.stockVsAccounts(user);
  }
  @Get('reports/book-health') @RequirePermission('accounts.view') bookHealth() {
    return this.reports.bookHealth();
  }
}
