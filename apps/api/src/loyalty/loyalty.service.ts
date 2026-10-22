// Copyright (c) 2026, Rademics. All rights reserved.
// Loyalty points (plan 13 §1; blueprint 04 processes 6 and 7; decisions 15
// and 16). Points are kept as lots: each earned entry remembers how many of
// its points are still unspent ("remaining"); spending takes from the
// earliest-expiring lots, returns and cancellations put points back on the
// lots they came from, and the nightly job expires what is left on a lot after
// its expiry day. A customer's balance is the sum of their entries and always
// equals the sum of what is left on their lots.
//
// Accounts (decision 15, points are a liability): till bills reach the ledger
// when their shift closes (decision 39), so points earned on a bill (and taken
// back by a return) post with the shift: debit loyalty expense, credit loyalty
// points liability. Points spent are a payment method whose account is the
// liability, so the shift entry debits it like any other payment. Expiry and a
// change of the point value post at once.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  addDays,
  businessDate,
  type CurrentUser,
  type CustomerLoyaltyDto,
  Decimal,
  drawFromLots,
  GIFT_CARD_PAYMENT_ROLE,
  hasPermission,
  INDIA_TIME_ZONE,
  isUsableOn,
  LOYALTY_PAYMENT_ROLE,
  type LoyaltyEntryDto,
  type LoyaltyExpiryTo,
  type LoyaltyReportQuery,
  type LoyaltySettingsDto,
  type LoyaltySettingsInput,
  type LoyaltyTierDto,
  type LoyaltyTierInput,
  pointsBack,
  pointsExpireOn,
  pointsFor,
  pointsValue,
  type ReceiptLoyalty,
  redeemProblem,
  roundMoney,
  tierFor,
  tiersProblem,
  tierWindowStart,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { Customer, LoyaltyEntry, LoyaltySettings, LoyaltyTier, Prisma } from '../generated/prisma/client.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';
import { moduleOffError, moduleOn } from '../modules/module-map.js';
import { forEachShop } from '../prisma/each-shop.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';

type Amount = { toString(): string } | string | number;
export const D = (v: Amount) => new Decimal(v.toString());
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);
const ZERO = new Decimal(0);

/** How many days ahead "expiring soon" looks on the customer page and at the till. */
const SOON_DAYS = 30;

/** A bill as the loyalty hooks need it. */
export interface LoyaltyBill {
  id: string;
  kind: 'sale' | 'return';
  total: Decimal;
  returnOfId: string | null;
}

/** What the till asked for: points paid with on this transaction. */
export interface RedeemPlan {
  points: number;
  value: Decimal;
  pointValue: Decimal;
}

/** Points to give back on a return (decision 16), worked out with the refund split. */
export interface RestorePlan {
  originalBillId: string;
  points: number;
  pointValue: Decimal;
}

/** What a return takes back of the points earned on its original bill (decision 16). */
export interface ReturnPoints {
  originalBillId: string;
  /** Points spent on the original bill and given back by earlier returns. */
  spent: number;
  restoredBefore: number;
  /** Points earned on the original bill and taken back by earlier returns. */
  earned: number;
  reversedBefore: number;
}

