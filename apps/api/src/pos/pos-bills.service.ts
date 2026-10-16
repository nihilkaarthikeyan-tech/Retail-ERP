// Copyright (c) 2026, Rademics. All rights reserved.
// Till bills: sales, returns and exchanges (blueprint 09 processes 2–5 and 7;
// plan 06 §4; pos-offline plan §3–§5). Stock leaves at every sale (decision
// 39) through StockEngine in the same transaction (rules 5–7). A transaction
// sent twice is saved once (decision 80). Bills made offline are accepted as
// sold and flagged for checking.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  creditCheck,
  changeDue,
  checkDiscount,
  type CurrentUser,
  dayMonthYearProblem,
  Decimal,
  type DeliveryDetailsInput,
  deliveryChargeFor,
  effectiveDiscountPercent,
  hasPermission,
  inclusiveTax,
  isCountedOffer,
  isExpiredOn,
  planOffers,
  type PosBillQuery,
  type PosLineInput,
  type PosTransactionInput,
  QUANTITY_TOLERANCE,
  type QuickAddCustomerInput,
  quantityProblem,
  roundBill,
  roundMoney,
  roundQuantity,
  saleLineAmount,
  shareByWeight,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import type { Customer, GstRate, Item, Offer, PosDelivery, PosSettings, Prisma, StockLedgerEntry } from '../generated/prisma/client.js';
import { type Movement, StockEngine } from '../inventory/stock-engine.service.js';
import { ItemsService } from '../items/items.service.js';
import { CustomersService } from '../parties/customers.service.js';
import { PartySettingsService } from '../parties/party-settings.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OffersService } from './offers.service.js';
import { D, fromIso, iso, type PendingApproval, PosCommon, type TillWithRefs } from './pos-common.service.js';

export const billInclude = {
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, hsnCode: true, isStockItem: true, trackSerials: true, trackBatches: true } } } },
  payments: { include: { paymentMethod: { select: { id: true, code: true, name: true, kind: true } } } },
  till: { select: { id: true, code: true, name: true, storeId: true, receiptFooter: true } },
} satisfies Prisma.PosBillInclude;
export type BillRow = Prisma.PosBillGetPayload<{ include: typeof billInclude }>;

const COGS_ROLE = 'cost_of_goods_sold';

/** A line ready to store; quantities and amounts are minus on returns. */
interface BuiltLine {
  lineNo: number;
  item: Item;
  unitId: string;
  factor: Decimal;
  quantity: Decimal;
  basicQuantity: Decimal;
  barcode: string | null;
  batchId: string | null;
  serialNumbers: string[];
  mrp: Decimal | null;
  listPrice: Decimal;
  price: Decimal;
  discountPercent: Decimal;
  discountAmount: Decimal;
  offerDiscount: Decimal;
  offerId: string | null;
  isFree: boolean;
  gstRate: Decimal;
  provisional: boolean;
  amount: Decimal;
  returnOfLineId: string | null;
  approvedById: string | null;
  /** Return lines: the original out-entry the goods come back at. */
  costSourceId: bigint | null;
  /** Plan 11 C1: who sold the line. */
  salesStaffId: string | null;
}

interface BuiltBill {
  kind: 'sale' | 'return';
  number: string;
  lines: BuiltLine[];
  returnOfId: string | null;
  returnReason: string | null;
  approvedById: string | null;
  couponId: string | null;
  billDiscount: Decimal;
  /** Plan 11 C1: the bill's salesperson. */
  salesStaffId: string | null;
  /** Plan 11 B4: home delivery of the sale, with the charge added. */
  delivery: (Omit<DeliveryDetailsInput, 'charge'> & { charge: Decimal }) | null;
}

interface BuildContext {
  till: TillWithRefs;
  date: string;
  input: PosTransactionInput;
  user: CurrentUser;
  flags: Set<string>;
  interState: boolean;
  settings: PosSettings;
  customer: Customer;
  approvals: string[];
  catalogue: { allowPriceChange: boolean; blockBelowCost: boolean; saveTyped: boolean };
  newPrices: { itemId: string; code: string; unitId: string; price: Decimal }[];
  pending: PendingApproval[];
}

/** A sale line priced and checked, before the bill's offers are chosen. */
interface PricedLine {
  l: PosLineInput;
  b: { item: Item; unitId: string; factor: Decimal; quantity: Decimal; basicQuantity: Decimal; mrp: Decimal | null };
  listPrice: Decimal;
  price: Decimal;
  approvedById: string | null;
  gst: GstRate;
  manualPct: Decimal;
  /** Offers covering the item (none when the price was typed). */
  covering: Offer[];
}

/** What a "buy X, get Y" offer gives (plan 11 B3). */
interface FreeItemInfo {
  item: Item;
  unitId: string;
  factor: Decimal;
  mrp: Decimal | null;
  /** One unit's worth: its price, else its MRP. */
  value: Decimal;
  gstRate: Decimal;
  provisional: boolean;
}

/** Names shown with a bill: offers used, salespeople, the delivery. */
interface BillExtras {
  offers: Map<string, { code: string; name: string }>;
  staff: Map<string, { code: string; name: string }>;
  deliveries: Map<string, PosDelivery>;
}

/** The delivery charge line follows the bill's own lines (the till numbers its lines 1, 2, 3 …). */
function deliveryLineNo(lines: PosLineInput[]): number {
  return Math.max(0, ...lines.filter((x) => !x.freeOfLineNo).map((x) => x.lineNo)) + 1;
}

