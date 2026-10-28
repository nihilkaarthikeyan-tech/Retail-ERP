// Copyright (c) 2026, Rademics. All rights reserved.
// Reloadable gift cards (plan 13 §2; decision 14). A card is prepaid money the
// shop owes its holder, not a coupon: selling or reloading it debits the money
// received and credits "Gift card balances owed"; spending it is a payment
// method whose account is that liability, so the till shift's entry debits it
// (decision 39), and the goods on the bill carry GST as usual.
//
// GST: no GST is charged when a card is sold or loaded, because a voucher is
// not itself a supply of goods; tax is charged on the goods when the card is
// spent. Source: the 55th GST Council meeting press release, 21 December 2024
// (cbic-gst.gov.in/pdf/Press-Release%20-55-GST-Council.pdf): transactions in
// vouchers are neither a supply of goods nor of services, and unredeemed
// vouchers (expired balances) are not a supply. That is a recommendation; the
// notified circular could not be confirmed on cbic-gst.gov.in, so the CA must
// confirm before go-live (plan 13 §2).
//
// Every load, spend, refund and expiry is a card entry with the balance after
// it; the card's balance always equals the sum of its entries.
import { randomInt } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  addDays,
  businessDate,
  type CurrentUser,
  Decimal,
  GIFT_CARD_PAYMENT_ROLE,
  GIFT_CARD_VALIDITY_MONTHS,
  type GiftCardDto,
  type GiftCardEntryDto,
  giftCardExpiresOn,
  giftCardNumberFrom,
  giftCardProblem,
  type GiftCardQuery,
  hasPermission,
  INDIA_TIME_ZONE,
  type LoyaltyReportQuery,
  maskGiftCardNumber,
  normaliseGiftCardNumber,
  type ReceiptGiftCard,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { GiftCard, GiftCardEntry, Prisma } from '../generated/prisma/client.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';
import { moduleOffError, moduleOn } from '../modules/module-map.js';
import { forEachShop } from '../prisma/each-shop.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { D, fromIso, iso } from './loyalty.service.js';

const ZERO = new Decimal(0);
/** How far ahead the expiring-cards report looks by default. */
const EXPIRING_DAYS = 30;

/** A card checked for paying part of a bill. */
export interface CardSpend {
  card: GiftCard;
  amount: Decimal;
}

/** A card that paid an original bill, with what has gone back to it already (for returns). */
export interface ReturnCard {
  cardId: string;
  number: string;
  status: string;
  expiresOn: string;
  paid: Decimal;
  refundedBefore: Decimal;
  usable: boolean;
}

@Injectable()
export class GiftCardsService {
  private readonly log = new Logger(GiftCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly company: CompanyService,
  ) {}

  /** The gift card rules (fixed for now, plan 13 §2) and the account expired balances go to. */
  async settings() {
    const company = await this.company.current();
    const d = await this.prisma.accountDefault.findUnique({ where: { companyId_role: { companyId: company.id, role: 'gift_card_expiry' } }, include: { account: true } });
    return {
      validityMonths: GIFT_CARD_VALIDITY_MONTHS,
      refundToCard: true,
      expiryAccountSet: !!d,
      expiryAccount: d ? { id: d.account.id, number: d.account.number, name: d.account.name } : null,
    };
  }

  // ---- Reading ----

  async byNumber(db: Db, companyId: string, number: string): Promise<GiftCard> {
    const card = await db.giftCard.findFirst({ where: { number: normaliseGiftCardNumber(number) } });
    if (!card || card.companyId !== companyId) throw new NotFoundException('No gift card has that number');
    return card;
  }

  /** Checking a card's balance at the till (the number was typed or scanned, so it is shown in full). */
  async lookup(number: string): Promise<GiftCardDto & { problem: string | null }> {
    const company = await this.company.current();
    const card = await this.byNumber(this.prisma, company.id, number);
    return { ...cardDto(card, true), problem: giftCardProblem({ status: card.status, expiresOn: iso(card.expiresOn)! }, businessDate()) };
  }

