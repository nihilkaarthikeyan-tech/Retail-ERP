// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 at the till: selling a new gift card or reloading one, checking a
// card's balance, and a customer's points after the cashier picks them.
//
// Selling or loading a card is its own till transaction, not a bill line: a
// card is not stock and no GST is charged when it is sold (plan 13 §2; CA to
// confirm). The money is a receipt posted at once, as for a customer order's
// advance (plan 11 part 2): cash goes to the store's cash in hand and into the
// shift's drawer as a "cash in", so the expected cash at closing stays right;
// card and UPI go to their settlement accounts. It needs the connection: the
// card number is made, and a reload's card checked, on the server.
import { BadRequestException, Injectable } from '@nestjs/common';
import { businessDate, type CurrentUser, type CustomerLoyaltyDto, formatGiftCardNumber, type GiftCardSaleInput, isSpecialPaymentMethod, maskGiftCardNumber, type ReceiptGiftCard } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { cardDto, GiftCardsService } from '../loyalty/gift-cards.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, iso, PosCommon } from './pos-common.service.js';

/** Company-wide number series for gift card sale receipts (store-wise series may be added on the numbering screen). */
export const GIFT_CARD_NUMBER_SERIES: Record<string, string> = { gift_card_sale: 'GC-{FY}-' };