@Injectable()
export class PosBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
    private readonly offers: OffersService,
    private readonly items: ItemsService,
    private readonly pricing: PricingService,
    private readonly customers: CustomersService,
    private readonly partySettings: PartySettingsService,
    private readonly years: FinancialYearsService,
    private readonly engine: StockEngine,
    private readonly ledger: LedgerService,
  ) {}

  // ---- Saving a sale, return or exchange ----

  async post(input: PosTransactionInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'pos.sell');
    if (input.ret) this.common.requireRight(user, 'pos.return');
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    await this.common.assertDevice(this.prisma, till.id, deviceToken);

    // Pos-offline §4: the same transaction sent again returns what was saved.
    const already = await this.prisma.posBill.findMany({ where: { tillId: till.id, clientId: input.clientId }, include: billInclude, orderBy: { kind: 'desc' } });
    if (already.length) return this.transactionDto(already, user, true);

    try {
      return await this.save(input, till, actor, user);
    } catch (err) {
      // Two copies at the same moment: the unique rule keeps one; answer with it.
      const raced = await this.prisma.posBill.findMany({ where: { tillId: till.id, clientId: input.clientId }, include: billInclude, orderBy: { kind: 'desc' } });
      if (raced.length) return this.transactionDto(raced, user, true);
      if (input.offline && err instanceof BadRequestException) await this.recordSyncProblem(till, input, err.message);
      throw err;
    }
  }

  private async save(input: PosTransactionInput, till: TillWithRefs, actor: Actor, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const settings = await this.common.settings(this.prisma, company.id);
    const soldAt = new Date(input.soldAt);
    if (Number.isNaN(soldAt.getTime())) throw new BadRequestException('The time of sale is not valid');
    if (!input.offline && Math.abs(soldAt.getTime() - Date.now()) > 10 * 60_000) throw new BadRequestException('The till clock is wrong; check the computer’s date and time');
    const date = businessDate(soldAt);
    const flags = new Set<string>();

    // Rule 15 and blueprint 09: billing needs the till's open shift, opened that day.
    const shift = input.shiftClientId
      ? await this.prisma.shift.findUnique({ where: { tillId_clientId: { tillId: till.id, clientId: input.shiftClientId } } })
      : await this.prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
    if (!shift || shift.status !== 'open') throw new BadRequestException('Open a shift on this till first');
    if (iso(shift.businessDate) !== date) {
      if (!input.offline) throw new BadRequestException(`This till’s shift is from ${iso(shift.businessDate)}; close it and open a new one`);
      flags.add('shift_date');
    }
    const cashierId = await this.common.cashierFor(this.prisma, till.id, input.cashierToken, user);
    const customer = await this.customerFor(company.id, input, actor, flags);
    // Plan 11 A6 (blueprint 05): a blocked customer is refused except for the credit controller; offline bills are kept and flagged.
    if (customer.status === 'blocked' && !hasPermission(user, 'customers.credit')) {
      if (!input.offline) throw new BadRequestException(`${customer.name} is blocked; only a credit controller can bill them`);
      flags.add('customer_blocked');
    }
    const interState = this.common.interState(till.store.stateCode, company.stateCode, customer);
    const coupon = input.couponCode && input.sale ? await this.offers.couponFor(this.prisma, company.id, input.couponCode, date, customer.id) : null;
    const offerCtx = { companyId: company.id, storeId: till.storeId, date, customerGroupId: customer.customerGroupId, couponOfferId: coupon?.offerId ?? null };
    const year = await this.years.forDate(this.prisma, company.id, date);
    if (!year) throw new BadRequestException(`No financial year covers ${date}`);

    const approvals: string[] = [];
    const cat = await this.prisma.catalogueSettings.findUnique({ where: { companyId: company.id } });
    // Plan 11 A2: the catalogue settings for prices on bills.
    const catalogue = { allowPriceChange: cat?.allowPriceChangeOnBill ?? false, blockBelowCost: cat?.blockSellingBelowCost ?? false, saveTyped: cat?.saveTypedPrices ?? false };
    const newPrices: { itemId: string; code: string; unitId: string; price: Decimal }[] = [];
    // Manager approvals are checked now but only used up when the bill is saved.
    const pending: PendingApproval[] = [];
    const ctx: BuildContext = { till, date, input, user, flags, interState, settings, customer, approvals, catalogue, newPrices, pending };
    await this.checkSalesStaff(company.id, till, input, flags);

    const ret = input.ret ? await this.buildReturn(ctx) : null;
    const sale = input.sale ? await this.buildSale(ctx, offerCtx, coupon?.id ?? null) : null;
    for (const b of [ret, sale]) if (b) this.checkNumber(b.number, till, year.name);
    if (ret && sale && ret.number === sale.number) throw new BadRequestException('The return and the sale need different numbers');

    const retTotals = ret ? this.totals(ret.lines, interState) : null;
    const saleTotals = sale ? this.totals(sale.lines, interState) : null;
    const net = D(saleTotals?.total ?? '0').add(D(retTotals?.total ?? '0'));

    // Payments (blueprint 09 process 3); on account only as plan 07 §1a allows.
    const methods = new Map(till.paymentMethods.map((m) => [m.paymentMethodId, m.paymentMethod]));
    for (const p of input.payments) {
      const m = methods.get(p.paymentMethodId);
      if (!m || !m.active) throw new BadRequestException('That payment method is not used on this till');
      if (D(p.amount).lt(0) && !m.allowRefund) throw new BadRequestException(`${m.name} cannot be used for refunds`);
      if (m.needsReference && !D(p.amount).eq(0) && !p.reference?.trim()) throw new BadRequestException(`${m.name} needs the approval code or reference`);
    }
    await this.checkOnAccount(company.id, input, till, customer, methods, date, approvals, flags, pending);
    const paid = changeDue({ total: net, payments: input.payments.map((p) => ({ amount: p.amount, isCash: methods.get(p.paymentMethodId)?.kind === 'cash' })) });
    if (net.gte(0)) {
      if (paid.short.gt(0)) throw new BadRequestException(`₹${paid.short.toFixed(2)} is still to be paid`);
      if (paid.overpaidWithoutCash) throw new BadRequestException('More than the bill was entered without cash; only cash can give change');
      if (input.payments.some((p) => D(p.amount).lt(0))) throw new BadRequestException('A sale cannot have a refund payment');
    } else if (!paid.paid.eq(net)) {
      throw new BadRequestException(`The refund must be exactly ₹${net.neg().toFixed(2)}`);
    }
    if (!input.offline && input.expectedTotal !== undefined && !D(input.expectedTotal).eq(net)) {
      throw new ConflictException(`PRICE_CHANGED: the server total is ₹${net.toFixed(2)}, the till showed ₹${D(input.expectedTotal).toFixed(2)}; check the bill again`);
    }
    // Plan 06 answer 1: once live, only approved GST rates may be used.
    const provisional = [...(ret?.lines ?? []), ...(sale?.lines ?? [])].some((l) => l.provisional);
    // Only new sales are refused once live; a return of a bill from the test period must still be possible.
    if (settings.liveAllowed && (sale?.lines ?? []).some((l) => l.provisional) && !input.offline) throw new BadRequestException('A GST rate on this bill is not approved yet; the accountant must approve it');
    if (provisional) flags.add('gst_provisional');

    const saved = await this.prisma.$transaction(
      async (tx) => {
        const exchangeId = ret && sale ? input.clientId : null;
        const holder = net.gte(0) ? (sale ? 'sale' : 'return') : ret ? 'return' : 'sale';
        const created: string[] = [];
        for (const b of [ret, sale]) {
          if (!b) continue;
          const t = b.kind === 'sale' ? saleTotals! : retTotals!;
          const holds = holder === b.kind;
          const bill = await tx.posBill.create({
            data: {
              companyId: company.id,
              tillId: till.id,
              shiftId: shift.id,
              number: b.number,
              clientId: input.clientId,
              kind: b.kind,
              returnOfId: b.returnOfId,
              exchangeId,
              customerId: customer.id,
              cashierId,
              soldAt,
              businessDate: fromIso(date),
              grossAmount: t.gross.toFixed(2),
              discountAmount: t.discount.toFixed(2),
              taxableAmount: t.taxable.toFixed(2),
              cgst: t.cgst.toFixed(2),
              sgst: t.sgst.toFixed(2),
              igst: t.igst.toFixed(2),
              roundingAdjustment: t.adjustment.toFixed(2),
              total: t.total.toFixed(2),
              paidAmount: t.total.toFixed(2),
              changeAmount: holds ? paid.change.toFixed(2) : '0',
              couponId: b.couponId,
              billDiscount: b.billDiscount.toFixed(2),
              offline: input.offline,
              checkFlags: [...flags],
              gstProvisional: b.lines.some((l) => l.provisional),
              returnReason: b.returnReason,
              approvedById: b.approvedById,
              salesStaffId: b.salesStaffId,
              lines: { create: t.lines.map((l) => lineData(l)) },
              ...(holds ? { payments: { create: input.payments.filter((p) => !D(p.amount).eq(0)).map((p) => ({ paymentMethodId: p.paymentMethodId, amount: D(p.amount).toFixed(2), reference: p.reference ?? null })) } } : {}),
            },
            include: billInclude,
          });
          await this.postStock(tx, bill, b, till, actor, flags);
          if (b.kind === 'return' && b.returnOfId) {
            for (const l of b.lines) {
              if (!l.returnOfLineId) continue;
              const orig = await tx.posBillLine.findUniqueOrThrow({ where: { id: l.returnOfLineId } });
              await tx.posBillLine.update({ where: { id: orig.id }, data: { returnedQuantity: D(orig.returnedQuantity).add(l.basicQuantity.abs()).toString() } });
            }
          }
          if (b.couponId) await this.offers.countCouponUse(tx, b.couponId, 1);
          if (b.delivery) await this.saveDelivery(tx, bill, b.delivery, till, customer, actor);
          await this.audit.record(tx, actor, {
            action: 'create',
            entityType: 'pos_bill',
            entityId: bill.id,
            changes: { number: bill.number, kind: bill.kind, total: bill.total.toString(), till: till.code, cashierId, ...(flags.size ? { flags: [...flags] } : {}), ...(approvals.length ? { approvals } : {}) },
          });
          created.push(bill.id);
        }
        if (flags.size) await tx.posBill.updateMany({ where: { id: { in: created } }, data: { checkFlags: [...flags] } });
        await this.common.markApprovalsUsed(tx, pending);
        for (const p of newPrices) {
          const row = await tx.price.create({ data: { priceListId: till.priceListId, itemId: p.itemId, unitId: p.unitId, price: p.price.toFixed(4), startDate: fromIso(date), createdById: actor.userId, updatedById: actor.userId } });
          await this.audit.record(tx, actor, { action: 'create', entityType: 'price', entityId: row.id, changes: { item: p.code, price: p.price.toFixed(2), from: 'typed on a till bill' } });
        }
        return tx.posBill.findMany({ where: { id: { in: created } }, include: billInclude, orderBy: { kind: 'desc' } });
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.transactionDto(saved, user, false);
  }

  /**
   * Plan 11 C1: the bill's and lines' salespeople are from the till's store and
   * in use. Offline, someone switched off or moved meanwhile is kept and flagged.
   */
  private async checkSalesStaff(companyId: string, till: TillWithRefs, input: PosTransactionInput, flags: Set<string>) {
    const ids = new Set<string>();
    if (input.salesStaffId) ids.add(input.salesStaffId);
    for (const l of [...(input.sale?.lines ?? []), ...(input.ret?.lines ?? [])]) if (l.salesStaffId) ids.add(l.salesStaffId);
    if (!ids.size) return;
    const rows = await this.prisma.salesStaff.findMany({ where: { id: { in: [...ids] } } });
    for (const id of ids) {
      const s = rows.find((r) => r.id === id);
      if (!s || s.companyId !== companyId) throw new BadRequestException('Salesperson not found');
      if (s.storeId !== till.storeId || !s.active) {
        if (!input.offline) throw new BadRequestException(s.active ? `${s.name} (${s.code}) is not a salesperson of this store` : `${s.name} (${s.code}) is switched off as a salesperson`);
        flags.add('sales_staff_changed');
      }
    }
  }

  /** Plan 11 B4 (decision 46): the delivery details, saved with the bill. */
  private async saveDelivery(tx: Db, bill: BillRow, d: NonNullable<BuiltBill['delivery']>, till: TillWithRefs, customer: Customer, actor: Actor) {
    const row = await tx.posDelivery.create({
      data: {
        companyId: bill.companyId,
        storeId: till.storeId,
        billId: bill.id,
        customerId: customer.isWalkIn ? null : customer.id,
        name: d.name ?? (customer.isWalkIn ? null : customer.name),
        address: d.address,
        phone: d.phone ?? customer.mobile ?? null,
        deliverOn: d.deliverOn ? fromIso(d.deliverOn) : null,
        chargeAmount: d.charge.toFixed(2),
        remarks: d.remarks ?? null,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.audit.record(tx, actor, { action: 'create', entityType: 'pos_delivery', entityId: row.id, changes: { bill: bill.number, address: row.address, deliverOn: iso(row.deliverOn), charge: row.chargeAmount.toFixed(2) } });
  }

  /** The bill's number must be the till's own (pos-offline §3): STORE-TILL-FY-000001. */
  private checkNumber(number: string, till: TillWithRefs, fyName: string) {
    const prefix = `${till.seriesKind}-${fyName}-`;
    if (!number.startsWith(prefix) || !/^\d{6}$/.test(number.slice(prefix.length))) {
      throw new BadRequestException(`Bill number ${number} is not in this till’s series (${prefix}000001)`);
    }
  }

  /**
   * Selling on account (plan 07 §1a, decision 22): online only, for a named
   * customer approved for credit; above the limit or with too much overdue a
   * store manager's PIN is needed, and the override is logged on the bill.
   */
  private async checkOnAccount(
    companyId: string,
    input: PosTransactionInput,
    till: TillWithRefs,
    customer: Customer,
    methods: Map<string, TillWithRefs['paymentMethods'][number]['paymentMethod']>,
    date: string,
    approvals: string[],
    flags: Set<string>,
    pending: PendingApproval[],
  ) {
    const onAccount = input.payments.filter((p) => methods.get(p.paymentMethodId)?.kind === 'on_account').reduce((s, p) => s.add(D(p.amount)), new Decimal(0));
    if (onAccount.isZero()) return;
    if (input.offline) throw new BadRequestException('On account needs the connection: the customer’s balance is checked on the server');
    if (customer.isWalkIn) throw new BadRequestException('Choose the customer to sell on account');
    if (customer.status !== 'active') throw new BadRequestException(`${customer.name} is ${customer.status === 'blocked' ? 'blocked' : 'switched off'}; they cannot buy on account`);
    if (onAccount.lt(0)) return; // A refund on account only reduces what they owe.
    // Plan 11 A7: the customer's own limits, else the group's; a group may skip the check altogether.
    const terms = await this.customers.creditTermsFor(this.prisma, customer);
    if (terms.skip) return;
    const owed = (await this.ledger.partyBalance(this.prisma, 'customer', customer.id)).add(await this.pendingOnAccount(customer.id));
    const overdue = (await this.ledger.openItems(this.prisma, 'customer', customer.id))
      .filter((i) => i.owed.gt(0) && (i.dueDate ?? i.date) < date)
      .reduce((s, i) => s.add(i.owed), new Decimal(0));
    const verdict = creditCheck({ creditLimit: terms.creditLimit.toString(), owed, thisBill: onAccount, overdue, overdueLimit: terms.overdueLimit.toString() });
    if (verdict.ok) return;
    if (!verdict.canOverride) throw new BadRequestException(verdict.reason);
    if (!input.creditApprovalToken) throw new ForbiddenException(`${verdict.reason}. A manager must approve`);
    const managerId = await this.common.useApproval(this.prisma, input.creditApprovalToken, till.id, ['credit_over_limit'], `${customer.code} ₹${onAccount.toFixed(2)}`, pending);
    approvals.push(`credit over limit ${customer.code} ₹${onAccount.toFixed(2)} by ${managerId}`);
    flags.add('credit_override');
  }

  /** On-account amounts on bills whose shift has not closed yet (not in the ledger until the shift posts). */
  private async pendingOnAccount(customerId: string): Promise<Decimal> {
    const sum = await this.prisma.posPayment.aggregate({
      where: { paymentMethod: { kind: 'on_account' }, bill: { customerId, status: 'completed', shift: { status: 'open' } } },
      _sum: { amount: true },
    });
    return D(sum._sum.amount ?? 0);
  }

  private async customerFor(companyId: string, input: PosTransactionInput, actor: Actor, flags: Set<string>): Promise<Customer> {
    if (input.newCustomer) {
      const nc = input.newCustomer;
      const byRef = await this.prisma.customer.findFirst({ where: { companyId, offlineTillRef: nc.clientId } });
      if (byRef) return byRef;
      // Decision 20: never a second customer with the same mobile; use the existing one and note it.
      const byMobile = await this.prisma.customer.findFirst({ where: { companyId, mobile: nc.mobile } });
      if (byMobile) {
        flags.add('customer_matched_by_mobile');
        return byMobile;
      }
      // Plan 11 C10: a birthday or anniversary that is not a real date is left out (and noted), never a reason to refuse the bill.
      const dates: Pick<QuickAddCustomerInput, 'birthday' | 'birthYear' | 'anniversary' | 'anniversaryYear'> = {};
      const today = businessDate();
      for (const [dm, yr] of [
        ['birthday', 'birthYear'],
        ['anniversary', 'anniversaryYear'],
      ] as const) {
        if (!nc[dm]) continue;
        if (dayMonthYearProblem(nc[dm], nc[yr] ?? null, today)) flags.add('customer_dates_left_out');
        else Object.assign(dates, { [dm]: nc[dm], [yr]: nc[yr] ?? null });
      }
      const created = await this.customers.quickAdd({ name: nc.name, mobile: nc.mobile, ...dates }, actor);
      return this.prisma.customer.update({ where: { id: created.id }, data: { offlineTillRef: nc.clientId } });
    }
    if (input.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!c || c.companyId !== companyId) throw new BadRequestException('Customer not found');
      if (c.status === 'off' && !input.offline) throw new BadRequestException(`Customer ${c.code} is switched off`);
      return c;
    }
    const settings = await this.partySettings.get();
    if (!settings.walkInCustomerId) throw new BadRequestException('No walk-in customer is set up');
    return this.prisma.customer.findUniqueOrThrow({ where: { id: settings.walkInCustomerId } });
  }

  // ---- Building lines ----

  private async lineBasics(l: PosLineInput) {
    const item = await this.items.assertItemUsable(this.prisma, l.itemId, 'sale');
    const unitId = l.unitId ?? item.baseUnitId;
    const iu = await this.prisma.itemUnit.findUnique({ where: { itemId_unitId: { itemId: item.id, unitId } }, include: { unit: true } });
    if (!iu) throw new BadRequestException(`${item.code}: the unit must be one of the item’s units`);
    const problem = quantityProblem(l.quantity, iu.unit);
    if (problem) throw new BadRequestException(`${item.code}: ${problem}`);
    const factor = D(iu.factor);
    const quantity = roundQuantity(l.quantity);
    const mrp = iu.mrp ? D(iu.mrp) : item.mrp ? D(item.mrp).mul(factor) : null;
    return { item, unitId, factor, quantity, basicQuantity: roundQuantity(quantity.mul(factor)), mrp };
  }

  private async buildSale(ctx: BuildContext, offerCtx: Parameters<OffersService['activeOffers']>[1], couponId: string | null): Promise<BuiltBill> {
    const { till, date, input, user, flags } = ctx;
    const part = input.sale!;
    const offers = await this.offers.activeOffers(this.prisma, offerCtx);
    const billStaff = input.salesStaffId ?? null;
    const lines: BuiltLine[] = [];
    // Online, free lines are worked out here from the offers; offline the till's free lines are kept as sold.
    const sentFree = part.lines.filter((l) => l.freeOfLineNo);

    // 1. Price, approvals and GST of each line.
    const priced: PricedLine[] = [];
    for (const l of part.lines.filter((x) => !x.freeOfLineNo)) {
      const b = await this.lineBasics(l);
      const code = b.item.code;
      let listPrice: Decimal;
      let typedNewPrice = false;
      try {
        const found = await this.pricing.lookup({ itemId: b.item.id, unitId: b.unitId, priceListId: till.priceListId, date, quantity: l.quantity, customerId: input.customerId ?? undefined, batchId: l.batchId ?? undefined }, user);
        if (!found.found || found.rate === null) throw new BadRequestException(`${code} has no price in the till’s price list`);
        listPrice = D(found.rate);
      } catch (err) {
        if (input.offline && l.charged) {
          listPrice = D(l.charged.listPrice);
          flags.add('price_missing');
        } else if (!input.offline && ctx.catalogue.saveTyped && l.price !== undefined && err instanceof BadRequestException) {
          // Plan 11 A2 (blueprint 04): with no price in the list, the typed price is used and saved.
          listPrice = D(l.price);
          typedNewPrice = true;
        } else {
          throw err;
        }
      }
      let approvedById: string | null = null;
      let price = listPrice;
      // A cashier changes prices freely only where both the company and the till allow it; otherwise a manager approves.
      const cashierMayChangePrice = till.allowPriceChange && ctx.catalogue.allowPriceChange;
      if (typedNewPrice) {
        if (!cashierMayChangePrice) {
          approvedById = await this.common.useApproval(this.prisma, l.approvalToken, till.id, ['price_change'], `line ${l.lineNo}`, ctx.pending);
          ctx.approvals.push(`price ${code}`);
        }
        ctx.newPrices.push({ itemId: b.item.id, code, unitId: b.unitId, price: listPrice });
      } else if (l.price !== undefined && !D(l.price).eq(listPrice)) {
        if (input.offline) {
          price = D(l.price);
        } else {
          if (!cashierMayChangePrice) {
            approvedById = await this.common.useApproval(this.prisma, l.approvalToken, till.id, ['price_change'], `line ${l.lineNo}`, ctx.pending);
            ctx.approvals.push(`price ${code}`);
          }
          price = D(l.price);
        }
      }
      // Offers apply to the list price; a typed price switches them off for the line (blueprint 04).
      const forOffers = { id: b.item.id, parentItemId: b.item.parentItemId, brandId: b.item.brandId, itemGroup: await this.groupOf(b.item.itemGroupId) };
      const covering = price.eq(listPrice) ? offers.filter((o) => o.appliesTo !== 'bill' && this.offers.covers(o, forOffers)) : [];
      const gst = await this.common.gstRateFor(this.prisma, b.item, date);
      const manualPct = D(l.discountPercent ?? '0');
      const verdict = checkDiscount({
        listPrice,
        price,
        mrp: b.mrp,
        manualDiscountPercent: manualPct,
        itemMaxPercent: b.item.maxDiscountPercent.toString(),
        cashierLimitPercent: till.cashierDiscountPercent.toString(),
        approved: !!approvedById,
      });
      if (!verdict.ok) {
        if (!verdict.needsApproval) throw new BadRequestException(`${code}: ${verdict.reason}`);
        // Offline, only an approval the till obtained before the connection dropped is accepted.
        if (input.offline && !l.approvalToken) throw new BadRequestException(`${code}: ${verdict.reason}`);
        approvedById = await this.common.useApproval(this.prisma, l.approvalToken, till.id, ['discount', 'price_change'], `line ${l.lineNo}`, ctx.pending);
        ctx.approvals.push(`discount ${code} ${manualPct.toFixed(2)}%`);
      }
      priced.push({ l, b, listPrice, price, approvedById, gst, manualPct, covering });
    }

    // 2. The offers of the whole bill (decision 17; plan 11 B3): line offers, mix and match, buy X get Y.
    const freeItems = new Map<string, FreeItemInfo | null>();
    for (const o of offers) {
      if (o.kind === 'buy_get' && o.freeItemId && priced.some((p) => p.covering.includes(o))) freeItems.set(o.id, await this.freeItemInfo(o.freeItemId, till, date, input.customerId ?? undefined, user));
    }
    const planned = new Map(offers.map((o) => [o.id, this.offers.planOffer(o, freeItems.get(o.id)?.value ?? null)]));
    const plan = planOffers(priced.map((p) => ({ lineNo: p.l.lineNo, quantity: p.b.quantity, price: p.price, offers: p.covering.map((o) => planned.get(o.id)!), countable: p.manualPct.isZero() })));

    // 3. Amounts, the below-cost check and stock details.
    for (const p of priced) {
      const { l, b, listPrice, price, gst, manualPct } = p;
      let approvedById = p.approvedById;
      const code = b.item.code;
      const chosen = plan.lines.get(l.lineNo) ?? null;
      const offerDiscount = chosen?.discount ?? new Decimal(0);
      const { amount, discount } = saleLineAmount({ quantity: b.quantity, price, discountPercent: manualPct, discountAmount: offerDiscount });
      // Mix-and-match prices are the owner's own promotion, like free lines: never refused as below cost.
      const promoted = !!chosen && isCountedOffer(chosen.offer.kind) && offerDiscount.gt(0);
      if (ctx.catalogue.blockBelowCost && b.basicQuantity.gt(0) && !promoted) {
        // Plan 11 A2 (blueprint 04): net price per basic unit, before GST, not below the last purchase price or the current cost.
        const net = roundMoney(amount.div(D(1).add(D(gst.rate).div(100))).div(b.basicQuantity));
        const lastBought = D(b.item.lastPurchasePrice ?? 0);
        const cost = b.item.isStockItem ? D(await this.currentCost(this.prisma, b.item.id, till.locationId)) : new Decimal(0);
        const floor = roundMoney(Decimal.max(lastBought, cost));
        if (net.lt(floor)) {
          if (input.offline) flags.add('below_cost');
          else if (!approvedById) {
            if (!l.approvalToken) throw new BadRequestException(`${code}: this price is below cost; a manager must approve it`);
            approvedById = await this.common.useApproval(this.prisma, l.approvalToken, till.id, ['price_change', 'discount'], `line ${l.lineNo}`, ctx.pending);
          }
          if (!input.offline) ctx.approvals.push(`below cost ${code}`);
        }
      }
      const stock = await this.stockDetails(b.item, l, till, date, b.basicQuantity, input.offline, flags);
      const line: BuiltLine = {
        lineNo: l.lineNo,
        item: b.item,
        unitId: b.unitId,
        factor: b.factor,
        quantity: b.quantity,
        basicQuantity: b.basicQuantity,
        barcode: l.barcode ?? null,
        ...stock,
        mrp: b.mrp,
        listPrice,
        price,
        discountPercent: manualPct,
        discountAmount: discount,
        offerDiscount,
        offerId: chosen?.offer.id ?? null,
        isFree: false,
        gstRate: D(gst.rate),
        provisional: !gst.approvedAt,
        amount,
        returnOfLineId: null,
        approvedById,
        costSourceId: null,
        salesStaffId: l.salesStaffId ?? billStaff,
      };
      // Offline bills are recorded as charged; differences go on the check report (pos-offline §5).
      if (input.offline && l.charged) this.applyCharged(line, l, flags);
      lines.push(line);
      if (!input.offline && chosen && chosen.freeQuantity.gt(0)) {
        const free = chosen.freeQuantity;
        lines.push({
          ...line,
          lineNo: 1000 + l.lineNo,
          quantity: free,
          basicQuantity: roundQuantity(free.mul(b.factor)),
          ...(await this.stockDetails(b.item, { ...l, serialNumbers: [] }, till, date, roundQuantity(free.mul(b.factor)), input.offline, flags)),
          price: new Decimal(0),
          listPrice,
          discountPercent: new Decimal(0),
          discountAmount: new Decimal(0),
          offerDiscount: new Decimal(0),
          isFree: true,
          amount: new Decimal(0),
          approvedById: null,
        });
      }
    }
    // Buy X, get Y (plan 11 B3): the other item at ₹0, after the first line that counted; it leaves stock at its cost.
    if (!input.offline) {
      for (const f of plan.freeItems) {
        const info = freeItems.get(f.offer.id);
        const parent = lines.find((x) => x.lineNo === f.ofLineNo);
        if (!info || !parent) continue;
        const basic = roundQuantity(f.quantity.mul(info.factor));
        const freeLine = { lineNo: 1000 + f.ofLineNo, itemId: info.item.id, quantity: f.quantity.toString(), serialNumbers: [] } as PosLineInput;
        lines.push({
          lineNo: 1000 + f.ofLineNo,
          item: info.item,
          unitId: info.unitId,
          factor: info.factor,
          quantity: f.quantity,
          basicQuantity: basic,
          barcode: null,
          ...(await this.stockDetails(info.item, freeLine, till, date, basic, false, flags)),
          mrp: info.mrp,
          listPrice: info.value,
          price: new Decimal(0),
          discountPercent: new Decimal(0),
          discountAmount: new Decimal(0),
          offerDiscount: new Decimal(0),
          offerId: f.offer.id,
          isFree: true,
          gstRate: info.gstRate,
          provisional: info.provisional,
          amount: new Decimal(0),
          returnOfLineId: null,
          approvedById: null,
          costSourceId: null,
          salesStaffId: parent.salesStaffId,
        });
      }
    }
    if (input.offline) {
      for (const f of sentFree) {
        const b = await this.lineBasics(f);
        const parent = lines.find((x) => x.lineNo === f.freeOfLineNo);
        // A free line of another item (buy X, get Y) keeps its own GST rate and price.
        const own = parent && parent.item.id !== b.item.id ? await this.freeItemInfo(b.item.id, till, date, input.customerId ?? undefined, user) : null;
        lines.push({
          lineNo: f.lineNo,
          item: b.item,
          unitId: b.unitId,
          factor: b.factor,
          quantity: b.quantity,
          basicQuantity: b.basicQuantity,
          barcode: f.barcode ?? null,
          ...(await this.stockDetails(b.item, f, till, date, b.basicQuantity, true, flags)),
          mrp: b.mrp,
          listPrice: own ? own.value : (parent?.listPrice ?? new Decimal(0)),
          price: new Decimal(0),
          discountPercent: new Decimal(0),
          discountAmount: new Decimal(0),
          offerDiscount: new Decimal(0),
          offerId: f.offerId ?? parent?.offerId ?? null,
          isFree: true,
          gstRate: own ? own.gstRate : (parent?.gstRate ?? new Decimal(0)),
          provisional: own ? own.provisional : (parent?.provisional ?? true),
          amount: new Decimal(0),
          returnOfLineId: null,
          approvedById: null,
          costSourceId: null,
          salesStaffId: f.salesStaffId ?? parent?.salesStaffId ?? billStaff,
        });
      }
    }

    // Whole-bill discount: typed by hand (with approval above the cashier's limit) or the best bill offer.
    const paidLines = lines.filter((l) => !l.isFree);
    const base = paidLines.reduce((s, l) => s.add(l.amount), new Decimal(0));
    let billDiscount = new Decimal(0);
    let manualBillDiscount = false;
    if (part && input.billDiscount && (input.billDiscount.percent || input.billDiscount.amount) && !input.offline) {
      manualBillDiscount = true;
      billDiscount = input.billDiscount.amount ? roundMoney(input.billDiscount.amount) : roundMoney(base.mul(D(input.billDiscount.percent!)).div(100));
      const pct = base.gt(0) ? billDiscount.div(base).mul(100) : new Decimal(0);
      if (pct.gt(D(till.cashierDiscountPercent))) {
        await this.common.useApproval(this.prisma, input.billDiscount.approvalToken, till.id, ['bill_discount', 'discount'], 'bill discount', ctx.pending);
        ctx.approvals.push(`bill discount ${billDiscount.toFixed(2)}`);
      }
    } else if (!input.offline) {
      const billOffer = this.offers.bestBillOffer(offers, base);
      if (billOffer) billDiscount = billOffer.saving;
    }
    if (billDiscount.gt(base)) throw new BadRequestException('The bill discount is more than the bill');
    if (billDiscount.gt(0)) {
      const shares = shareByWeight(billDiscount, paidLines.map((l) => l.amount));
      paidLines.forEach((l, i) => {
        l.amount = l.amount.sub(shares[i]);
        l.discountAmount = l.discountAmount.add(shares[i]);
      });
      // A discount typed by hand still respects each item's maximum; offers and coupons are the owner's own promotions.
      for (const l of manualBillDiscount ? paidLines : []) {
        const pct = effectiveDiscountPercent(l.listPrice, l.quantity, l.amount);
        if (pct.gt(D(l.item.maxDiscountPercent)) && l.offerDiscount.eq(0)) throw new BadRequestException(`${l.item.code}: the bill discount takes it above its maximum discount of ${D(l.item.maxDiscountPercent).toFixed(2)}%`);
      }
    }

    // Home delivery (plan 11 B4, decision 47): the store's charge as a service line, none at or above "free above".
    let delivery: BuiltBill['delivery'] = null;
    if (input.delivery) {
      const d = input.delivery;
      if (!input.offline && d.deliverOn && d.deliverOn < date) throw new BadRequestException('The delivery date cannot be before the bill date');
      const goods = lines.reduce((s, l) => s.add(l.amount), new Decimal(0));
      const store = await this.prisma.store.findUniqueOrThrow({ where: { id: till.storeId } });
      let charge = deliveryChargeFor(goods, store.deliveryCharge.toString(), store.deliveryFreeAbove?.toString() ?? null);
      if (input.offline && d.charge !== undefined) {
        if (!D(d.charge).eq(charge)) flags.add('delivery_charge_changed');
        charge = roundMoney(d.charge);
      }
      if (charge.gt(0)) {
        if (!ctx.settings.deliveryItemId) throw new BadRequestException('Choose the delivery charge item in the till settings first');
        const item = await this.items.assertItemUsable(this.prisma, ctx.settings.deliveryItemId, 'sale');
        const gst = await this.common.gstRateFor(this.prisma, item, date);
        lines.push({
          lineNo: deliveryLineNo(part.lines),
          item,
          unitId: item.baseUnitId,
          factor: new Decimal(1),
          quantity: new Decimal(1),
          basicQuantity: new Decimal(1),
          barcode: null,
          batchId: null,
          serialNumbers: [],
          mrp: null,
          listPrice: charge,
          price: charge,
          discountPercent: new Decimal(0),
          discountAmount: new Decimal(0),
          offerDiscount: new Decimal(0),
          offerId: null,
          isFree: false,
          gstRate: D(gst.rate),
          provisional: !gst.approvedAt,
          amount: charge,
          returnOfLineId: null,
          approvedById: null,
          costSourceId: null,
          // A delivery charge is not a salesperson's sale.
          salesStaffId: null,
        });
      }
      delivery = { ...d, charge };
    }
    return { kind: 'sale', number: part.number, lines, returnOfId: null, returnReason: null, approvedById: null, couponId, billDiscount, salesStaffId: billStaff, delivery };
  }

  /**
   * The item a "buy X, get Y" offer gives (plan 11 B3): its unit, GST rate and
   * what one unit is worth (its price, else its MRP). Null when it cannot be
   * sold, so the offer is not used; the till does the same.
   */
  private async freeItemInfo(itemId: string, till: TillWithRefs, date: string, customerId: string | undefined, user: CurrentUser): Promise<FreeItemInfo | null> {
    let item: Item;
    try {
      item = await this.items.assertItemUsable(this.prisma, itemId, 'sale');
    } catch {
      return null;
    }
    let value: Decimal | null = null;
    try {
      const found = await this.pricing.lookup({ itemId: item.id, unitId: item.baseUnitId, priceListId: till.priceListId, date, quantity: '1', customerId }, user);
      if (found.found && found.rate !== null) value = D(found.rate);
    } catch {
      // No price in the list: its MRP below.
    }
    value = value ?? (item.mrp ? D(item.mrp) : null);
    if (!value || value.lte(0)) return null;
    const rate = await this.common.gstRateFor(this.prisma, item, date).catch(() => null);
    return { item, unitId: item.baseUnitId, factor: new Decimal(1), mrp: item.mrp ? D(item.mrp) : null, value, gstRate: D(rate?.rate ?? 0), provisional: !rate?.approvedAt };
  }

  /** Offline: keep what the till charged; flag where the server would differ (pos-offline §5). */
  private applyCharged(line: BuiltLine, l: PosLineInput, flags: Set<string>) {
    const c = l.charged!;
    const recomputed = roundMoney(D(c.price).mul(line.quantity)).sub(D(c.discountAmount)).sub(D(c.offerDiscount ?? '0'));
    if (recomputed.sub(D(c.lineTotal)).abs().gt('0.01')) throw new BadRequestException(`Line ${l.lineNo}: the till’s figures do not add up`);
    if (!D(c.listPrice).eq(line.listPrice) || !D(c.price).eq(line.price)) flags.add('price_changed');
    if (!D(c.offerDiscount ?? '0').eq(line.offerDiscount)) flags.add('offer_changed');
    if (!D(c.gstRate).eq(line.gstRate)) flags.add('gst_changed');
    line.listPrice = D(c.listPrice);
    line.price = D(c.price);
    line.offerDiscount = D(c.offerDiscount ?? '0');
    line.discountAmount = D(c.discountAmount).add(line.offerDiscount);
    line.gstRate = D(c.gstRate);
    line.amount = D(c.lineTotal);
  }

  private async groupOf(itemGroupId: string) {
    const g = await this.prisma.itemGroup.findUniqueOrThrow({ where: { id: itemGroupId }, select: { id: true, path: true } });
    return g;
  }

  /** Batch (earliest unexpired with stock, decision 13) and serial numbers for a sale line. */
  private async stockDetails(item: Item, l: PosLineInput, till: TillWithRefs, date: string, basic: Decimal, offline: boolean, flags: Set<string>) {
    let batchId: string | null = null;
    if (item.isStockItem && item.trackBatches) {
      if (l.batchId) {
        const b = await this.prisma.batch.findUnique({ where: { id: l.batchId } });
        if (!b || b.itemId !== item.id) throw new BadRequestException(`${item.code}: batch not found`);
        if (isExpiredOn(iso(b.expiryDate), date)) {
          if (!offline) throw new BadRequestException(`Batch ${b.batchNumber} of ${item.code} expired on ${iso(b.expiryDate)}; it cannot be sold`);
          flags.add('expired_batch');
        }
        batchId = b.id;
      } else {
        const candidates = await this.prisma.batch.findMany({ where: { itemId: item.id, active: true }, include: { positions: { where: { locationId: till.locationId } } }, orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
        const usable = candidates.filter((b) => !isExpiredOn(iso(b.expiryDate), date));
        const withStock = usable.find((b) => b.positions.some((p) => D(p.quantity).gte(basic)));
        const pick = withStock ?? usable[0];
        if (!pick) throw new BadRequestException(`${item.code}: no batch that has not expired`);
        batchId = pick.id;
      }
    }
    const serials = (l.serialNumbers ?? []).map((s) => s.trim());
    if (item.isStockItem && item.trackSerials) {
      if (!basic.isInteger() || !basic.eq(serials.length)) throw new BadRequestException(`${item.code}: scan the ${basic.toString()} serial numbers`);
      const rows = await this.prisma.serialNumber.findMany({ where: { itemId: item.id, serial: { in: serials } } });
      const bad = serials.filter((s) => !rows.some((r) => r.serial === s && r.status === 'in_stock' && r.locationId === till.locationId));
      if (bad.length) {
        if (!offline) throw new BadRequestException(`${item.code}: serial ${bad.join(', ')} is not in stock at this till`);
        flags.add('serial_not_in_stock');
      }
    } else if (serials.length) {
      throw new BadRequestException(`${item.code} is not tracked by serial number`);
    }
    return { batchId, serialNumbers: serials };
  }

  /** Returns at the original prices, or without a bill with a manager's approval (decision 40). */
  private async buildReturn(ctx: { till: TillWithRefs; date: string; input: PosTransactionInput; user: CurrentUser; flags: Set<string>; customer: Customer; approvals: string[]; pending: PendingApproval[] }): Promise<BuiltBill> {
    const { till, date, input, user } = ctx;
    const part = input.ret!;
    const lines: BuiltLine[] = [];
    let approvedById: string | null = null;
    // Against a bill, the return carries the original bill's salesperson; without one, the salesperson chosen now.
    let billStaff: string | null = input.salesStaffId ?? null;
    if (part.returnOfId) {
      const orig = await this.prisma.posBill.findUnique({ where: { id: part.returnOfId }, include: { lines: { include: { item: true } } } });
      if (!orig || orig.kind !== 'sale' || orig.companyId !== till.companyId) throw new BadRequestException('The original bill was not found');
      billStaff = orig.salesStaffId;
      if (orig.status !== 'completed') throw new BadRequestException(`Bill ${orig.number} is cancelled`);
      if (orig.customerId !== ctx.customer.id) throw new BadRequestException('A return must be for the same customer as the original bill');
      for (const l of part.lines) {
        const o = orig.lines.find((x) => x.id === l.returnOfLineId);
        if (!o) throw new BadRequestException(`Line ${l.lineNo} is not on bill ${orig.number}`);
        if (l.itemId !== o.itemId) throw new BadRequestException(`Line ${l.lineNo}: the item must match the original bill`);
        const factor = D(o.factor);
        const qty = roundQuantity(l.quantity);
        const basic = roundQuantity(qty.mul(factor));
        const left = D(o.basicQuantity).sub(D(o.returnedQuantity)).sub(this.pendingReturned(lines, o.id));
        if (basic.gt(left.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${o.item.code}: only ${Decimal.max(0, left).toString()} left to return on bill ${orig.number}`);
        const serials = (l.serialNumbers ?? []).map((s) => s.trim());
        if (o.item.trackSerials) {
          if (!basic.eq(serials.length) || serials.some((s) => !o.serialNumbers.includes(s))) throw new BadRequestException(`${o.item.code}: the serial numbers must be ones sold on bill ${orig.number}`);
        }
        // The original net price per unit (after all discounts) is refunded.
        const amount = roundMoney(D(o.lineTotal).mul(qty).div(D(o.quantity))).neg();
        const outEntry = o.item.isStockItem ? await this.prisma.stockLedgerEntry.findFirst({ where: { documentId: orig.id, documentLineId: o.id, kind: 'out', isCancellation: false } }) : null;
        lines.push({
          lineNo: l.lineNo,
          item: o.item,
          unitId: o.unitId,
          factor,
          quantity: qty.neg(),
          basicQuantity: basic.neg(),
          barcode: null,
          batchId: o.batchId,
          serialNumbers: serials,
          mrp: o.mrp ? D(o.mrp) : null,
          listPrice: D(o.listPrice),
          price: D(o.price),
          discountPercent: D(o.discountPercent),
          discountAmount: roundMoney(D(o.discountAmount).mul(qty).div(D(o.quantity))),
          offerDiscount: new Decimal(0),
          offerId: o.offerId,
          isFree: o.isFree,
          gstRate: D(o.gstRate),
          // A return uses the original bill’s rate, so it is provisional exactly when that bill was.
          provisional: orig.gstProvisional,
          amount,
          returnOfLineId: o.id,
          approvedById: null,
          costSourceId: outEntry?.id ?? null,
          // Plan 11 C1: a return stays with the original line's salesperson.
          salesStaffId: o.salesStaffId,
        });
      }
    } else {
      if (input.offline) throw new BadRequestException('A return without a bill needs a manager and the connection');
      approvedById = await this.common.useApproval(this.prisma, part.approvalToken, till.id, ['return_without_bill'], 'return without bill', ctx.pending);
      ctx.approvals.push('return without bill');
      for (const l of part.lines) {
        const b = await this.lineBasics(l);
        const found = await this.pricing.lookup({ itemId: b.item.id, unitId: b.unitId, priceListId: till.priceListId, date, quantity: l.quantity }, user);
        if (!found.found || found.rate === null) throw new BadRequestException(`${b.item.code} has no price in the till’s price list`);
        const price = l.price !== undefined ? D(l.price) : D(found.rate);
        const gst = await this.common.gstRateFor(this.prisma, b.item, date);
        lines.push({
          lineNo: l.lineNo,
          item: b.item,
          unitId: b.unitId,
          factor: b.factor,
          quantity: b.quantity.neg(),
          basicQuantity: b.basicQuantity.neg(),
          barcode: l.barcode ?? null,
          batchId: l.batchId ?? null,
          serialNumbers: (l.serialNumbers ?? []).map((s) => s.trim()),
          mrp: b.mrp,
          listPrice: D(found.rate),
          price,
          discountPercent: new Decimal(0),
          discountAmount: new Decimal(0),
          offerDiscount: new Decimal(0),
          offerId: null,
          isFree: false,
          gstRate: D(gst.rate),
          provisional: !gst.approvedAt,
          amount: roundMoney(price.mul(b.quantity)).neg(),
          returnOfLineId: null,
          approvedById,
          costSourceId: null,
          salesStaffId: l.salesStaffId ?? input.salesStaffId ?? null,
        });
      }
    }
    return { kind: 'return', number: part.number, lines, returnOfId: part.returnOfId ?? null, returnReason: part.reason ?? null, approvedById, couponId: null, billDiscount: new Decimal(0), salesStaffId: billStaff, delivery: null };
  }

  private pendingReturned(lines: BuiltLine[], originalLineId: string): Decimal {
    return lines.filter((l) => l.returnOfLineId === originalLineId).reduce((s, l) => s.add(l.basicQuantity.abs()), new Decimal(0));
  }

  /** Per-line GST from prices that include it, and the bill totals rounded to the rupee. */
  private totals(lines: BuiltLine[], interState: boolean) {
    let gross = new Decimal(0);
    let discount = new Decimal(0);
    let taxable = new Decimal(0);
    let cgst = new Decimal(0);
    let sgst = new Decimal(0);
    let igst = new Decimal(0);
    let exact = new Decimal(0);
    const out = lines.map((l) => {
      const tax = inclusiveTax(l.amount, l.gstRate, interState);
      const lineGross = roundMoney(l.price.mul(l.quantity));
      gross = gross.add(lineGross);
      discount = discount.add(l.quantity.isNegative() ? l.discountAmount.neg() : l.discountAmount);
      taxable = taxable.add(tax.taxable);
      cgst = cgst.add(tax.cgst);
      sgst = sgst.add(tax.sgst);
      igst = igst.add(tax.igst);
      exact = exact.add(l.amount);
      return { ...l, tax };
    });
    const { rounded, adjustment } = roundBill(exact);
    return { lines: out, gross, discount, taxable, cgst, sgst, igst, total: rounded, adjustment };
  }

  // ---- Stock (decision 39: at once; decision 32: the till may go below zero) ----

  private async postStock(tx: Db, bill: BillRow, built: BuiltBill, till: TillWithRefs, actor: Actor, flags: Set<string>) {
    const movements: Movement[] = [];
    const lineIds: string[] = [];
    for (const l of bill.lines) {
      if (!l.item.isStockItem) continue;
      const b = built.lines.find((x) => x.lineNo === l.lineNo)!;
      const base = { companyId: bill.companyId, documentType: 'pos_bill', documentId: bill.id, documentLineId: l.id, itemId: l.itemId, locationId: till.locationId, batchId: l.batchId, postingDate: iso(bill.businessDate)!, postingAt: bill.soldAt, accountRole: COGS_ROLE, ledger: 'held' as const }; // posted at shift close (decision 39)
      const qty = D(l.basicQuantity).abs();
      if (qty.lte(0)) continue;
      if (built.kind === 'sale') movements.push({ ...base, kind: 'out', quantity: qty.toString() });
      else if (b.costSourceId) movements.push({ ...base, kind: 'in', quantity: qty.toString(), costSourceId: b.costSourceId });
      else movements.push({ ...base, kind: 'in', quantity: qty.toString(), incomingCost: await this.currentCost(tx, l.itemId, till.locationId) });
      lineIds.push(l.id);
    }
    // Rule 15 / decision 36: nothing is posted on or before the month-end stock lock; such bills post on the next open day.
    const inv = await tx.inventorySettings.findUnique({ where: { companyId: bill.companyId } });
    if (inv?.stockLockDate && iso(bill.businessDate)! <= iso(inv.stockLockDate)!) {
      const next = new Date(inv.stockLockDate.getTime() + 86_400_000);
      for (const m of movements) {
        m.postingDate = iso(next)!;
        m.postingAt = new Date(`${iso(next)}T00:01:00+05:30`);
      }
      flags.add('before_lock');
    }
    const entries: StockLedgerEntry[] = movements.length ? await this.engine.post(tx, movements, { allowNegative: true, actorId: actor.userId }) : [];
    if (entries.some((e) => e.wentNegative)) flags.add('stock_negative');
    let costTotal = new Decimal(0);
    for (const e of entries) {
      const v = D(e.valueChange).abs();
      costTotal = costTotal.add(built.kind === 'sale' ? v : v.neg());
      await tx.posBillLine.update({ where: { id: e.documentLineId }, data: { costValue: v.toFixed(2) } });
    }
    await tx.posBill.update({ where: { id: bill.id }, data: { costValue: costTotal.toFixed(2) } });
    // Serial numbers leave with the sale and come back with the return.
    for (const l of bill.lines) {
      if (!l.serialNumbers.length) continue;
      if (built.kind === 'sale') await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: l.serialNumbers } }, data: { status: 'out', locationId: null, outDocumentId: bill.id, updatedById: actor.userId } });
      else await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: l.serialNumbers } }, data: { status: 'in_stock', locationId: till.locationId, outDocumentId: null, updatedById: actor.userId } });
    }
    void lineIds;
  }

  private async currentCost(tx: Db, itemId: string, locationId: string): Promise<string> {
    const p = await tx.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
    if (p && D(p.unitCost).gt(0)) return p.unitCost.toString();
    const any = await tx.stockPosition.findFirst({ where: { itemId, unitCost: { gt: 0 } }, orderBy: { lastPostingAt: 'desc' } });
    if (any) return any.unitCost.toString();
    const item = await tx.item.findUnique({ where: { id: itemId } });
    return item?.lastPurchasePrice?.toString() ?? '0';
  }

  // ---- Cancelling (blueprint 09 process 7: same day, before the shift closes, with a manager) ----

  async cancel(id: string, reason: string, approvalToken: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'pos.sell');
    const bill = await this.getRow(this.prisma, id);
    const till = await this.common.usableTill(this.prisma, bill.tillId, user);
    if (bill.status === 'cancelled') throw new BadRequestException('Already cancelled');
    const shift = await this.prisma.shift.findUniqueOrThrow({ where: { id: bill.shiftId } });
    if (shift.status !== 'open') throw new BadRequestException('The shift of this bill is closed; make a return instead');
    const pair = bill.exchangeId ? await this.prisma.posBill.findMany({ where: { exchangeId: bill.exchangeId }, include: billInclude }) : [bill];
    for (const b of pair) {
      if (b.kind === 'sale' && (await this.prisma.posBill.count({ where: { returnOfId: b.id, status: 'completed', id: { notIn: pair.map((x) => x.id) } } }))) {
        throw new BadRequestException(`Goods from bill ${b.number} were returned; cancel the return first`);
      }
    }
    const managerId = await this.common.useApproval(this.prisma, approvalToken, till.id, ['cancel_bill'], bill.number);
    const after = await this.prisma.$transaction(
      async (tx) => {
        for (const b of pair) {
          await this.engine.reverseDocument(tx, b.id, (e) => e.documentLineId, { allowNegative: true, actorId: actor.userId });
          for (const l of b.lines) {
            if (l.serialNumbers.length) {
              if (b.kind === 'sale') await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: l.serialNumbers } }, data: { status: 'in_stock', locationId: till.locationId, outDocumentId: null } });
              else await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: l.serialNumbers } }, data: { status: 'out', locationId: null } });
            }
            if (b.kind === 'return' && l.returnOfLineId) {
              const orig = await tx.posBillLine.findUniqueOrThrow({ where: { id: l.returnOfLineId } });
              await tx.posBillLine.update({ where: { id: orig.id }, data: { returnedQuantity: Decimal.max(0, D(orig.returnedQuantity).sub(D(l.basicQuantity).abs())).toString() } });
            }
          }
          if (b.couponId) await this.offers.countCouponUse(tx, b.couponId, -1);
          // Plan 11 B4: a cancelled bill is not delivered.
          await tx.posDelivery.updateMany({ where: { billId: b.id, status: 'pending' }, data: { status: 'cancelled', remarks: `Bill cancelled: ${reason}`, updatedById: actor.userId } });
          await tx.posBill.update({ where: { id: b.id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason } });
          await this.audit.record(tx, actor, { action: 'update', entityType: 'pos_bill', entityId: b.id, changes: { status: { old: 'completed', new: 'cancelled' }, number: b.number, approvedBy: managerId }, reason });
        }
        return tx.posBill.findMany({ where: { id: { in: pair.map((b) => b.id) } }, include: billInclude });
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.transactionDto(after, user, false);
  }

  // ---- Reading ----

  async list(q: PosBillQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = user.allStores ? undefined : user.stores.map((s) => s.id);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.PosBillWhereInput = {
      companyId: company.id,
      ...(q.tillId ? { tillId: q.tillId } : {}),
      ...(q.shiftId ? { shiftId: q.shiftId } : {}),
      ...(q.cashierId ? { cashierId: q.cashierId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.storeId ? { till: { storeId: q.storeId } } : {}),
      ...(stores ? { till: { storeId: { in: stores } } } : {}),
      ...(q.search ? { number: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.posBill.findMany({ where, include: billInclude, orderBy: { soldAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.posBill.count({ where }),
    ]);
    const extras = await this.extras(rows);
    return { rows: rows.map((b) => this.billDto(b, user, extras)), total, page, pageSize };
  }

  async get(id: string, user: CurrentUser) {
    const b = await this.getRow(this.prisma, id);
    await this.common.usableTill(this.prisma, b.tillId, user).catch(() => {
      if (!hasPermission(user, 'pos.reports')) throw new ForbiddenException('You are not allowed to work in this store');
    });
    return this.billDto(b, user, await this.extras([b]));
  }

  /** Receipt data for printing again; marked as a duplicate and logged. */
  async reprint(id: string, actor: Actor, user: CurrentUser) {
    const b = await this.getRow(this.prisma, id);
    await this.common.usableTill(this.prisma, b.tillId, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.posBill.update({ where: { id }, data: { reprints: { increment: 1 } } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'pos_bill', entityId: id, changes: { reprint: b.reprints + 1, number: b.number } });
    });
    const row = await this.getRow(this.prisma, id);
    return this.receipt(row, true, await this.extras([row]));
  }

  async getRow(db: Db, id: string): Promise<BillRow> {
    const b = await db.posBill.findUnique({ where: { id }, include: billInclude });
    if (!b) throw new NotFoundException('Bill not found');
    return b;
  }

  /** The highest number this till has used in a financial year (pos-offline §3). */
  async lastNumber(tillId: string, prefix: string): Promise<string | null> {
    const b = await this.prisma.posBill.findFirst({ where: { tillId, number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
    return b?.number ?? null;
  }

  private async recordSyncProblem(till: TillWithRefs, input: PosTransactionInput, error: string) {
    await this.prisma.posSyncProblem.upsert({
      where: { tillId_clientId_kind: { tillId: till.id, clientId: input.clientId, kind: 'bill' } },
      create: { companyId: till.companyId, tillId: till.id, clientId: input.clientId, kind: 'bill', payload: input as unknown as Prisma.InputJsonValue, error },
      update: { error, payload: input as unknown as Prisma.InputJsonValue },
    });
  }

  // ---- Output ----

  /** Offer, salesperson and delivery details of these bills (plan 11 B3, B4, C1). */
  private async extras(bills: BillRow[]): Promise<BillExtras> {
    const offerIds = [...new Set(bills.flatMap((b) => b.lines.map((l) => l.offerId)).filter((x): x is string => !!x))];
    const staffIds = [...new Set(bills.flatMap((b) => [b.salesStaffId, ...b.lines.map((l) => l.salesStaffId)]).filter((x): x is string => !!x))];
    const [offers, staff, deliveries] = await Promise.all([
      offerIds.length ? this.prisma.offer.findMany({ where: { id: { in: offerIds } }, select: { id: true, code: true, name: true } }) : [],
      staffIds.length ? this.prisma.salesStaff.findMany({ where: { id: { in: staffIds } }, select: { id: true, code: true, name: true } }) : [],
      this.prisma.posDelivery.findMany({ where: { billId: { in: bills.map((b) => b.id) } } }),
    ]);
    return { offers: new Map(offers.map((o) => [o.id, o])), staff: new Map(staff.map((x) => [x.id, x])), deliveries: new Map(deliveries.map((d) => [d.billId, d])) };
  }

  private async transactionDto(bills: BillRow[], user: CurrentUser, repeated: boolean) {
    const extras = await this.extras(bills);
    const sale = bills.find((b) => b.kind === 'sale');
    const ret = bills.find((b) => b.kind === 'return');
    const change = bills.reduce((s, b) => s.add(D(b.changeAmount)), new Decimal(0));
    return {
      repeated,
      sale: sale ? this.billDto(sale, user, extras) : null,
      return: ret ? this.billDto(ret, user, extras) : null,
      net: bills.reduce((s, b) => s.add(D(b.total)), new Decimal(0)).toFixed(2),
      change: change.toFixed(2),
      receipts: bills.map((b) => this.receipt(b, false, extras)),
    };
  }

  billDto(b: BillRow, user: CurrentUser, extras: BillExtras) {
    const cost = hasPermission(user, 'stock.cost.view');
    const staff = (id: string | null) => (id ? (extras.staff.get(id) ?? null) : null);
    const delivery = extras.deliveries.get(b.id);
    return {
      id: b.id,
      number: b.number,
      kind: b.kind,
      status: b.status,
      till: { id: b.till.id, code: b.till.code, name: b.till.name },
      shiftId: b.shiftId,
      clientId: b.clientId,
      returnOfId: b.returnOfId,
      exchangeId: b.exchangeId,
      customerId: b.customerId,
      cashierId: b.cashierId,
      soldAt: b.soldAt,
      businessDate: iso(b.businessDate),
      grossAmount: b.grossAmount.toFixed(2),
      discountAmount: b.discountAmount.toFixed(2),
      billDiscount: b.billDiscount.toFixed(2),
      taxableAmount: b.taxableAmount.toFixed(2),
      cgst: b.cgst.toFixed(2),
      sgst: b.sgst.toFixed(2),
      igst: b.igst.toFixed(2),
      roundingAdjustment: b.roundingAdjustment.toFixed(2),
      total: b.total.toFixed(2),
      changeAmount: b.changeAmount.toFixed(2),
      ...(cost ? { costValue: b.costValue.toFixed(2) } : {}),
      offline: b.offline,
      checkFlags: b.checkFlags,
      gstProvisional: b.gstProvisional,
      returnReason: b.returnReason,
      cancelReason: b.cancelReason,
      reprints: b.reprints,
      salesStaffId: b.salesStaffId,
      salesStaff: staff(b.salesStaffId),
      offers: offersUsed(b, extras),
      delivery: delivery ? deliveryDto(delivery) : null,
      lines: b.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        item: { id: l.item.id, code: l.item.code, name: l.item.name, hsnCode: l.item.hsnCode },
        unitId: l.unitId,
        quantity: l.quantity.toString(),
        basicQuantity: l.basicQuantity.toString(),
        returnedQuantity: l.returnedQuantity.toString(),
        batchId: l.batchId,
        serialNumbers: l.serialNumbers,
        mrp: l.mrp?.toFixed(2) ?? null,
        listPrice: l.listPrice.toFixed(2),
        price: l.price.toFixed(2),
        discountPercent: l.discountPercent.toFixed(2),
        discountAmount: l.discountAmount.toFixed(2),
        offerDiscount: l.offerDiscount.toFixed(2),
        offerId: l.offerId,
        offerName: l.offerId ? (extras.offers.get(l.offerId)?.name ?? null) : null,
        salesStaffId: l.salesStaffId,
        salesStaff: staff(l.salesStaffId),
        isFree: l.isFree,
        gstRate: l.gstRate.toString(),
        taxableAmount: l.taxableAmount.toFixed(2),
        cgst: l.cgst.toFixed(2),
        sgst: l.sgst.toFixed(2),
        igst: l.igst.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        returnOfLineId: l.returnOfLineId,
        approvedById: l.approvedById,
        ...(cost ? { costValue: l.costValue.toFixed(2) } : {}),
      })),
      payments: b.payments.map((p) => ({ paymentMethod: p.paymentMethod, amount: p.amount.toFixed(2), reference: p.reference })),
    };
  }

  /** What the receipt shows (blueprint 16 "Till receipt"); the layout is approved with the GST module (decision 43). */
  receipt(b: BillRow, duplicate: boolean, extras: BillExtras) {
    const byRate = new Map<string, { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();
    for (const l of b.lines) {
      const k = l.gstRate.toString();
      const r = byRate.get(k) ?? { taxable: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) };
      byRate.set(k, { taxable: r.taxable.add(D(l.taxableAmount)), cgst: r.cgst.add(D(l.cgst)), sgst: r.sgst.add(D(l.sgst)), igst: r.igst.add(D(l.igst)) });
    }
    return {
      billId: b.id,
      number: b.number,
      kind: b.kind,
      duplicate,
      provisional: b.gstProvisional,
      soldAt: b.soldAt,
      till: b.till.code,
      footer: b.till.receiptFooter,
      lines: b.lines.map((l) => ({
        name: l.item.name,
        code: l.item.code,
        hsn: l.item.hsnCode,
        quantity: l.quantity.toString(),
        price: l.price.toFixed(2),
        discount: l.discountAmount.toFixed(2),
        amount: l.lineTotal.toFixed(2),
        free: l.isFree,
        serials: l.serialNumbers,
        offer: l.offerId ? (extras.offers.get(l.offerId)?.name ?? null) : null,
        salesStaff: l.salesStaffId ? (extras.staff.get(l.salesStaffId)?.code ?? null) : null,
      })),
      // Plan 11 B3: each offer used and what it saved the customer.
      offers: offersUsed(b, extras).map((o) => ({ name: o.name, saving: o.saving })),
      salesStaff: b.salesStaffId ? (extras.staff.get(b.salesStaffId)?.name ?? null) : null,
      delivery: extras.deliveries.has(b.id) ? deliveryDto(extras.deliveries.get(b.id)!) : null,
      gstTable: [...byRate.entries()].map(([rate, r]) => ({ rate, taxable: r.taxable.toFixed(2), cgst: r.cgst.toFixed(2), sgst: r.sgst.toFixed(2), igst: r.igst.toFixed(2) })),
      totals: { gross: b.grossAmount.toFixed(2), discount: b.discountAmount.toFixed(2), taxable: b.taxableAmount.toFixed(2), rounding: b.roundingAdjustment.toFixed(2), total: b.total.toFixed(2) },
      payments: b.payments.map((p) => ({ method: p.paymentMethod.name, amount: p.amount.toFixed(2), reference: p.reference })),
      change: b.changeAmount.toFixed(2),
    };
  }
}

/**
 * The offers used on a bill and what each saved: rupees off its lines, and
 * the worth of its free lines at their list price (plan 11 B3).
 */
function offersUsed(b: BillRow, extras: BillExtras) {
  const used = new Map<string, Decimal>();
  for (const l of b.lines) {
    if (!l.offerId) continue;
    const saving = l.isFree ? D(l.listPrice).mul(D(l.quantity)) : D(l.offerDiscount);
    used.set(l.offerId, (used.get(l.offerId) ?? new Decimal(0)).add(saving));
  }
  return [...used.entries()].map(([id, saving]) => ({ id, code: extras.offers.get(id)?.code ?? null, name: extras.offers.get(id)?.name ?? 'Offer', saving: roundMoney(saving.abs()).toFixed(2) }));
}

export function deliveryDto(d: PosDelivery) {
  return {
    id: d.id,
    billId: d.billId,
    name: d.name,
    address: d.address,
    phone: d.phone,
    deliverOn: iso(d.deliverOn),
    status: d.status,
    chargeAmount: d.chargeAmount.toFixed(2),
    deliveredAt: d.deliveredAt,
    deliveredById: d.deliveredById,
    remarks: d.remarks,
  };
}

function lineData(l: BuiltLine & { tax: ReturnType<typeof inclusiveTax> }) {
  return {
    lineNo: l.lineNo,
    itemId: l.item.id,
    unitId: l.unitId,
    factor: l.factor.toString(),
    quantity: l.quantity.toString(),
    basicQuantity: l.basicQuantity.toString(),
    barcode: l.barcode,
    batchId: l.batchId,
    serialNumbers: l.serialNumbers,
    mrp: l.mrp?.toFixed(2) ?? null,
    listPrice: l.listPrice.toString(),
    price: l.price.toString(),
    discountPercent: l.discountPercent.toFixed(2),
    discountAmount: l.discountAmount.toFixed(2),
    offerDiscount: l.offerDiscount.toFixed(2),
    offerId: l.offerId,
    isFree: l.isFree,
    gstRate: l.gstRate.toString(),
    taxableAmount: l.tax.taxable.toFixed(2),
    cgst: l.tax.cgst.toFixed(2),
    sgst: l.tax.sgst.toFixed(2),
    igst: l.tax.igst.toFixed(2),
    lineTotal: l.amount.toFixed(2),
    returnOfLineId: l.returnOfLineId,
    approvedById: l.approvedById,
    salesStaffId: l.salesStaffId,
  };
}