  async list(q: GiftCardQuery, user: CurrentUser) {
    const company = await this.company.current();
    const stores = allowedStoreIds(user);
    const full = hasPermission(user, 'giftcards.manage');
    const search = q.search ? normaliseGiftCardNumber(q.search) : '';
    const where: Prisma.GiftCardWhereInput = {
      companyId: company.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.storeId ? { issuedStoreId: q.storeId } : stores ? { issuedStoreId: { in: stores } } : {}),
      ...(search
        ? { OR: [{ number: { endsWith: search } }, { holderName: { contains: q.search, mode: 'insensitive' } }, { holderPhone: { contains: search } }] }
        : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const [rows, total, sums] = await Promise.all([
      this.prisma.giftCard.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.giftCard.count({ where }),
      this.prisma.giftCard.aggregate({ where, _sum: { balance: true } }),
    ]);
    return { rows: rows.map((c) => cardDto(c, full)), total, page, pageSize, balanceTotal: D(sums._sum.balance ?? 0).toFixed(2) };
  }

  async get(id: string, user: CurrentUser): Promise<GiftCardDto> {
    const company = await this.company.current();
    const card = await this.prisma.giftCard.findUnique({ where: { id }, include: { entries: { orderBy: { createdAt: 'asc' } } } });
    if (!card || card.companyId !== company.id) throw new NotFoundException('Gift card not found');
    assertStoreAccess(user, card.issuedStoreId);
    const billIds = [...new Set(card.entries.map((e) => e.billId).filter((x): x is string => !!x))];
    const bills = new Map((billIds.length ? await this.prisma.posBill.findMany({ where: { id: { in: billIds } }, select: { id: true, number: true } }) : []).map((b) => [b.id, b.number]));
    return { ...cardDto(card, hasPermission(user, 'giftcards.manage')), entries: card.entries.map((e) => entryDto(e, bills)) };
  }

  // ---- Blocking (a lost or stolen card) ----

  async block(id: string, reason: string, actor: Actor, user: CurrentUser): Promise<GiftCardDto> {
    return this.setBlocked(id, true, reason, actor, user);
  }

  async unblock(id: string, actor: Actor, user: CurrentUser): Promise<GiftCardDto> {
    return this.setBlocked(id, false, null, actor, user);
  }

  private async setBlocked(id: string, blocked: boolean, reason: string | null, actor: Actor, user: CurrentUser): Promise<GiftCardDto> {
    const company = await this.company.current();
    await this.prisma.$transaction(async (tx) => {
      const card = await tx.giftCard.findUnique({ where: { id } });
      if (!card || card.companyId !== company.id) throw new NotFoundException('Gift card not found');
      assertStoreAccess(user, card.issuedStoreId);
      if (card.status === 'expired') throw new BadRequestException('This gift card has expired');
      if (blocked && card.status === 'blocked') throw new BadRequestException('This gift card is already blocked');
      if (!blocked && card.status !== 'blocked') throw new BadRequestException('This gift card is not blocked');
      const done = await tx.giftCard.updateMany({ where: { id, status: card.status }, data: { status: blocked ? 'blocked' : 'active', blockedReason: reason, updatedById: actor.userId } });
      if (done.count !== 1) throw new BadRequestException('The card changed a moment ago; open it again');
      await this.audit.record(tx, actor, { action: 'update', entityType: 'gift_card', entityId: id, changes: { number: maskGiftCardNumber(card.number), status: { old: card.status, new: blocked ? 'blocked' : 'active' } }, reason });
    });
    return this.get(id, user);
  }

  // ---- Selling and reloading (the till's transaction) ----

  /** 15 random digits (the first not 0) and a check digit; not derived from anything, so not guessable. */
  private newNumber(): string {
    let body = String(randomInt(1, 10));
    for (let i = 0; i < 14; i++) body += String(randomInt(0, 10));
    return giftCardNumberFrom(body);
  }

  /**
   * A new card (no number) or a reload of an active one, in the caller's
   * transaction: the card entry, and the ledger entry crediting the liability
   * against `debit` (the money received). No GST and no stock (plan 13 §2).
   */
  async load(
    tx: Db,
    s: {
      companyId: string;
      storeId: string;
      number: string | null;
      amount: Decimal;
      date: string;
      holderName: string | null;
      holderPhone: string | null;
      customerId: string | null;
      actorId: string | null;
      debit: Pick<LedgerLineInput, 'accountId' | 'role'>;
      receiptNumber: string;
      methodName: string;
      paymentMethodId?: string | null;
      tillId?: string | null;
    },
  ): Promise<{ card: GiftCard; entry: GiftCardEntry; isNew: boolean }> {
    let card: GiftCard;
    let isNew = false;
    if (s.number) {
      const found = await this.byNumber(tx, s.companyId, s.number);
      const problem = giftCardProblem({ status: found.status, expiresOn: iso(found.expiresOn)! }, s.date);
      if (problem) throw new BadRequestException(`${problem}; it cannot be reloaded`);
      const done = await tx.giftCard.updateMany({
        where: { id: found.id, status: 'active' },
        data: { balance: { increment: s.amount.toFixed(2) }, loadedTotal: { increment: s.amount.toFixed(2) }, updatedById: s.actorId, ...(s.holderName ? { holderName: s.holderName } : {}), ...(s.holderPhone ? { holderPhone: s.holderPhone } : {}) },
      });
      if (done.count !== 1) throw new BadRequestException('The card changed a moment ago; check it again');
      card = await tx.giftCard.findUniqueOrThrow({ where: { id: found.id } });
    } else {
      isNew = true;
      let made: GiftCard | null = null;
      for (let i = 0; i < 5 && !made; i++) {
        const number = this.newNumber();
        if (await tx.giftCard.findFirst({ where: { number }, select: { id: true } })) continue;
        made = await tx.giftCard.create({
          data: {
            companyId: s.companyId,
            number,
            holderName: s.holderName,
            holderPhone: s.holderPhone,
            customerId: s.customerId,
            issuedStoreId: s.storeId,
            issuedOn: fromIso(s.date),
            loadedTotal: s.amount.toFixed(2),
            balance: s.amount.toFixed(2),
            expiresOn: fromIso(giftCardExpiresOn(s.date)),
            status: 'active',
            createdById: s.actorId,
            updatedById: s.actorId,
          },
        });
      }
      if (!made) throw new BadRequestException('A card number could not be made; try again');
      card = made;
    }
    const entry = await tx.giftCardEntry.create({
      data: { cardId: card.id, kind: 'load', amount: s.amount.toFixed(2), balanceAfter: D(card.balance).toFixed(2), storeId: s.storeId, entryDate: fromIso(s.date), remark: `Receipt ${s.receiptNumber} (${s.methodName})`, paymentMethodId: s.paymentMethodId ?? null, tillId: s.tillId ?? null, createdById: s.actorId },
    });
    await this.ledger.post(tx, {
      companyId: s.companyId,
      date: s.date,
      documentType: 'gift_card_load',
      documentId: entry.id,
      documentNumber: s.receiptNumber,
      storeId: s.storeId,
      actorId: s.actorId,
      lines: [
        { ...s.debit, storeId: s.storeId, debit: s.amount },
        { role: 'gift_card_liability', storeId: s.storeId, credit: s.amount, remark: `Gift card ${maskGiftCardNumber(card.number)}` },
      ],
      remark: `Gift card ${maskGiftCardNumber(card.number)} ${isNew ? 'sold' : 'reloaded'} (${s.methodName})`,
    });
    return { card, entry, isNew };
  }

  // ---- Paying with cards on a till bill ----

  /**
   * Checks the cards the till wants to pay with (online only): known, this
   * company's, active and not expired, with enough balance. Checked again,
   * race-safely, when the bill is saved.
   */
  async planSpends(db: Db, s: { companyId: string; cards: { number: string; amount: string }[]; date: string; offline: boolean; billAmount: Decimal }): Promise<CardSpend[]> {
    if (!s.cards.length) return [];
    if (s.offline) throw new BadRequestException('Paying with a gift card needs the connection: the balance is checked on the server');
    if (!(await moduleOn(db, 'gift_cards'))) throw moduleOffError('gift_cards');
    if (s.billAmount.lte(0)) throw new BadRequestException('A gift card pays only for a sale');
    const out: CardSpend[] = [];
    for (const c of s.cards) {
      const card = await this.byNumber(db, s.companyId, c.number);
      const problem = giftCardProblem({ status: card.status, expiresOn: iso(card.expiresOn)! }, s.date);
      if (problem) throw new BadRequestException(`Gift card ${maskGiftCardNumber(card.number)}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
      const amount = D(c.amount);
      if (amount.gt(D(card.balance))) throw new BadRequestException(`Gift card ${maskGiftCardNumber(card.number)} has only ₹${D(card.balance).toFixed(2)}`);
      out.push({ card, amount });
    }
    const total = out.reduce((sum, c) => sum.add(c.amount), ZERO);
    if (total.gt(s.billAmount)) throw new BadRequestException('Gift cards cannot pay more than the bill');
    return out;
  }

  /** Takes the amounts off the cards (only if each still has them) and records the spends against the bill. */
  async recordSpends(tx: Db, s: { spends: CardSpend[]; billId: string; storeId: string; date: string; actorId: string | null; billNumber: string }): Promise<void> {
    for (const sp of s.spends) {
      const done = await tx.giftCard.updateMany({
        where: { id: sp.card.id, status: 'active', expiresOn: { gt: fromIso(s.date) }, balance: { gte: sp.amount.toFixed(2) } },
        data: { balance: { decrement: sp.amount.toFixed(2) }, updatedById: s.actorId },
      });
      if (done.count !== 1) throw new BadRequestException(`Gift card ${maskGiftCardNumber(sp.card.number)} changed a moment ago (spent, blocked or expired); check it again`);
      const after = await tx.giftCard.findUniqueOrThrow({ where: { id: sp.card.id } });
      await tx.giftCardEntry.create({
        data: { cardId: sp.card.id, kind: 'spend', amount: sp.amount.neg().toFixed(2), balanceAfter: D(after.balance).toFixed(2), billId: s.billId, storeId: s.storeId, entryDate: fromIso(s.date), remark: `Bill ${s.billNumber}`, createdById: s.actorId },
      });
    }
  }

  /** The cards that paid an original bill, with what went back to them already (plan 13 §2 "refunds"). */
  async returnCards(db: Db, originalBillId: string, date: string): Promise<ReturnCard[]> {
    const spends = await db.giftCardEntry.findMany({ where: { billId: originalBillId }, include: { card: true } });
    if (!spends.length) return [];
    const returns = (await db.posBill.findMany({ where: { returnOfId: originalBillId }, select: { id: true } })).map((r) => r.id);
    const later = returns.length ? await db.giftCardEntry.findMany({ where: { billId: { in: returns } } }) : [];
    const cards = new Map<string, ReturnCard>();
    for (const e of spends) {
      const c = cards.get(e.cardId) ?? { cardId: e.cardId, number: e.card.number, status: e.card.status, expiresOn: iso(e.card.expiresOn)!, paid: ZERO, refundedBefore: ZERO, usable: e.card.status !== 'expired' && iso(e.card.expiresOn)! > date };
      // Spends are minus; a cancelled bill's refund entries cancel them out.
      c.paid = c.paid.sub(D(e.amount));
      cards.set(e.cardId, c);
    }
    for (const e of later) {
      const c = cards.get(e.cardId);
      if (c) c.refundedBefore = c.refundedBefore.add(D(e.amount));
    }
    return [...cards.values()].filter((c) => c.paid.gt(0));
  }

  /** Puts the money for returned goods back on the cards (even a blocked one: the money is still the holder's). */
  async recordRefunds(tx: Db, s: { refunds: { cardId: string; amount: Decimal }[]; billId: string; storeId: string; date: string; actorId: string | null; billNumber: string }): Promise<void> {
    for (const r of s.refunds) {
      if (r.amount.lte(0)) continue;
      const done = await tx.giftCard.updateMany({ where: { id: r.cardId, status: { not: 'expired' } }, data: { balance: { increment: r.amount.toFixed(2) }, updatedById: s.actorId } });
      if (done.count !== 1) throw new BadRequestException('The gift card of this bill expired a moment ago; refund by the till instead');
      const after = await tx.giftCard.findUniqueOrThrow({ where: { id: r.cardId } });
      await tx.giftCardEntry.create({ data: { cardId: r.cardId, kind: 'refund', amount: r.amount.toFixed(2), balanceAfter: D(after.balance).toFixed(2), billId: s.billId, storeId: s.storeId, entryDate: fromIso(s.date), remark: `Return ${s.billNumber}`, createdById: s.actorId } });
    }
  }

  /** Why these bills cannot be cancelled because of gift card money, or null. */
  async cancelProblem(db: Db, billIds: string[]): Promise<string | null> {
    const entries = await db.giftCardEntry.findMany({ where: { billId: { in: billIds } }, include: { card: true } });
    const net = new Map<string, { card: GiftCard; amount: Decimal }>();
    for (const e of entries) net.set(e.cardId, { card: e.card, amount: (net.get(e.cardId)?.amount ?? ZERO).add(D(e.amount)) });
    for (const { card, amount } of net.values()) {
      // Money put on a card by a return must still be there to take off again.
      if (amount.gt(0) && D(card.balance).lt(amount)) return `The refund on gift card ${maskGiftCardNumber(card.number)} was already spent; this return cannot be cancelled`;
    }
    return null;
  }

  /** Cancelling bills (before their shift closes): spends go back on the cards, refunds come off them. */
  async cancelBills(tx: Db, billIds: string[], actorId: string | null, date: string, storeId: string): Promise<void> {
    const entries = await tx.giftCardEntry.findMany({ where: { billId: { in: billIds } } });
    if (!entries.length) return;
    const problem = await this.cancelProblem(tx, billIds);
    if (problem) throw new BadRequestException(problem);
    const net = new Map<string, { billId: string; cardId: string; amount: Decimal }>();
    for (const e of entries) {
      const k = `${e.billId}|${e.cardId}`;
      net.set(k, { billId: e.billId!, cardId: e.cardId, amount: (net.get(k)?.amount ?? ZERO).add(D(e.amount)) });
    }
    for (const n of net.values()) {
      if (n.amount.isZero()) continue;
      const back = n.amount.neg();
      const done = await tx.giftCard.updateMany({ where: { id: n.cardId, ...(back.lt(0) ? { balance: { gte: back.neg().toFixed(2) } } : { status: { not: 'expired' } }) }, data: { balance: { increment: back.toFixed(2) }, updatedById: actorId } });
      if (done.count !== 1) throw new BadRequestException('A gift card of this bill changed a moment ago; try again');
      const after = await tx.giftCard.findUniqueOrThrow({ where: { id: n.cardId } });
      await tx.giftCardEntry.create({ data: { cardId: n.cardId, kind: back.gt(0) ? 'refund' : 'spend', amount: back.toFixed(2), balanceAfter: D(after.balance).toFixed(2), billId: n.billId, storeId, entryDate: fromIso(date), remark: 'Bill cancelled', createdById: actorId } });
    }
  }

  /** The gift card lines of each bill's receipt: last 4 digits, amount and balance left. */
  async receiptInfo(db: Db, billIds: string[]): Promise<Map<string, ReceiptGiftCard[]>> {
    const out = new Map<string, ReceiptGiftCard[]>();
    if (!billIds.length) return out;
    const entries = await db.giftCardEntry.findMany({ where: { billId: { in: billIds } }, include: { card: true }, orderBy: { createdAt: 'asc' } });
    for (const e of entries) {
      const list = out.get(e.billId!) ?? [];
      list.push({ action: D(e.amount).lt(0) ? 'spent' : 'refunded', number: maskGiftCardNumber(e.card.number), barcode: false, amount: D(e.amount).abs().toFixed(2), balance: D(e.balanceAfter).toFixed(2), expiresOn: iso(e.card.expiresOn)! });
      out.set(e.billId!, list);
    }
    return out;
  }

  // ---- Nightly expiry (plan 13 §2) ----

  @Cron('25 2 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    if (process.env.EXPIRY_SCHEDULE === 'off') return;
    // Plan 14: shop by shop.
    await forEachShop(this.system, this.log, 'Nightly gift card expiry', async () => {
      try {
        for (const c of await this.prisma.company.findMany({ where: { active: true }, select: { id: true } })) {
          const r = await this.expire(c.id, businessDate(), { userId: null, ipAddress: null });
          if (r.cards) this.log.log(`${r.cards} gift card(s) expired, ₹${r.value} written back`);
        }
      } catch (err) {
        this.log.error('Nightly gift card expiry failed', err instanceof Error ? err.stack : String(err));
      }
    });
  }

  /**
   * Cards whose expiry day has come: the balance left is written back (debit
   * the liability, credit the account set for "Expired gift card balances",
   * other income unless the accountant chose another) and the card marked
   * expired. Cards show in the expiring-cards report for the month before.
   */
  async expire(companyId: string, today: string, actor: Actor): Promise<{ cards: number; value: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`giftcards|expiry|${companyId}`}))`;
        const due = await tx.giftCard.findMany({ where: { companyId, status: { in: ['active', 'blocked'] }, expiresOn: { lte: fromIso(today) } } });
        let total = ZERO;
        const lines: LedgerLineInput[] = [];
        for (const card of due) {
          const balance = D(card.balance);
          const done = await tx.giftCard.updateMany({ where: { id: card.id, status: card.status, balance: card.balance }, data: { status: 'expired', balance: '0', updatedById: actor.userId } });
          if (done.count !== 1) continue;
          if (balance.gt(0)) {
            await tx.giftCardEntry.create({ data: { cardId: card.id, kind: 'expire', amount: balance.neg().toFixed(2), balanceAfter: '0', storeId: card.issuedStoreId, entryDate: fromIso(today), remark: 'Expired: balance written back', createdById: actor.userId } });
            lines.push({ role: 'gift_card_liability', storeId: card.issuedStoreId, debit: balance, remark: `Gift card ${maskGiftCardNumber(card.number)} expired` }, { role: 'gift_card_expiry', storeId: card.issuedStoreId, credit: balance, remark: `Gift card ${maskGiftCardNumber(card.number)} expired` });
            total = total.add(balance);
          }
        }
        if (lines.length) await this.ledger.post(tx, { companyId, date: today, documentType: 'gift_card_expiry', documentId: companyId, documentNumber: `Gift cards expired ${today}`, actorId: actor.userId, lines, remark: `${due.length} gift card(s) expired`, whenLocked: 'next_open' });
        if (due.length) await this.audit.record(tx, actor, { action: 'update', entityType: 'gift_card_expiry', entityId: companyId, changes: { date: today, cards: due.length, value: total.toFixed(2) } });
        return { cards: due.length, value: total.toFixed(2) };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  async runExpiry(actor: Actor) {
    const company = await this.company.current();
    return this.expire(company.id, businessDate(), actor);
  }

  // ---- Reports (plan 13 §2 "Screens") ----

  /** Gift card liability: the ledger less what open shifts will still debit must equal the sum of card balances. */
  async liability(db: Db = this.prisma) {
    const company = await this.company.current(db);
    const sums = await db.giftCard.aggregate({ where: { companyId: company.id }, _sum: { balance: true }, _count: { _all: true } });
    const byStatus = await db.giftCard.groupBy({ by: ['status'], where: { companyId: company.id }, _sum: { balance: true }, _count: { _all: true } });
    const entries = await db.giftCardEntry.aggregate({ where: { card: { companyId: company.id } }, _sum: { amount: true } });
    const balances = D(sums._sum.balance ?? 0);
    const d = await db.accountDefault.findUnique({ where: { companyId_role: { companyId: company.id, role: 'gift_card_liability' } } });
    const l = d ? await db.ledgerLine.aggregate({ where: { accountId: d.accountId }, _sum: { debit: true, credit: true } }) : null;
    const ledger = l ? D(l._sum.credit ?? 0).sub(D(l._sum.debit ?? 0)) : ZERO;
    // Gift card payments on bills of shifts still open reach the ledger when the shift closes.
    const pending = await db.posPayment.aggregate({ where: { paymentMethod: { accountRole: GIFT_CARD_PAYMENT_ROLE }, bill: { companyId: company.id, status: 'completed', shift: { status: 'open' } } }, _sum: { amount: true } });
    const pendingNet = D(pending._sum.amount ?? 0);
    const difference = ledger.sub(pendingNet).sub(balances);
    return {
      cards: sums._count._all,
      balance: balances.toFixed(2),
      byStatus: byStatus.map((s) => ({ status: s.status, cards: s._count._all, balance: D(s._sum.balance ?? 0).toFixed(2) })),
      ledger: ledger.toFixed(2),
      pending: pendingNet.toFixed(2),
      difference: difference.toFixed(2),
      ok: difference.isZero() && D(entries._sum.amount ?? 0).eq(balances),
    };
  }

  async liabilityProblems(db: Db = this.prisma): Promise<string[]> {
    const l = await this.liability(db);
    if (l.ok) return [];
    return [`Gift card liability is ₹${l.ledger} (₹${l.pending} still to post from open shifts) but the cards hold ₹${l.balance}`];
  }

  /** Sold and reloaded, spent, refunded and expired, by month. */
  async byMonth(q: LoyaltyReportQuery, user: CurrentUser) {
    const company = await this.company.current();
    const stores = allowedStoreIds(user);
    const rows = await this.prisma.giftCardEntry.findMany({
      where: {
        card: { companyId: company.id },
        ...(q.storeId ? { storeId: q.storeId } : stores ? { storeId: { in: stores } } : {}),
        ...(q.from || q.to ? { entryDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
      },
      select: { kind: true, amount: true, entryDate: true },
    });
    const months = new Map<string, Record<string, Decimal>>();
    for (const r of rows) {
      const m = iso(r.entryDate)!.slice(0, 7);
      const row = months.get(m) ?? {};
      row[r.kind] = (row[r.kind] ?? ZERO).add(D(r.amount));
      months.set(m, row);
    }
    return [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, r]) => ({ month, loaded: (r.load ?? ZERO).toFixed(2), spent: (r.spend ?? ZERO).neg().toFixed(2), refunded: (r.refund ?? ZERO).toFixed(2), expired: (r.expire ?? ZERO).neg().toFixed(2) }));
  }

  /** Cards with money on them that expire soon (the next 30 days, or a chosen period), before the night run writes them back. */
  async expiring(q: LoyaltyReportQuery, user: CurrentUser) {
    const company = await this.company.current();
    const today = businessDate();
    const from = q.from ?? today;
    const to = q.to ?? addDays(today, EXPIRING_DAYS);
    const stores = allowedStoreIds(user);
    const rows = await this.prisma.giftCard.findMany({
      where: { companyId: company.id, status: { in: ['active', 'blocked'] }, balance: { gt: 0 }, expiresOn: { gte: fromIso(from), lte: fromIso(to) }, ...(stores ? { issuedStoreId: { in: stores } } : {}) },
      orderBy: { expiresOn: 'asc' },
    });
    const full = hasPermission(user, 'giftcards.manage');
    return { from, to, balance: rows.reduce((s, c) => s.add(D(c.balance)), ZERO).toFixed(2), rows: rows.map((c) => cardDto(c, full)) };
  }

  assertView(user: CurrentUser) {
    if (!['giftcards.view', 'giftcards.manage', 'giftcards.sell'].some((k) => hasPermission(user, k as never))) throw new ForbiddenException('You do not have the right "giftcards.view"');
  }
}

export function cardDto(c: GiftCard, fullNumber: boolean): GiftCardDto {
  return {
    id: c.id,
    number: fullNumber ? c.number : maskGiftCardNumber(c.number),
    holderName: c.holderName,
    holderPhone: c.holderPhone,
    customerId: c.customerId,
    issuedStoreId: c.issuedStoreId,
    issuedOn: iso(c.issuedOn)!,
    loadedTotal: D(c.loadedTotal).toFixed(2),
    balance: D(c.balance).toFixed(2),
    expiresOn: iso(c.expiresOn)!,
    status: c.status as GiftCardDto['status'],
    blockedReason: c.blockedReason,
  };
}

function entryDto(e: GiftCardEntry, bills: Map<string, string>): GiftCardEntryDto {
  return {
    id: e.id,
    kind: e.kind as GiftCardEntryDto['kind'],
    amount: D(e.amount).toFixed(2),
    balanceAfter: D(e.balanceAfter).toFixed(2),
    billId: e.billId,
    billNumber: e.billId ? (bills.get(e.billId) ?? null) : null,
    storeId: e.storeId,
    entryDate: iso(e.entryDate)!,
    remark: e.remark,
    createdAt: e.createdAt.toISOString(),
  };
}