@Injectable()
export class PosGiftCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
    private readonly cards: GiftCardsService,
    private readonly loyalty: LoyaltyService,
    private readonly numbering: NumberingService,
  ) {}

  /** A customer's points as the till shows them after the cashier picks the customer (needs the connection). */
  async customerPoints(tillId: string, customerId: string, user: CurrentUser): Promise<CustomerLoyaltyDto> {
    await this.common.usableTill(this.prisma, tillId, user);
    return this.loyalty.customerSummary(customerId, user, false);
  }

  /** Checking a card at the till: balance, expiry, status (the number was typed or scanned). */
  async check(tillId: string, number: string, user: CurrentUser) {
    await this.common.usableTill(this.prisma, tillId, user);
    return this.cards.lookup(number);
  }

  /** Selling a new card or loading more onto one, at the till; sent twice, it is saved once. */
  async sell(input: GiftCardSaleInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'giftcards.sell');
    const company = await this.common.currentCompany();
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    await this.common.assertDevice(this.prisma, till.id, deviceToken);
    const again = await this.byClientId(input.clientId);
    if (again) return again;
    const shift = await this.prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
    if (!shift) throw new BadRequestException('Open a shift on this till first');
    const date = businessDate();
    if (iso(shift.businessDate) !== date) throw new BadRequestException(`This till’s shift is from ${iso(shift.businessDate)}; close it and open a new one`);
    const method = till.paymentMethods.find((m) => m.paymentMethodId === input.paymentMethodId)?.paymentMethod;
    if (!method || !method.active) throw new BadRequestException('That payment method is not used on this till');
    if (method.kind === 'on_account' || isSpecialPaymentMethod(method)) throw new BadRequestException(`A gift card is paid for with money; ${method.name} cannot pay for it`);
    if (method.needsReference && !input.reference?.trim()) throw new BadRequestException(`${method.name} needs the approval code or reference`);
    if (input.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!c || c.companyId !== company.id || c.isWalkIn) throw new BadRequestException('Customer not found');
    }
    await this.prisma.numberSeries.createMany({ data: Object.entries(GIFT_CARD_NUMBER_SERIES).map(([documentKind, pattern]) => ({ companyId: company.id, documentKind, pattern, counterLength: 5 })), skipDuplicates: true });
    const amount = D(input.amount);
    const result = await this.prisma.$transaction(
      async (tx) => {
        // A retry arriving at the same moment waits here and then finds the first one.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`giftcard|sale|${input.clientId}`}))`;
        if (await this.clientIdUsed(tx, input.clientId)) return null;
        const receiptNumber = await this.numbering.allocate(tx, { companyId: company.id, documentKind: 'gift_card_sale', storeId: till.storeId, date });
        const { card, entry, isNew } = await this.cards.load(tx, {
          companyId: company.id,
          storeId: till.storeId,
          number: input.number ?? null,
          amount,
          date,
          holderName: input.holderName ?? null,
          holderPhone: input.holderPhone ?? null,
          customerId: input.customerId ?? null,
          actorId: actor.userId,
          // Cash is received into the store's cash in hand; the shift's drawer entry moves the "cash in" to the till.
          debit: method.kind === 'cash' ? { role: 'cash_in_hand' } : { role: method.accountRole },
          receiptNumber,
          methodName: method.name,
          paymentMethodId: method.id,
          tillId: till.id,
        });
        if (method.kind === 'cash') {
          await tx.cashMovement.create({ data: { shiftId: shift.id, clientId: input.clientId, direction: 'in', amount: amount.toFixed(2), reason: `Gift card ${maskGiftCardNumber(card.number)} ${isNew ? 'sold' : 'reloaded'} (${receiptNumber})`, byId: user.id, at: new Date() } });
        }
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'gift_card_entry',
          entityId: entry.id,
          changes: { kind: 'load', card: maskGiftCardNumber(card.number), cardId: card.id, isNew, amount: amount.toFixed(2), receipt: receiptNumber, till: till.code, method: method.code, reference: input.reference ?? null, clientId: input.clientId },
        });
        return entry.id;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    if (!result) {
      const first = await this.byClientId(input.clientId);
      if (first) return first;
      throw new BadRequestException('The gift card sale could not be found again; check the card list');
    }
    return this.saleDto(result);
  }

  /** What the till shows and prints after a sale or reload (the full number, with a barcode). */
  private async saleDto(entryId: string) {
    const entry = await this.prisma.giftCardEntry.findUniqueOrThrow({ where: { id: entryId }, include: { card: true } });
    const log = await this.prisma.auditLog.findFirst({ where: { entityType: 'gift_card_entry', entityId: entryId }, orderBy: { at: 'asc' } });
    const changes = (log?.changes ?? {}) as { receipt?: string; isNew?: boolean; method?: string; reference?: string | null; till?: string };
    const method = changes.method ? await this.prisma.paymentMethod.findFirst({ where: { companyId: entry.card.companyId, code: changes.method } }) : null;
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: entry.storeId ?? entry.card.issuedStoreId } });
    const company = await this.common.currentCompany();
    const isNew = !!changes.isNew;
    const giftCard: ReceiptGiftCard = { action: isNew ? 'sold' : 'loaded', number: formatGiftCardNumber(entry.card.number), barcode: true, amount: D(entry.amount).toFixed(2), balance: D(entry.balanceAfter).toFixed(2), expiresOn: iso(entry.card.expiresOn)! };
    return {
      repeated: false,
      card: cardDto(entry.card, true),
      receipt: {
        billId: null,
        number: changes.receipt ?? entry.id,
        kind: 'sale' as const,
        title: 'GIFT CARD RECEIPT',
        duplicate: false,
        provisional: false,
        soldAt: entry.createdAt.toISOString(),
        till: changes.till ?? '',
        footer: 'No GST is charged on a gift card; GST is charged on the goods bought with it.',
        lines: [{ name: isNew ? 'Gift card (new)' : 'Gift card (reload)', code: '', hsn: null, quantity: '1', price: D(entry.amount).toFixed(2), discount: '0.00', amount: D(entry.amount).toFixed(2), free: false, serials: [] }],
        gstTable: [],
        totals: { gross: D(entry.amount).toFixed(2), discount: '0.00', taxable: '0.00', rounding: '0.00', total: D(entry.amount).toFixed(2) },
        payments: [{ method: method?.name ?? changes.method ?? '', amount: D(entry.amount).toFixed(2), reference: changes.reference ?? null }],
        change: '0.00',
        giftCards: [giftCard],
        loyalty: null,
        store: { name: store.name, address: [store.addressLine1, store.addressLine2, store.city, store.pincode].filter(Boolean).join(', '), phone: store.phone },
        company: { legalName: company.legalName },
      },
    };
  }

  private async clientIdUsed(db: Db, clientId: string): Promise<boolean> {
    return !!(await db.auditLog.findFirst({ where: { entityType: 'gift_card_entry', changes: { path: ['clientId'], equals: clientId } }, select: { id: true } }));
  }

  /** A sale already saved under this client id (idempotency, pos-offline §4). */
  private async byClientId(clientId: string) {
    const log = await this.prisma.auditLog.findFirst({ where: { entityType: 'gift_card_entry', changes: { path: ['clientId'], equals: clientId } }, select: { entityId: true } });
    if (!log?.entityId) return null;
    const dto = await this.saleDto(log.entityId);
    return { ...dto, repeated: true };
  }
}

