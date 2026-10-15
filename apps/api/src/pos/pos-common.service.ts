// Copyright (c) 2026, Rademics. All rights reserved.
// Helpers shared by the point-of-sale services (plan 06; pos-offline plan):
// tills and their registered computers, manager approvals and cashier
// switching by PIN, the GST rate list, and company defaults.
import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { type ApprovalAction, businessDate, type CurrentUser, Decimal, hasPermission, PAYMENT_ACCOUNT_ROLES, type PermissionKey } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { canAccessStore } from '../auth/store-access.js';
import { CompanyService } from '../company/company.service.js';
import type { GstRate, Item, PosSettings, Till } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const D = (v: { toString(): string } | string | number) => new Decimal(v.toString());
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** Header the till page sends with its registered computer's token. */
export const TILL_TOKEN_HEADER = 'x-till-token';

/** Approvals live for ten minutes and are used once (decision 40). */
const APPROVAL_MINUTES = 10;

export const DEFAULT_PAYMENT_METHODS = [
  { code: 'CASH', name: 'Cash', kind: 'cash', allowRefund: true, needsReference: false },
  { code: 'CARD', name: 'Card', kind: 'card', allowRefund: true, needsReference: true },
  { code: 'UPI', name: 'UPI', kind: 'upi', allowRefund: true, needsReference: true },
] as const;

/**
 * Idempotent: POS settings and the standard payment methods for a company.
 * Safe when several screens ask at the same moment: rows that already exist are skipped, never an error.
 */
export async function ensurePosDefaults(db: Db, companyId: string): Promise<PosSettings> {
  await db.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((m) => ({ companyId, ...m, accountRole: PAYMENT_ACCOUNT_ROLES[m.kind] })), skipDuplicates: true });
  await db.posSettings.createMany({ data: [{ companyId }], skipDuplicates: true });
  return db.posSettings.findUniqueOrThrow({ where: { companyId } });
}

export type TillWithRefs = Till & { store: { id: string; code: string; name: string; stateCode: string | null; companyId: string }; paymentMethods: { paymentMethodId: string; isDefault: boolean; paymentMethod: { id: string; code: string; name: string; kind: string; allowRefund: boolean; needsReference: boolean; active: boolean } }[] };

@Injectable()
export class PosCommon {
  constructor(
    readonly prisma: PrismaService,
    private readonly company: CompanyService,
  ) {}

  currentCompany(db: Db = this.prisma) {
    return this.company.current(db);
  }

  async settings(db: Db, companyId: string): Promise<PosSettings> {
    return ensurePosDefaults(db, companyId);
  }

  requireRight(user: CurrentUser, key: PermissionKey): void {
    if (!hasPermission(user, key)) throw new ForbiddenException(`You do not have the right "${key}"`);
  }

  async till(db: Db, tillId: string): Promise<TillWithRefs> {
    const till = await db.till.findUnique({
      where: { id: tillId },
      include: { store: { select: { id: true, code: true, name: true, stateCode: true, companyId: true } }, paymentMethods: { include: { paymentMethod: true } } },
    });
    if (!till) throw new NotFoundException('Till not found');
    return till;
  }

  /** The till exists, is in use, and the user may work in its store (rule 11). */
  async usableTill(db: Db, tillId: string, user: CurrentUser): Promise<TillWithRefs> {
    const till = await this.till(db, tillId);
    if (!till.active) throw new BadRequestException(`Till ${till.code} is switched off`);
    if (!canAccessStore(user, till.storeId)) throw new ForbiddenException('You are not allowed to work in this store');
    return till;
  }

  /** Till endpoints need the registered computer's token (pos-offline §9). */
  async assertDevice(db: Db, tillId: string, token: string | undefined): Promise<void> {
    if (!token) throw new UnauthorizedException('This computer is not registered as a till');
    const device = await db.tillDevice.findUnique({ where: { tokenHash: sha256(token) } });
    if (!device || device.revokedAt || device.tillId !== tillId) throw new UnauthorizedException('This computer is not registered for this till');
    await db.tillDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }

  // ---- Manager approvals and cashier switching (decisions 40, 68) ----

  /** Creates a single-use approval after the manager's PIN was checked by PinService. */
  async createApproval(db: Db, tillId: string, managerId: string, action: ApprovalAction, details: string | null): Promise<string> {
    const token = newToken();
    await db.posApproval.create({ data: { tokenHash: sha256(token), tillId, managerId, action, details, expiresAt: new Date(Date.now() + APPROVAL_MINUTES * 60_000) } });
    return token;
  }

  /** Uses an approval once; returns the manager who gave it. */
  async useApproval(db: Db, token: string | undefined, tillId: string, actions: ApprovalAction[], usedFor: string): Promise<string> {
    if (!token) throw new ForbiddenException('A manager must approve this');
    const a = await db.posApproval.findUnique({ where: { tokenHash: sha256(token) } });
    if (!a || a.tillId !== tillId || !actions.includes(a.action as ApprovalAction)) throw new ForbiddenException('The manager approval is not valid for this');
    if (a.usedAt) throw new ForbiddenException('The manager approval was already used');
    if (a.expiresAt < new Date()) throw new ForbiddenException('The manager approval has expired; ask again');
    await db.posApproval.update({ where: { id: a.id }, data: { usedAt: new Date(), usedFor } });
    return a.managerId;
  }

  async createCashierToken(db: Db, tillId: string, userId: string): Promise<string> {
    const token = newToken();
    await db.posCashierToken.create({ data: { tokenHash: sha256(token), tillId, userId, expiresAt: new Date(Date.now() + 12 * 3600_000) } });
    return token;
  }

  /** The cashier of a bill: the one who switched in with their PIN, else the signed-in user. */
  async cashierFor(db: Db, tillId: string, token: string | undefined, user: CurrentUser): Promise<string> {
    if (!token) return user.id;
    const t = await db.posCashierToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!t || t.tillId !== tillId || t.expiresAt < new Date()) throw new UnauthorizedException('The cashier switch has expired; switch again with the PIN');
    return t.userId;
  }

  // ---- GST rate list (decision 56; plan 06 answer 1) ----

  /**
   * The rate for an item on a date: the longest matching HSN code (8, 6 or 4
   * digits) with the latest start date on or before the date.
   */
  async gstRateFor(db: Db, item: Pick<Item, 'code' | 'hsnCode'>, date: string): Promise<GstRate> {
    if (!item.hsnCode) throw new BadRequestException(`${item.code} has no HSN code, so its GST rate is not known`);
    const codes = [item.hsnCode.slice(0, 8), item.hsnCode.slice(0, 6), item.hsnCode.slice(0, 4)].filter((c, i, a) => c.length >= 4 && a.indexOf(c) === i);
    for (const code of codes) {
      const rate = await db.gstRate.findFirst({ where: { hsnCode: code, effectiveFrom: { lte: fromIso(date) } }, orderBy: { effectiveFrom: 'desc' } });
      if (rate) return rate;
    }
    throw new BadRequestException(`No GST rate is set for HSN ${item.hsnCode} (${item.code}); add it to the GST rate list`);
  }

  /** IGST when a business customer is registered in another state than the store. */
  interState(storeState: string | null, companyState: string, customer: { gstin: string | null; stateCode: string | null } | null): boolean {
    if (!customer?.gstin || !customer.stateCode) return false;
    return customer.stateCode !== (storeState ?? companyState);
  }

  today(): string {
    return businessDate();
  }
}