@Injectable()
export class LoyaltyService {
  private readonly log = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly company: CompanyService,
  ) {}

  // ---- Settings and tiers ----

  /** The company's scheme; made with the starting values the first time (race-safe). */
  async settingsRow(db: Db, companyId: string): Promise<LoyaltySettings> {
    const found = await db.loyaltySettings.findUnique({ where: { companyId } });
    if (found) return found;
    await db.loyaltySettings.createMany({ data: [{ companyId, customerGroupIds: [] }], skipDuplicates: true });
    return db.loyaltySettings.findUniqueOrThrow({ where: { companyId } });
  }

  async tiers(db: Db, companyId: string): Promise<LoyaltyTier[]> {
    return db.loyaltyTier.findMany({ where: { companyId }, orderBy: [{ spendFrom: 'asc' }, { name: 'asc' }] });
  }

  async getSettings(): Promise<LoyaltySettingsDto> {
    const company = await this.company.current();
    return settingsDto(await this.settingsRow(this.prisma, company.id), await this.tiers(this.prisma, company.id));
  }

  /**
   * Changing the scheme. A new point value changes the worth of every unspent
   * point, so the liability is adjusted the same day (debit or credit loyalty
   * expense), keeping it equal to points × value.
   */
  async updateSettings(input: LoyaltySettingsInput, actor: Actor): Promise<LoyaltySettingsDto> {
    const company = await this.company.current();
    if (input.customerGroupIds?.length) {
      const found = await this.prisma.customerGroup.count({ where: { id: { in: input.customerGroupIds } } });
      if (found !== new Set(input.customerGroupIds).size) throw new BadRequestException('A customer group was not found');
    }
    await this.prisma.$transaction(async (tx) => {
      const before = await this.settingsRow(tx, company.id);
      const joinAll = input.joinAll ?? before.joinAll;
      const groups = input.customerGroupIds ?? before.customerGroupIds;
      if (!joinAll && groups.length === 0) throw new BadRequestException('Choose the customer groups that join, or let every named customer join');
      const after = await tx.loyaltySettings.update({ where: { companyId: company.id }, data: { ...input, updatedById: actor.userId } });
      if (!D(before.pointValue).eq(D(after.pointValue))) await this.revalue(tx, company.id, D(before.pointValue), D(after.pointValue), actor);
      await this.audit.recordUpdate(tx, actor, 'loyalty_settings', company.id, settingsAudit(before), settingsAudit(after));
    });
    return this.getSettings();
  }

  /** Unspent points × (new value − old value), posted at once so the liability equals points × value. */
  private async revalue(tx: Db, companyId: string, oldValue: Decimal, newValue: Decimal, actor: Actor) {
    const held = await tx.loyaltyEntry.groupBy({ by: ['storeId'], where: { companyId }, _sum: { points: true } });
    const lines: LedgerLineInput[] = [];
    const fallback = await this.ledger.firstStore(tx, companyId);
    for (const h of held) {
      const pts = h._sum.points ?? 0;
      if (pts === 0) continue;
      const diff = roundMoney(D(pts).mul(newValue.sub(oldValue)));
      const storeId = h.storeId ?? fallback;
      lines.push({ role: 'loyalty_expense', storeId, debit: diff, remark: 'Point value changed' }, { role: 'loyalty_liability', storeId, credit: diff, remark: 'Point value changed' });
    }
    if (!lines.length) return;
    await this.ledger.post(tx, {
      companyId,
      date: businessDate(),
      documentType: 'loyalty_revaluation',
      documentId: companyId,
      documentNumber: 'Point value',
      actorId: actor.userId,
      lines,
      remark: `Loyalty point value changed from ₹${oldValue.toString()} to ₹${newValue.toString()}`,
      whenLocked: 'next_open',
    });
  }

  async createTier(input: LoyaltyTierInput, actor: Actor): Promise<LoyaltySettingsDto> {
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      const tiers = await this.tiers(tx, company.id);
      const problem = tiersProblem([...tiers.map(tierRow), { ...input, spendFrom: input.spendFrom }]);
      if (problem) throw new BadRequestException(problem);
      const t = await tx.loyaltyTier.create({
        data: { companyId: company.id, name: input.name, spendFrom: D(input.spendFrom).toFixed(2), earnSpend: D(input.earnSpend).toFixed(2), earnPoints: input.earnPoints, sortOrder: input.sortOrder ?? 0, createdById: actor.userId, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'loyalty_tier', entityId: t.id, changes: tierDto(t) as unknown as Prisma.InputJsonValue });
    });
    return this.getSettings();
  }

  async updateTier(id: string, input: LoyaltyTierInput, actor: Actor): Promise<LoyaltySettingsDto> {
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.loyaltyTier.findUnique({ where: { id } });
      if (!before || before.companyId !== company.id) throw new NotFoundException('Tier not found');
      const tiers = await this.tiers(tx, company.id);
      const problem = tiersProblem(tiers.map((t) => (t.id === id ? { ...input } : tierRow(t))));
      if (problem) throw new BadRequestException(problem);
      const after = await tx.loyaltyTier.update({
        where: { id },
        data: { name: input.name, spendFrom: D(input.spendFrom).toFixed(2), earnSpend: D(input.earnSpend).toFixed(2), earnPoints: input.earnPoints, ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}), updatedById: actor.userId },
      });
      await this.audit.recordUpdate(tx, actor, 'loyalty_tier', id, tierDto(before) as unknown as Record<string, unknown>, tierDto(after) as unknown as Record<string, unknown>);
    });
    return this.getSettings();
  }

  /** Tiers hold no history (each earned entry keeps its own points), so a tier can go. */
  async deleteTier(id: string, actor: Actor): Promise<LoyaltySettingsDto> {
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.loyaltyTier.findUnique({ where: { id } });
      if (!before || before.companyId !== company.id) throw new NotFoundException('Tier not found');
      const rest = (await this.tiers(tx, company.id)).filter((t) => t.id !== id);
      const problem = tiersProblem(rest.map(tierRow));
      if (problem) throw new BadRequestException(`${problem}; change that tier first`);
      await tx.loyaltyTier.delete({ where: { id } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'loyalty_tier', entityId: id, changes: { removed: tierDto(before) } as unknown as Prisma.InputJsonValue });
    });
    return this.getSettings();
  }

  // ---- Members, balances and tiers ----

  /** Who earns: named customers (all, or those in the chosen groups); walk-in never. */
  async membership(db: Db, settings: LoyaltySettings, customer: Pick<Customer, 'id' | 'isWalkIn' | 'customerGroupId'>): Promise<{ member: boolean; reason: string | null }> {
    if (customer.isWalkIn) return { member: false, reason: 'Walk-in bills earn no points' };
    if (settings.joinAll) return { member: true, reason: null };
    const group = await db.customerGroup.findUnique({ where: { id: customer.customerGroupId }, select: { id: true, path: true } });
    const inGroup = !!group && settings.customerGroupIds.some((g) => g === group.id || group.path.includes(g));
    return inGroup ? { member: true, reason: null } : { member: false, reason: 'The customer’s group is not in the loyalty scheme' };
  }

  async balance(db: Db, customerId: string): Promise<number> {
    const s = await db.loyaltyEntry.aggregate({ where: { customerId }, _sum: { points: true } });
    return s._sum.points ?? 0;
  }

  /** Earned lots with points left, earliest-expiring first. */
  private async lots(db: Db, customerId: string) {
    return db.loyaltyEntry.findMany({ where: { customerId, kind: 'earn', remaining: { gt: 0 } }, orderBy: [{ expiresOn: 'asc' }, { entryDate: 'asc' }, { createdAt: 'asc' }] });
  }

  /** Points that can be spent on `date` (lots expiring that day or earlier are left out). */
  async available(db: Db, customerId: string, date: string): Promise<number> {
    const s = await db.loyaltyEntry.aggregate({ where: { customerId, kind: 'earn', remaining: { gt: 0 }, expiresOn: { gt: fromIso(date) } }, _sum: { remaining: true } });
    return s._sum.remaining ?? 0;
  }

  /**
   * Spend that counts for the tier: the last 12 months of till bills (returns
   * minus), less what was paid with points and gift cards, as for earning.
   */
  async yearSpend(db: Db, customerId: string, date: string): Promise<Decimal> {
    const window = { customerId, status: 'completed' as const, businessDate: { gte: fromIso(tierWindowStart(date)), lte: fromIso(date) } };
    const totals = await db.posBill.aggregate({ where: window, _sum: { total: true } });
    const special = await db.posPayment.aggregate({ where: { bill: window, paymentMethod: { accountRole: { in: [LOYALTY_PAYMENT_ROLE, GIFT_CARD_PAYMENT_ROLE] } } }, _sum: { amount: true } });
    return D(totals._sum.total ?? 0).sub(D(special._sum.amount ?? 0));
  }

  /** The earn rate for a yearly spend: its tier's, else the scheme's. */
  private rateFor(settings: LoyaltySettings, tiers: LoyaltyTier[], spend: Decimal) {
    const tier = tierFor(tiers.map((t) => ({ ...tierRow(t), id: t.id })), spend);
    return tier ? { name: tier.name, earnSpend: D(tier.earnSpend), earnPoints: tier.earnPoints } : { name: null, earnSpend: D(settings.earnSpend), earnPoints: settings.earnPoints };
  }

  /** The customer page and the till: balance, tier, what expires soon, and (on the page) the history. */
  async customerSummary(customerId: string, user: CurrentUser, withHistory: boolean): Promise<CustomerLoyaltyDto> {
    const company = await this.company.current();
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.companyId !== company.id) throw new NotFoundException('Customer not found');
    const settings = await this.settingsRow(this.prisma, company.id);
    const tiers = await this.tiers(this.prisma, company.id);
    const today = businessDate();
    const { member, reason } = await this.membership(this.prisma, settings, customer);
    const balance = await this.balance(this.prisma, customer.id);
    const spend = await this.yearSpend(this.prisma, customer.id, today);
    const rate = this.rateFor(settings, tiers, spend);
    const soon = await this.prisma.loyaltyEntry.findMany({
      where: { customerId, kind: 'earn', remaining: { gt: 0 }, expiresOn: { lte: fromIso(addDays(today, SOON_DAYS)) } },
      orderBy: { expiresOn: 'asc' },
      select: { expiresOn: true, remaining: true },
    });
    const byDay = new Map<string, number>();
    for (const s of soon) byDay.set(iso(s.expiresOn)!, (byDay.get(iso(s.expiresOn)!) ?? 0) + (s.remaining ?? 0));
    const out: CustomerLoyaltyDto = {
      customerId,
      member,
      reason,
      balance,
      balanceValue: pointsValue(balance, D(settings.pointValue)).toFixed(2),
      available: await this.available(this.prisma, customerId, today),
      tier: tiers.length && rate.name ? { name: rate.name, earnSpend: rate.earnSpend.toFixed(2), earnPoints: rate.earnPoints } : null,
      yearSpend: spend.toFixed(2),
      expiringSoon: [...byDay.entries()].map(([expiresOn, points]) => ({ expiresOn, points })),
      minRedeem: settings.minRedeem,
      maxSharePercent: D(settings.maxSharePercent).toString(),
      pointValue: D(settings.pointValue).toString(),
    };
    if (withHistory) {
      const rows = await this.prisma.loyaltyEntry.findMany({ where: { customerId }, orderBy: [{ createdAt: 'desc' }], take: 200 });
      const stores = allowedStoreIds(user);
      out.history = await this.entryDtos(rows.filter((r) => !stores || !r.storeId || stores.includes(r.storeId)));
    }
    return out;
  }

  private async entryDtos(rows: LoyaltyEntry[]): Promise<LoyaltyEntryDto[]> {
    const billIds = [...new Set(rows.map((r) => r.billId).filter((x): x is string => !!x))];
    const bills = new Map((billIds.length ? await this.prisma.posBill.findMany({ where: { id: { in: billIds } }, select: { id: true, number: true } }) : []).map((b) => [b.id, b.number]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as LoyaltyEntryDto['kind'],
      points: r.points,
      value: D(r.value).toFixed(2),
      billId: r.billId,
      billNumber: r.billId ? (bills.get(r.billId) ?? null) : null,
      entryDate: iso(r.entryDate)!,
      expiresOn: iso(r.expiresOn),
      remaining: r.remaining,
      storeId: r.storeId,
    }));
  }

  // ---- At the till: before the bill's transaction ----

  /**
   * Checks points the till wants to pay with (online only, blueprint 04
   * process 7): a member, the module on, the minimum, the maximum share of the
   * bill and the unexpired balance on the bill date. Checked again inside the
   * bill's transaction under the customer's lock.
   */
  async planRedeem(db: Db, s: { companyId: string; customer: Customer; points: number; billAmount: Decimal; date: string; offline: boolean }): Promise<RedeemPlan> {
    if (s.offline) throw new BadRequestException('Paying with points needs the connection: the balance is checked on the server');
    if (!(await moduleOn(db, 'loyalty'))) throw moduleOffError('loyalty');
    if (s.customer.isWalkIn) throw new BadRequestException('Choose the customer to pay with their points');
    if (s.billAmount.lte(0)) throw new BadRequestException('Points pay only for a sale');
    const settings = await this.settingsRow(db, s.companyId);
    const { member, reason } = await this.membership(db, settings, s.customer);
    if (!member) throw new BadRequestException(reason ?? 'The customer is not in the loyalty scheme');
    const available = await this.available(db, s.customer.id, s.date);
    const problem = redeemProblem(s.points, { available, minRedeem: settings.minRedeem, maxSharePercent: settings.maxSharePercent.toString(), pointValue: settings.pointValue.toString(), billAmount: s.billAmount });
    if (problem) throw new BadRequestException(problem);
    return { points: s.points, value: pointsValue(s.points, D(settings.pointValue)), pointValue: D(settings.pointValue) };
  }

  /** What a return can give back and take back of its original bill's points. */
  async returnPoints(db: Db, originalBillId: string): Promise<ReturnPoints> {
    const returns = (await db.posBill.findMany({ where: { returnOfId: originalBillId }, select: { id: true } })).map((r) => r.id);
    const own = await db.loyaltyEntry.findMany({ where: { billId: originalBillId } });
    const later = returns.length ? await db.loyaltyEntry.findMany({ where: { billId: { in: returns } } }) : [];
    const sum = (rows: LoyaltyEntry[], kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.points, 0);
    return {
      originalBillId,
      // Spend entries are minus; a cancelled bill's own entries cancel out.
      spent: -(sum(own, 'spend') + sum(own, 'restore_spend')),
      restoredBefore: sum(later, 'restore_spend'),
      earned: sum(own, 'earn') + sum(own, 'reverse_earn'),
      reversedBefore: -sum(later, 'reverse_earn'),
    };
  }

  async pointValue(db: Db, companyId: string): Promise<Decimal> {
    return D((await this.settingsRow(db, companyId)).pointValue);
  }

  // ---- In the bill's transaction ----

  /** Serialises everything that changes one customer's points. */
  async lock(tx: Db, customerId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty|customer|${customerId}`}))`;
  }

  /**
   * The points side of a saved till transaction, in its own transaction:
   * a return gives back spent points and takes back earned ones (decision 16),
   * points paid with are taken from the earliest-expiring lots, and the sale
   * earns on what was paid otherwise (plan 13 §1). Returns flags for the bill.
   */
  async recordTransaction(
    tx: Db,
    s: {
      companyId: string;
      storeId: string;
      date: string;
      customer: Customer;
      actorId: string | null;
      sale: LoyaltyBill | null;
      ret: LoyaltyBill | null;
      /** The bill the payments are on (points spent are recorded against it). */
      holderId: string;
      redeem: RedeemPlan | null;
      restore: RestorePlan | null;
      /** The return's share of the original bill (0 to 1), for taking back earned points. */
      returnRatio: Decimal | null;
      /** Paid with gift cards on this transaction (does not earn). */
      giftCardPaid: Decimal;
    },
  ): Promise<string[]> {
    const flags: string[] = [];
    // Walk-in bills earn nothing and cannot carry points (only a return of a bill paid with points would).
    if (s.customer.isWalkIn && !s.redeem && !s.restore) return flags;
    const settings = await this.settingsRow(tx, s.companyId);
    const value = D(settings.pointValue);
    const touchesLots = !!s.redeem || !!s.restore || !!(s.ret?.returnOfId && s.returnRatio);
    if (touchesLots) await this.lock(tx, s.customer.id);
    const base = { companyId: s.companyId, customerId: s.customer.id, entryDate: fromIso(s.date), storeId: s.storeId, createdById: s.actorId };

    // 1. A return: give back the points spent on the returned share, onto the lots they came from …
    if (s.ret && s.restore && s.restore.points > 0) await this.restoreSpent(tx, s.restore.originalBillId, s.ret.id, s.restore.points, value, base);
    // … and take back the points earned on it (decision 16).
    if (s.ret?.returnOfId && s.returnRatio) {
      const rp = await this.returnPoints(tx, s.ret.returnOfId);
      const back = pointsBack(rp.earned, s.returnRatio, rp.reversedBefore);
      if (back > 0) {
        const short = await this.takeBack(tx, s.ret.returnOfId, s.ret.id, back, value, base);
        if (short > 0) flags.push('points_short');
      }
    }

    // 2. Points paid with: from the earliest-expiring lots, checked again under the lock.
    if (s.redeem) {
      const available = await this.available(tx, s.customer.id, s.date);
      if (s.redeem.points > available) throw new BadRequestException(`Only ${available} points can be spent today; the points changed a moment ago`);
      const lots = await this.lots(tx, s.customer.id);
      const draw = drawFromLots(lots.map((l) => ({ id: l.id, remaining: l.remaining ?? 0, expiresOn: iso(l.expiresOn), entryDate: l.createdAt.toISOString() })), s.redeem.points, s.date);
      if (!draw) throw new BadRequestException(`Only ${available} points can be spent today`);
      for (const d of draw) {
        const done = await tx.loyaltyEntry.updateMany({ where: { id: d.id, remaining: { gte: d.take } }, data: { remaining: { decrement: d.take } } });
        if (done.count !== 1) throw new BadRequestException('The customer’s points changed a moment ago; try again');
        await tx.loyaltyEntry.create({ data: { ...base, kind: 'spend', points: -d.take, value: pointsValue(d.take, value).neg().toFixed(2), billId: s.holderId, sourceEntryId: d.id } });
      }
    }

    // 3. Earning on the sale: members only, while the module is on (plan 13 §1).
    if (s.sale && (await moduleOn(tx, 'loyalty'))) {
      const { member } = await this.membership(tx, settings, s.customer);
      if (member) {
        const paidWithPoints = s.redeem?.value ?? ZERO;
        const amount = Decimal.max(ZERO, s.sale.total.sub(paidWithPoints).sub(s.giftCardPaid));
        const tiers = await this.tiers(tx, s.companyId);
        // The tier counts the year's spend including this bill (blueprint 04 process 6.2).
        const rate = this.rateFor(settings, tiers, await this.yearSpend(tx, s.customer.id, s.date));
        const points = pointsFor(amount, { earnSpend: rate.earnSpend, earnPoints: rate.earnPoints });
        if (points > 0) {
          await tx.loyaltyEntry.create({
            data: { ...base, kind: 'earn', points, value: pointsValue(points, value).toFixed(2), billId: s.sale.id, expiresOn: fromIso(pointsExpireOn(s.date, settings.validityDays)), remaining: points },
          });
        }
      }
    }
    return flags;
  }

  /** Gives back points spent on the original bill: to the lots they were drawn from, latest-expiring first. */
  private async restoreSpent(tx: Db, originalBillId: string, returnBillId: string, points: number, value: Decimal, base: EntryBase) {
    const spends = await tx.loyaltyEntry.findMany({ where: { billId: originalBillId, kind: { in: ['spend', 'restore_spend'] } } });
    const returns = (await tx.posBill.findMany({ where: { returnOfId: originalBillId }, select: { id: true } })).map((r) => r.id);
    const restored = returns.length ? await tx.loyaltyEntry.findMany({ where: { billId: { in: returns }, kind: 'restore_spend' } }) : [];
    const perLot = new Map<string, number>();
    for (const e of spends) if (e.sourceEntryId) perLot.set(e.sourceEntryId, (perLot.get(e.sourceEntryId) ?? 0) - e.points);
    for (const e of restored) if (e.sourceEntryId) perLot.set(e.sourceEntryId, (perLot.get(e.sourceEntryId) ?? 0) - e.points);
    const lots = await tx.loyaltyEntry.findMany({ where: { id: { in: [...perLot.keys()] } }, orderBy: [{ expiresOn: 'desc' }, { createdAt: 'desc' }] });
    let left = points;
    for (const lot of lots) {
      if (left <= 0) break;
      const give = Math.min(left, perLot.get(lot.id) ?? 0);
      if (give <= 0) continue;
      await tx.loyaltyEntry.update({ where: { id: lot.id }, data: { remaining: { increment: give } } });
      await tx.loyaltyEntry.create({ data: { ...base, kind: 'restore_spend', points: give, value: pointsValue(give, value).toFixed(2), billId: returnBillId, sourceEntryId: lot.id } });
      left -= give;
    }
    if (left > 0) throw new BadRequestException('The points spent on the original bill could not be given back; check the bill');
  }

  /**
   * Takes back earned points: first from the original bill's own lot, then from
   * the customer's other lots, earliest-expiring first. If the customer has
   * spent them all, only what is there is taken (the shortfall is returned and
   * the bill flagged for the manager).
   */
  private async takeBack(tx: Db, originalBillId: string, billId: string, points: number, value: Decimal, base: EntryBase): Promise<number> {
    const own = await tx.loyaltyEntry.findFirst({ where: { billId: originalBillId, kind: 'earn' } });
    const others = (await this.lots(tx, base.customerId)).filter((l) => l.id !== own?.id);
    const order = [...(own && (own.remaining ?? 0) > 0 ? [own] : []), ...others];
    let left = points;
    for (const lot of order) {
      if (left <= 0) break;
      const take = Math.min(left, lot.remaining ?? 0);
      if (take <= 0) continue;
      const done = await tx.loyaltyEntry.updateMany({ where: { id: lot.id, remaining: { gte: take } }, data: { remaining: { decrement: take } } });
      if (done.count !== 1) throw new BadRequestException('The customer’s points changed a moment ago; try again');
      await tx.loyaltyEntry.create({ data: { ...base, kind: 'reverse_earn', points: -take, value: pointsValue(take, value).neg().toFixed(2), billId, sourceEntryId: lot.id } });
      left -= take;
    }
    return left;
  }

  /** Why these bills cannot be cancelled because of their points, or null (blueprint 04 process 6.5). */
  async cancelProblem(db: Db, billIds: string[]): Promise<string | null> {
    const entries = await db.loyaltyEntry.findMany({ where: { billId: { in: billIds } } });
    for (const e of entries.filter((x) => x.kind === 'earn')) {
      if ((e.remaining ?? 0) < e.points) return `${e.points - (e.remaining ?? 0)} of the points earned on this bill were already spent; cancel the bill that spent them first`;
    }
    // A return's points given back must still be there to take back.
    const given = new Map<string, number>();
    for (const e of entries.filter((x) => x.kind === 'restore_spend' && x.points > 0 && x.sourceEntryId)) given.set(e.sourceEntryId!, (given.get(e.sourceEntryId!) ?? 0) + e.points);
    if (given.size) {
      const lots = await db.loyaltyEntry.findMany({ where: { id: { in: [...given.keys()] } } });
      for (const l of lots) if ((l.remaining ?? 0) < (given.get(l.id) ?? 0)) return 'Points given back by this return were already spent again; it cannot be cancelled';
    }
    return null;
  }

  /**
   * Cancelling bills (before their shift closes): every points entry of the
   * bills is undone with an opposite entry on the same lot, so the bills'
   * points net to zero and nothing reaches the ledger.
   */
  async cancelBills(tx: Db, bills: { id: string; customerId: string }[], actorId: string | null, date: string): Promise<void> {
    const entries = await tx.loyaltyEntry.findMany({ where: { billId: { in: bills.map((b) => b.id) } }, orderBy: { createdAt: 'asc' } });
    if (!entries.length) return;
    const problem = await this.cancelProblem(tx, bills.map((b) => b.id));
    if (problem) throw new BadRequestException(problem);
    for (const customerId of new Set(entries.map((e) => e.customerId))) await this.lock(tx, customerId);
    const live = new Map<string, number>();
    for (const e of entries) {
      const k = `${e.billId}|${e.kind}|${e.sourceEntryId ?? e.id}`;
      live.set(k, (live.get(k) ?? 0) + e.points);
    }
    for (const e of entries) {
      const k = `${e.billId}|${e.kind}|${e.sourceEntryId ?? e.id}`;
      const pts = live.get(k) ?? 0;
      if (pts === 0) continue;
      live.set(k, 0);
      const base = { companyId: e.companyId, customerId: e.customerId, entryDate: fromIso(date), storeId: e.storeId, createdById: actorId, billId: e.billId };
      const unit = D(e.value).div(e.points).abs();
      if (e.kind === 'earn') {
        // The lot's points (checked above as unspent) are taken off it again.
        await tx.loyaltyEntry.update({ where: { id: e.id }, data: { remaining: { decrement: pts } } });
        await tx.loyaltyEntry.create({ data: { ...base, kind: 'reverse_earn', points: -pts, value: roundMoney(unit.mul(pts)).neg().toFixed(2), sourceEntryId: e.id } });
      } else if (e.sourceEntryId) {
        // spend / reverse_earn (minus) go back onto their lot; restore_spend (plus) comes off it again.
        await tx.loyaltyEntry.update({ where: { id: e.sourceEntryId }, data: { remaining: { increment: -pts } } });
        await tx.loyaltyEntry.create({ data: { ...base, kind: e.kind === 'spend' ? 'restore_spend' : e.kind, points: -pts, value: roundMoney(unit.mul(-pts)).toFixed(2), sourceEntryId: e.sourceEntryId } });
      }
    }
  }

  // ---- Receipts ----

  /** The points block of each bill's receipt: earned, spent, given back and the balance now. */
  async receiptInfo(db: Db, bills: { id: string; customerId: string }[]): Promise<Map<string, ReceiptLoyalty>> {
    const out = new Map<string, ReceiptLoyalty>();
    if (!bills.length) return out;
    const entries = await db.loyaltyEntry.findMany({ where: { billId: { in: bills.map((b) => b.id) } } });
    if (!entries.length) return out;
    const company = await this.company.current(db);
    const settings = await this.settingsRow(db, company.id);
    const balances = new Map<string, number>();
    for (const b of bills) {
      const own = entries.filter((e) => e.billId === b.id);
      if (!own.length) continue;
      if (!balances.has(b.customerId)) balances.set(b.customerId, await this.balance(db, b.customerId));
      const sum = (kind: string) => own.filter((e) => e.kind === kind).reduce((s, e) => s + e.points, 0);
      out.set(b.id, { scheme: settings.schemeName, earned: sum('earn'), spent: -sum('spend'), restored: sum('restore_spend'), reversed: -sum('reverse_earn'), balance: balances.get(b.customerId) ?? null, note: null });
    }
    return out;
  }

  // ---- The shift's ledger entry ----

  /** Value of points earned (and taken back) per bill, posted with the shift: Dr loyalty expense, Cr liability. */
  async earnedValues(db: Db, billIds: string[]): Promise<Map<string, Decimal>> {
    const out = new Map<string, Decimal>();
    if (!billIds.length) return out;
    const rows = await db.loyaltyEntry.groupBy({ by: ['billId'], where: { billId: { in: billIds }, kind: { in: ['earn', 'reverse_earn'] } }, _sum: { value: true } });
    for (const r of rows) if (r.billId) out.set(r.billId, D(r._sum.value ?? 0));
    return out;
  }

  // ---- Nightly expiry (plan 13 §1) ----

  @Cron('20 2 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    if (process.env.EXPIRY_SCHEDULE === 'off') return;
    // Plan 14: shop by shop.
    await forEachShop(this.system, this.log, 'Nightly points expiry', async () => {
      try {
        for (const c of await this.prisma.company.findMany({ where: { active: true }, select: { id: true } })) {
          const r = await this.expire(c.id, businessDate(), { userId: null, ipAddress: null });
          if (r.points) this.log.log(`${r.points} loyalty point(s) expired for ${r.customers} customer(s)`);
        }
      } catch (err) {
        this.log.error('Nightly points expiry failed', err instanceof Error ? err.stack : String(err));
      }
    });
  }

  /**
   * Expires what is left on lots whose expiry day has come, and writes their
   * value back: debit the liability, credit loyalty expense or other income
   * (the setting). One ledger entry per store; safe to run twice the same day.
   */
  async expire(companyId: string, today: string, actor: Actor): Promise<{ points: number; value: string; customers: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty|expiry|${companyId}`}))`;
        const lots = await tx.loyaltyEntry.findMany({ where: { companyId, kind: 'earn', remaining: { gt: 0 }, expiresOn: { lte: fromIso(today) } } });
        if (!lots.length) return { points: 0, value: '0.00', customers: 0 };
        const settings = await this.settingsRow(tx, companyId);
        const value = D(settings.pointValue);
        const fallback = await this.ledger.firstStore(tx, companyId);
        const byStore = new Map<string, Decimal>();
        let total = 0;
        for (const lot of lots) {
          const pts = lot.remaining ?? 0;
          const done = await tx.loyaltyEntry.updateMany({ where: { id: lot.id, remaining: pts }, data: { remaining: 0 } });
          if (done.count !== 1) continue;
          const v = pointsValue(pts, value);
          await tx.loyaltyEntry.create({ data: { companyId, customerId: lot.customerId, kind: 'expire', points: -pts, value: v.neg().toFixed(2), sourceEntryId: lot.id, entryDate: fromIso(today), storeId: lot.storeId, createdById: actor.userId } });
          const store = lot.storeId ?? fallback ?? '';
          byStore.set(store, (byStore.get(store) ?? ZERO).add(v));
          total += pts;
        }
        const to: LoyaltyExpiryTo = settings.expiryTo === 'other_income' ? 'other_income' : 'loyalty_expense';
        const lines: LedgerLineInput[] = [];
        for (const [storeId, v] of byStore) lines.push({ role: 'loyalty_liability', storeId: storeId || null, debit: v, remark: 'Points expired' }, { role: to, storeId: storeId || null, credit: v, remark: 'Points expired' });
        await this.ledger.post(tx, { companyId, date: today, documentType: 'loyalty_expiry', documentId: companyId, documentNumber: `Points expired ${today}`, actorId: actor.userId, lines, remark: `${total} loyalty points expired`, whenLocked: 'next_open' });
        const sum = [...byStore.values()].reduce((s, v) => s.add(v), ZERO);
        await this.audit.record(tx, actor, { action: 'update', entityType: 'loyalty_expiry', entityId: companyId, changes: { date: today, points: total, value: sum.toFixed(2), to } });
        return { points: total, value: sum.toFixed(2), customers: new Set(lots.map((l) => l.customerId)).size };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  /** The Owner runs today's expiry by hand (the night run does the same). */
  async runExpiry(actor: Actor) {
    const company = await this.company.current();
    return this.expire(company.id, businessDate(), actor);
  }

  // ---- Reports (plan 13 §1 "Screens") ----

  /**
   * Points liability: points held × point value must equal the ledger's
   * liability plus what the open shifts will post at closing.
   */
  async liability(db: Db = this.prisma) {
    const company = await this.company.current(db);
    const settings = await this.settingsRow(db, company.id);
    const value = D(settings.pointValue);
    const held = (await db.loyaltyEntry.aggregate({ where: { companyId: company.id }, _sum: { points: true } }))._sum.points ?? 0;
    const lots = (await db.loyaltyEntry.aggregate({ where: { companyId: company.id, kind: 'earn' }, _sum: { remaining: true } }))._sum.remaining ?? 0;
    const today = businessDate();
    const pastExpiry = (await db.loyaltyEntry.aggregate({ where: { companyId: company.id, kind: 'earn', remaining: { gt: 0 }, expiresOn: { lte: fromIso(today) } }, _sum: { remaining: true } }))._sum.remaining ?? 0;
    const ledger = await this.roleBalance(db, company.id, 'loyalty_liability');
    // Bills of shifts still open: their points are kept but reach the ledger when the shift closes.
    const pending = await db.loyaltyEntry.aggregate({ where: { companyId: company.id, kind: { not: 'expire' }, billId: { in: await this.openShiftBillIds(db, company.id) } }, _sum: { value: true } });
    const pendingValue = D(pending._sum.value ?? 0);
    const expected = pointsValue(held, value);
    const difference = ledger.add(pendingValue).sub(expected);
    const customers = await db.loyaltyEntry.groupBy({ by: ['customerId'], where: { companyId: company.id }, _sum: { points: true }, orderBy: { _sum: { points: 'desc' } }, take: 20 });
    const names = new Map((await db.customer.findMany({ where: { id: { in: customers.map((c) => c.customerId) } }, select: { id: true, code: true, name: true } })).map((c) => [c.id, c]));
    return {
      points: held,
      pointValue: value.toString(),
      value: expected.toFixed(2),
      pastExpiry,
      ledger: ledger.toFixed(2),
      pending: pendingValue.toFixed(2),
      difference: difference.toFixed(2),
      ok: difference.isZero() && held === lots,
      topMembers: customers
        .filter((c) => (c._sum.points ?? 0) > 0)
        .map((c) => ({ customerId: c.customerId, code: names.get(c.customerId)?.code ?? '', name: names.get(c.customerId)?.name ?? '', points: c._sum.points ?? 0, value: pointsValue(c._sum.points ?? 0, value).toFixed(2) })),
    };
  }

  /** For the book health check: a problem line when the liability is off. */
  async liabilityProblems(db: Db = this.prisma): Promise<string[]> {
    const l = await this.liability(db);
    if (l.ok) return [];
    return [`Loyalty points liability is ₹${l.ledger} (₹${l.pending} still to post from open shifts) but ${l.points} points × ₹${l.pointValue} = ₹${l.value}`];
  }

  /** Points earned, spent, expired and moved by returns, by month. */
  async byMonth(q: LoyaltyReportQuery, user: CurrentUser) {
    const company = await this.company.current();
    const stores = allowedStoreIds(user);
    const where: Prisma.LoyaltyEntryWhereInput = {
      companyId: company.id,
      ...(q.storeId ? { storeId: q.storeId } : stores ? { storeId: { in: stores } } : {}),
      ...(q.from || q.to ? { entryDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
    };
    const rows = await this.prisma.loyaltyEntry.findMany({ where, select: { kind: true, points: true, value: true, entryDate: true } });
    const months = new Map<string, Record<string, { points: number; value: Decimal }>>();
    for (const r of rows) {
      const m = iso(r.entryDate)!.slice(0, 7);
      const row = months.get(m) ?? {};
      const k = row[r.kind] ?? { points: 0, value: ZERO };
      row[r.kind] = { points: k.points + r.points, value: k.value.add(D(r.value)) };
      months.set(m, row);
    }
    const pick = (row: Record<string, { points: number; value: Decimal }>, kind: string, sign = 1) => ({ points: (row[kind]?.points ?? 0) * sign, value: (row[kind]?.value ?? ZERO).mul(sign).toFixed(2) });
    return [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, row]) => ({
        month,
        earned: pick(row, 'earn'),
        spent: pick(row, 'spend', -1),
        expired: pick(row, 'expire', -1),
        takenBack: pick(row, 'reverse_earn', -1),
        givenBack: pick(row, 'restore_spend'),
      }));
  }

  /** Points that will expire next calendar month (or in a chosen period), per customer. */
  async expiring(q: LoyaltyReportQuery) {
    const company = await this.company.current();
    const today = businessDate();
    const from = q.from ?? `${addMonthStart(today, 1)}`;
    const to = q.to ?? addDays(addMonthStart(today, 2), -1);
    const lots = await this.prisma.loyaltyEntry.findMany({
      where: { companyId: company.id, kind: 'earn', remaining: { gt: 0 }, expiresOn: { gte: fromIso(from), lte: fromIso(to) } },
      orderBy: { expiresOn: 'asc' },
      select: { customerId: true, remaining: true, expiresOn: true },
    });
    const value = await this.pointValue(this.prisma, company.id);
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.customerId))] } }, select: { id: true, code: true, name: true, mobile: true } })).map((c) => [c.id, c]));
    const rows = new Map<string, { customerId: string; code: string; name: string; mobile: string | null; points: number; firstExpiry: string }>();
    for (const l of lots) {
      const c = customers.get(l.customerId);
      const r = rows.get(l.customerId) ?? { customerId: l.customerId, code: c?.code ?? '', name: c?.name ?? '', mobile: c?.mobile ?? null, points: 0, firstExpiry: iso(l.expiresOn)! };
      r.points += l.remaining ?? 0;
      rows.set(l.customerId, r);
    }
    const list = [...rows.values()].map((r) => ({ ...r, value: pointsValue(r.points, value).toFixed(2) }));
    return { from, to, points: list.reduce((s, r) => s + r.points, 0), value: pointsValue(list.reduce((s, r) => s + r.points, 0), value).toFixed(2), rows: list };
  }

  // ---- Helpers ----

  async roleBalance(db: Db, companyId: string, role: string): Promise<Decimal> {
    const d = await db.accountDefault.findUnique({ where: { companyId_role: { companyId, role } } });
    if (!d) return ZERO;
    const s = await db.ledgerLine.aggregate({ where: { accountId: d.accountId }, _sum: { debit: true, credit: true } });
    return D(s._sum.credit ?? 0).sub(D(s._sum.debit ?? 0));
  }

  async openShiftBillIds(db: Db, companyId: string): Promise<string[]> {
    return (await db.posBill.findMany({ where: { companyId, status: 'completed', shift: { status: 'open' } }, select: { id: true } })).map((b) => b.id);
  }

  assertView(user: CurrentUser) {
    if (!hasPermission(user, 'loyalty.view') && !hasPermission(user, 'loyalty.manage')) throw new ForbiddenException('You do not have the right "loyalty.view"');
  }
}

