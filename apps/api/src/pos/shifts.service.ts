// Copyright (c) 2026, Rademics. All rights reserved.
// Till shifts (blueprint 09 process 1; decisions 41, 68; plan 06 answers 4, 6).
// One open shift per till; cashiers switch on it by PIN. Opening and cash
// in/out are idempotent so an offline till can send them again safely.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CashMovementInput,
  type CloseShiftInput,
  type CurrentUser,
  Decimal,
  denominationTotal,
  expectedAtClose,
  hasPermission,
  type OpenShiftInput,
} from 'shared';
import { assertStoreAccess } from '../auth/store-access.js';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PosCommon } from './pos-common.service.js';
import { PosPostings } from './pos-postings.service.js';

const shiftInclude = {
  till: { select: { id: true, code: true, name: true, storeId: true, companyId: true } },
  openingCash: true,
  cashMovements: { orderBy: { at: 'asc' } },
  closing: { include: { lines: true } },
} satisfies Prisma.ShiftInclude;
type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
    private readonly postings: PosPostings,
  ) {}

  async open(input: OpenShiftInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'pos.sell');
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    await this.common.assertDevice(this.prisma, till.id, deviceToken);
    const again = await this.prisma.shift.findUnique({ where: { tillId_clientId: { tillId: till.id, clientId: input.clientId } }, include: shiftInclude });
    if (again) return this.toDto(again); // sent twice: the same shift (pos-offline §4)
    const openNow = await this.prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
    if (openNow) throw new BadRequestException(`Till ${till.code} already has an open shift from ${iso(openNow.businessDate)}; close it first`);
    const methods = new Set(till.paymentMethods.map((m) => m.paymentMethodId));
    for (const c of input.cash) if (!methods.has(c.paymentMethodId)) throw new BadRequestException('That payment method is not used on this till');
    const openedAt = input.openedAt ? new Date(input.openedAt) : new Date();
    if (openedAt.getTime() > Date.now() + 10 * 60_000) throw new BadRequestException('The till clock is ahead of the server; check the computer’s date and time');
    try {
      const shift = await this.prisma.$transaction(async (tx) => {
        const s = await tx.shift.create({
          data: {
            companyId: till.companyId,
            tillId: till.id,
            clientId: input.clientId,
            businessDate: fromIso(businessDate(openedAt)),
            openedById: user.id,
            openedAt,
            openingCash: { create: input.cash.map((c) => ({ paymentMethodId: c.paymentMethodId, amount: D(c.amount).toFixed(2) })) },
          },
          include: shiftInclude,
        });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'shift', entityId: s.id, changes: { till: till.code, opening: input.cash.map((c) => `${c.paymentMethodId}:${c.amount}`) } });
        return s;
      });
      return this.toDto(shift);
    } catch (err) {
      const raced = await this.prisma.shift.findUnique({ where: { tillId_clientId: { tillId: till.id, clientId: input.clientId } }, include: shiftInclude });
      if (raced) return this.toDto(raced);
      throw err;
    }
  }

  /** The till's open shift with what has happened so far, or null. */
  async current(tillId: string, user: CurrentUser) {
    const till = await this.common.usableTill(this.prisma, tillId, user);
    const shift = await this.prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' }, include: shiftInclude });
    if (!shift) return null;
    return { ...this.toDto(shift), expected: await this.expected(this.prisma, shift) };
  }

  async get(id: string, user: CurrentUser) {
    const shift = await this.getRow(this.prisma, id);
    await this.common.usableTill(this.prisma, shift.tillId, user).catch(async (e) => {
      if (!hasPermission(user, 'pos.reports')) throw e;
    });
    // Audit 1 (28 October 2026): the reports right reads shifts of a switched-off till, but only in the person's own stores.
    assertStoreAccess(user, shift.till.storeId);
    return { ...this.toDto(shift), expected: await this.expected(this.prisma, shift) };
  }

  private async getRow(db: Db, id: string): Promise<ShiftRow> {
    const s = await db.shift.findUnique({ where: { id }, include: shiftInclude });
    if (!s) throw new NotFoundException('Shift not found');
    return s;
  }

  async cashMovement(shiftId: string, input: CashMovementInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'pos.sell');
    const shift = await this.getRow(this.prisma, shiftId);
    await this.common.usableTill(this.prisma, shift.tillId, user);
    await this.common.assertDevice(this.prisma, shift.tillId, deviceToken);
    const again = await this.prisma.cashMovement.findUnique({ where: { shiftId_clientId: { shiftId, clientId: input.clientId } } });
    if (again) return movementDto(again);
    if (shift.status !== 'open') throw new BadRequestException('The shift is closed');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const m = await tx.cashMovement.create({ data: { shiftId, clientId: input.clientId, direction: input.direction, amount: D(input.amount).toFixed(2), reason: input.reason, byId: user.id, at: input.at ? new Date(input.at) : new Date() } });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'cash_movement', entityId: m.id, changes: { direction: m.direction, amount: m.amount.toString(), reason: m.reason, till: shift.till.code } });
        return movementDto(m);
      });
    } catch (err) {
      const raced = await this.prisma.cashMovement.findUnique({ where: { shiftId_clientId: { shiftId, clientId: input.clientId } } });
      if (raced) return movementDto(raced);
      throw err;
    }
  }

  /**
   * Expected per payment method (blueprint 09 calculations; decision 41):
   * opening + payments (refunds negative) − change given in cash ± cash in/out.
   */
  async expected(db: Db, shift: ShiftRow) {
    const till = await this.common.till(db, shift.tillId);
    const bills = await db.posBill.findMany({ where: { shiftId: shift.id, status: 'completed' }, include: { payments: true } });
    const cashMethodIds = new Set(till.paymentMethods.filter((m) => m.paymentMethod.kind === 'cash').map((m) => m.paymentMethodId));
    const defaultCash = till.paymentMethods.find((m) => m.paymentMethod.kind === 'cash' && m.isDefault)?.paymentMethodId ?? [...cashMethodIds][0];
    const methodIds = new Set([...till.paymentMethods.map((m) => m.paymentMethodId), ...shift.openingCash.map((c) => c.paymentMethodId)]);
    return [...methodIds].map((methodId) => {
      const method = till.paymentMethods.find((m) => m.paymentMethodId === methodId)?.paymentMethod;
      const isCash = cashMethodIds.has(methodId);
      const payments = bills.flatMap((b) => b.payments.filter((p) => p.paymentMethodId === methodId).map((p) => p.amount.toString()));
      // Change is given from the cash method the bill was paid with (the default cash method otherwise).
      const change = isCash
        ? bills.reduce((s, b) => {
            const cashPay = b.payments.find((p) => cashMethodIds.has(p.paymentMethodId));
            return (cashPay?.paymentMethodId ?? defaultCash) === methodId ? s.add(D(b.changeAmount)) : s;
          }, new Decimal(0))
        : new Decimal(0);
      const cashIn = methodId === defaultCash ? shift.cashMovements.filter((m) => m.direction === 'in').reduce((s, m) => s.add(D(m.amount)), new Decimal(0)) : new Decimal(0);
      const cashOut = methodId === defaultCash ? shift.cashMovements.filter((m) => m.direction === 'out').reduce((s, m) => s.add(D(m.amount)), new Decimal(0)) : new Decimal(0);
      const opening = D(shift.openingCash.find((c) => c.paymentMethodId === methodId)?.amount ?? '0');
      return {
        paymentMethodId: methodId,
        code: method?.code ?? '',
        name: method?.name ?? '',
        kind: method?.kind ?? 'other',
        opening: opening.toFixed(2),
        received: payments.reduce((s, p) => s.add(D(p)), new Decimal(0)).toFixed(2),
        change: change.toFixed(2),
        cashIn: cashIn.toFixed(2),
        cashOut: cashOut.toFixed(2),
        expected: expectedAtClose({ opening, payments, change, cashIn, cashOut }).toFixed(2),
      };
    });
  }

  /** Closing with the count of notes and coins (decision 41; plan 06 answer 6). */
  async close(shiftId: string, input: CloseShiftInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'pos.close');
    const shift = await this.getRow(this.prisma, shiftId);
    const till = await this.common.usableTill(this.prisma, shift.tillId, user);
    await this.common.assertDevice(this.prisma, till.id, deviceToken);
    if (shift.status !== 'open') throw new BadRequestException(`The shift is already ${shift.status}`);
    const settings = await this.common.settings(this.prisma, till.companyId);
    const expected = await this.expected(this.prisma, shift);
    let cashCounted: Decimal;
    try {
      cashCounted = denominationTotal(input.denominations);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const cashMethods = expected.filter((e) => e.kind === 'cash');
    const lines = expected.map((e) => {
      const given = input.counted.find((c) => c.paymentMethodId === e.paymentMethodId);
      // All cash in the drawer is counted against the (first) cash method; card slips and UPI confirmations are typed.
      const counted = e.kind === 'cash' ? (e.paymentMethodId === cashMethods[0]?.paymentMethodId ? cashCounted : new Decimal(0)) : D(given?.amount ?? e.expected);
      return { ...e, counted: counted.toFixed(2), difference: counted.sub(D(e.expected)).toFixed(2) };
    });
    const biggest = lines.reduce((m, l) => Decimal.max(m, D(l.difference).abs()), new Decimal(0));
    let approvedById: string | null = null;
    if (biggest.gt(D(settings.cashDifferenceApprovalAmount))) {
      if (!input.remarks?.trim()) throw new BadRequestException(`The difference is more than ₹${D(settings.cashDifferenceApprovalAmount).toFixed(2)}; write a remark`);
      approvedById = await this.common.useApproval(this.prisma, input.approvalToken, till.id, ['cash_difference'], `shift ${shift.id}`);
    }
    const summary = await this.summary(this.prisma, shift.id);
    const closed = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
      if (fresh.status !== 'open') throw new BadRequestException(`The shift is already ${fresh.status}`);
      await tx.shiftClosing.create({
        data: {
          shiftId,
          closedById: user.id,
          closedAt: new Date(),
          denominations: input.denominations,
          remarks: input.remarks ?? null,
          approvedById,
          bills: summary.bills,
          salesTotal: summary.salesTotal,
          returnsTotal: summary.returnsTotal,
          taxableTotal: summary.taxableTotal,
          cgstTotal: summary.cgstTotal,
          sgstTotal: summary.sgstTotal,
          igstTotal: summary.igstTotal,
          roundingTotal: summary.roundingTotal,
          costTotal: summary.costTotal,
          summary: summary.byRole,
          lines: { create: lines.map((l) => ({ paymentMethodId: l.paymentMethodId, opening: l.opening, expected: l.expected, counted: l.counted, difference: l.difference })) },
        },
      });
      await tx.shift.update({ where: { id: shiftId }, data: { status: 'closed', closedAt: new Date(), closedById: user.id } });
      // Decision 39: the shift's bills reach the ledger now, in the same transaction as the closing.
      const ledgerEntryId = await this.postings.postShift(tx, shiftId, businessDate(), actor.userId);
      await tx.shift.update({ where: { id: shiftId }, data: { ledgerEntryId } });
      await this.audit.record(tx, actor, {
        action: 'update',
        entityType: 'shift',
        entityId: shiftId,
        changes: { status: { old: 'open', new: 'closed' }, till: till.code, differences: lines.map((l) => `${l.code}:${l.difference}`) },
        reason: input.remarks ?? null,
      });
      return this.getRow(tx, shiftId);
    });
    return { ...this.toDto(closed), expected: lines };
  }

  /**
   * Day-end summary by account role (decision 39): module 7 posts it as
   * summarised entries. Returns are minus.
   */
  private async summary(db: Db, shiftId: string) {
    const bills = await db.posBill.findMany({ where: { shiftId, status: 'completed' }, include: { payments: { include: { paymentMethod: true } } } });
    const sum = (f: (b: (typeof bills)[number]) => { toString(): string }) => bills.reduce((s, b) => s.add(D(f(b))), new Decimal(0));
    const byRole: Record<string, string> = {};
    const add = (role: string, v: Decimal) => {
      byRole[role] = D(byRole[role] ?? '0').add(v).toFixed(2);
    };
    add('sales', sum((b) => b.taxableAmount));
    add('output_cgst', sum((b) => b.cgst));
    add('output_sgst', sum((b) => b.sgst));
    add('output_igst', sum((b) => b.igst));
    add('rounding', sum((b) => b.roundingAdjustment));
    add('cost_of_goods_sold', sum((b) => b.costValue));
    for (const b of bills) for (const p of b.payments) add(p.paymentMethod.accountRole, D(p.amount));
    add('change_given', sum((b) => b.changeAmount).neg());
    return {
      bills: bills.length,
      salesTotal: sum((b) => (b.kind === 'sale' ? b.total : '0')).toFixed(2),
      returnsTotal: sum((b) => (b.kind === 'return' ? b.total : '0')).toFixed(2),
      taxableTotal: sum((b) => b.taxableAmount).toFixed(2),
      cgstTotal: sum((b) => b.cgst).toFixed(2),
      sgstTotal: sum((b) => b.sgst).toFixed(2),
      igstTotal: sum((b) => b.igst).toFixed(2),
      roundingTotal: sum((b) => b.roundingAdjustment).toFixed(2),
      costTotal: sum((b) => b.costValue).toFixed(2),
      byRole,
    };
  }

  /** Only a shift with no bills can be cancelled (blueprint 09). */
  async cancel(shiftId: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'pos.shift.manage');
    const shift = await this.getRow(this.prisma, shiftId);
    await this.common.usableTill(this.prisma, shift.tillId, user);
    if (shift.status !== 'open') throw new BadRequestException(`The shift is already ${shift.status}`);
    if (await this.prisma.posBill.count({ where: { shiftId } })) throw new ForbiddenException('A shift with bills cannot be cancelled; close it instead');
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.shift.update({ where: { id: shiftId }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'shift', entityId: shiftId, changes: { status: { old: 'open', new: 'cancelled' } }, reason });
      return this.getRow(tx, shiftId);
    });
    return this.toDto(after);
  }

  toDto(s: ShiftRow) {
    return {
      id: s.id,
      clientId: s.clientId,
      till: s.till,
      businessDate: iso(s.businessDate),
      openedById: s.openedById,
      openedAt: s.openedAt,
      status: s.status,
      closedAt: s.closedAt,
      openingCash: s.openingCash.map((c) => ({ paymentMethodId: c.paymentMethodId, amount: c.amount.toFixed(2) })),
      cashMovements: s.cashMovements.map(movementDto),
      closing: s.closing
        ? {
            closedAt: s.closing.closedAt,
            closedById: s.closing.closedById,
            denominations: s.closing.denominations,
            remarks: s.closing.remarks,
            approvedById: s.closing.approvedById,
            bills: s.closing.bills,
            salesTotal: s.closing.salesTotal.toFixed(2),
            returnsTotal: s.closing.returnsTotal.toFixed(2),
            taxableTotal: s.closing.taxableTotal.toFixed(2),
            cgstTotal: s.closing.cgstTotal.toFixed(2),
            sgstTotal: s.closing.sgstTotal.toFixed(2),
            igstTotal: s.closing.igstTotal.toFixed(2),
            roundingTotal: s.closing.roundingTotal.toFixed(2),
            summary: s.closing.summary,
            lines: s.closing.lines.map((l) => ({ paymentMethodId: l.paymentMethodId, opening: l.opening.toFixed(2), expected: l.expected.toFixed(2), counted: l.counted.toFixed(2), difference: l.difference.toFixed(2) })),
          }
        : null,
    };
  }
}

function movementDto(m: { id: string; clientId: string; direction: string; amount: { toFixed(n: number): string }; reason: string; byId: string; at: Date }) {
  return { id: m.id, clientId: m.clientId, direction: m.direction, amount: m.amount.toFixed(2), reason: m.reason, byId: m.byId, at: m.at };
}
