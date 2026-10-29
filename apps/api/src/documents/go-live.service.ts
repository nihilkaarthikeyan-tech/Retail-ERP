// Copyright (c) 2026, Rademics. All rights reserved.
// Going live (decision 72; plan 10 §1.E; blueprint 15 process 7). Before go-live
// the Owner may clear every transaction of a trial period; the master lists
// (items, prices, customers, suppliers, accounts, users, tills, settings) and
// the history stay. Recording the go-live date switches clearing off for good.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { businessDate, type ClearTrialDataInput, type CurrentUser, type GoLiveDateInput } from 'shared';
import { LedgerReportsService } from '../accounting/ledger-reports.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Every table of transactions, in groups for the step log; all are emptied together. */
const TRANSACTION_TABLES: { step: string; tables: string[] }[] = [
  { step: 'Accounts: ledger, journals, payments, opening bills, closings', tables: ['LedgerLine', 'LedgerEntry', 'Settlement', 'JournalLine', 'Journal', 'PaymentAllocation', 'PaymentDeduction', 'Payment', 'OpeningBill', 'YearEndClosing'] },
  { step: 'Till: bills, payments, shifts and closings', tables: ['PosPayment', 'PosBillLine', 'PosBill', 'ShiftClosingLine', 'ShiftClosing', 'CashMovement', 'ShiftCash', 'Shift', 'PosSyncProblem', 'PosDrawerOpening', 'PosApproval', 'PosCashierToken'] },
  { step: 'Stock: movements, totals, documents, batches and serial numbers', tables: ['StockLedgerEntry', 'StockPosition', 'BatchPosition', 'SerialNumber', 'StockDocumentLine', 'StockDocument', 'Batch'] },
  { step: 'Purchasing: orders, receipts, bills, charges and suggestions', tables: ['LandedChargeShare', 'LandedChargeItem', 'LandedCharge', 'ReorderSuggestion', 'SupplierBillLine', 'SupplierBill', 'GoodsReceiptLine', 'GoodsReceipt', 'PurchaseOrderLine', 'PurchaseOrder'] },
  { step: 'Document number counters, imports and summary emails', tables: ['NumberSeriesCounter', 'ImportRow', 'ImportJob', 'SummaryEmailRun'] },
];

@Injectable()
export class GoLiveService {
  private readonly log = new Logger(GoLiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly ledgerReports: LedgerReportsService,
  ) {}

  private owner(user: CurrentUser) {
    if (!user.isOwnerAdmin) throw new ForbiddenException('Only the Owner can do this');
  }

  /** The going-live page: the date, whether clearing is still possible, past clearings and the check figures. */
  async status(user: CurrentUser) {
    this.owner(user);
    const company = await this.company.current();
    const asOf = company.goLiveDate ? company.goLiveDate.toISOString().slice(0, 10) : businessDate();
    const clearings = await this.prisma.trialClearing.findMany({ where: { companyId: company.id }, orderBy: { requestedAt: 'desc' }, take: 10 });
    const counts = Object.fromEntries(
      await Promise.all(
        [
          ['bills', this.prisma.posBill.count({ where: { companyId: company.id } })],
          ['stockMovements', this.prisma.stockLedgerEntry.count({ where: { companyId: company.id } })],
          ['ledgerEntries', this.prisma.ledgerEntry.count({ where: { companyId: company.id } })],
          ['purchaseDocuments', this.prisma.goodsReceipt.count({ where: { companyId: company.id } })],
        ].map(async ([k, p]) => [k, await (p as Promise<number>)]),
      ),
    );
    return {
      goLiveDate: company.goLiveDate ? company.goLiveDate.toISOString().slice(0, 10) : null,
      clearingAllowed: !company.goLiveDate,
      companyName: company.legalName,
      transactions: counts,
      clearings: clearings.map((c) => ({ id: c.id, reason: c.reason, requestedAt: c.requestedAt, finishedAt: c.finishedAt, steps: c.steps })),
      check: {
        asOf,
        trialBalance: (await this.ledgerReports.trialBalance({ from: '2000-01-01', to: asOf }, user)).totals,
        stockAgainstAccounts: await this.ledgerReports.stockVsAccounts(user),
        customerDues: (await this.ledgerReports.ageing({ asOf, partyType: 'customer' }, user)).totals,
        supplierDues: (await this.ledgerReports.ageing({ asOf, partyType: 'supplier' }, user)).totals,
      },
    };
  }

  /** Deletes every transaction of the trial period in one database transaction; all or nothing. */
  async clearTrialData(input: ClearTrialDataInput, actor: Actor, user: CurrentUser) {
    this.owner(user);
    const company = await this.company.current();
    if (company.goLiveDate) throw new ForbiddenException(`The shop went live on ${company.goLiveDate.toISOString().slice(0, 10)}; trial data can no longer be cleared`);
    if (input.confirmCompanyName.trim().toLowerCase() !== company.legalName.trim().toLowerCase()) throw new BadRequestException(`Type the company name exactly as "${company.legalName}" to confirm`);
    const steps: { step: string; rows: number; outcome: string }[] = [];
    const clearing = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.company.findUniqueOrThrow({ where: { id: company.id } });
        if (fresh.goLiveDate) throw new ForbiddenException('The shop has gone live; trial data can no longer be cleared');
        for (const s of TRANSACTION_TABLES) {
          let rows = 0;
          for (const t of s.tables) rows += Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`))[0].n);
          steps.push({ step: s.step, rows, outcome: 'cleared' });
        }
        // Plan 14: only this shop's rows are deleted (row-level security), never another shop's. Posted ledger and
        // stock lines are protected against deleting; clearing is the one deliberate exception (decision 72), allowed
        // by this setting inside this transaction only.
        await tx.$executeRaw`SELECT set_config('app.clear_trial', 'on', true)`;
        for (const t of TRANSACTION_TABLES.flatMap((s) => s.tables)) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
        const prices = await tx.price.deleteMany({ where: { batchId: { not: null } } });
        await tx.coupon.updateMany({ data: { usedCount: 0 } });
        await tx.item.updateMany({ data: { lastPurchasePrice: null } });
        await tx.company.update({ where: { id: company.id }, data: { lockDate: null } });
        steps.push({ step: 'Prices for single batches, coupon use counts, last purchase prices and the books-locked date reset', rows: prices.count, outcome: 'reset' });
        const c = await tx.trialClearing.create({ data: { companyId: company.id, reason: input.reason, steps, requestedById: actor.userId, finishedAt: new Date() } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'trial_data', entityId: c.id, changes: { cleared: steps }, reason: input.reason });
        return c;
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
    this.log.warn(`Trial data cleared by ${user.email}: ${input.reason}`);
    return { id: clearing.id, steps, note: 'Open each till again so it refreshes its saved copy; bills still waiting on a till computer will be sent as new bills.' };
  }

  /** Recording the go-live date: from then on trial data can never be cleared (decision 72). */
  async setGoLive(input: GoLiveDateInput, actor: Actor, user: CurrentUser) {
    this.owner(user);
    const company = await this.company.current();
    if (company.goLiveDate) throw new BadRequestException(`The go-live date is already recorded as ${company.goLiveDate.toISOString().slice(0, 10)} and cannot be changed`);
    if (input.confirmCompanyName.trim().toLowerCase() !== company.legalName.trim().toLowerCase()) throw new BadRequestException(`Type the company name exactly as "${company.legalName}" to confirm`);
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: { goLiveDate: new Date(`${input.goLiveDate}T00:00:00Z`), goLiveById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'company', entityId: company.id, changes: { goLiveDate: input.goLiveDate } });
    });
    return this.status(user);
  }
}