type EntryBase = { companyId: string; customerId: string; entryDate: Date; storeId: string | null; createdById: string | null };

/** The first day of the month `n` months after `date`'s month. */
function addMonthStart(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`;
}

function tierRow(t: LoyaltyTier) {
  return { name: t.name, spendFrom: t.spendFrom.toString(), earnSpend: t.earnSpend.toString(), earnPoints: t.earnPoints };
}

function tierDto(t: LoyaltyTier): LoyaltyTierDto {
  return { id: t.id, name: t.name, spendFrom: D(t.spendFrom).toFixed(2), earnSpend: D(t.earnSpend).toFixed(2), earnPoints: t.earnPoints, sortOrder: t.sortOrder };
}

function settingsDto(s: LoyaltySettings, tiers: LoyaltyTier[]): LoyaltySettingsDto {
  return {
    schemeName: s.schemeName,
    earnSpend: D(s.earnSpend).toFixed(2),
    earnPoints: s.earnPoints,
    pointValue: D(s.pointValue).toString(),
    validityDays: s.validityDays,
    minRedeem: s.minRedeem,
    maxSharePercent: D(s.maxSharePercent).toString(),
    joinAll: s.joinAll,
    customerGroupIds: s.customerGroupIds,
    expiryTo: (s.expiryTo === 'other_income' ? 'other_income' : 'loyalty_expense') as LoyaltyExpiryTo,
    tiers: tiers.map(tierDto),
  };
}

function settingsAudit(s: LoyaltySettings) {
  const d = settingsDto(s, []);
  const { tiers: _t, ...rest } = d;
  void _t;
  return rest as unknown as Record<string, unknown>;
}

export { isUsableOn };
