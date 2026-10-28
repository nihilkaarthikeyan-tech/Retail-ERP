// Copyright (c) 2026, Rademics. All rights reserved.
// Helpers shared by the point-of-sale services (plan 06; pos-offline plan):
// tills and their registered computers, manager approvals and cashier
// switching by PIN, the GST rate list, and company defaults.
import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { type ApprovalAction, businessDate, type CurrentUser, Decimal, hasPermission, PAYMENT_ACCOUNT_ROLES, type PermissionKey, SPECIAL_PAYMENT_METHODS, TILL_INVOICE_PREFIX_RE, tillInvoicePrefixCandidates } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { canAccessStore } from '../auth/store-access.js';
import { CompanyService } from '../company/company.service.js';
import { GstCoreService } from '../gst/gst-core.service.js';
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
  // Plan 07 §1a: customer pays later; a till takes it only when ticked for that till.
  { code: 'ACCOUNT', name: 'On account', kind: 'on_account', allowRefund: true, needsReference: false },
] as const;

/**
 * Idempotent: POS settings and the standard payment methods for a company.
 * Safe when several screens ask at the same moment: rows that already exist are skipped, never an error.
 */
export async function ensurePosDefaults(db: Db, companyId: string): Promise<PosSettings> {
  await db.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((m) => ({ companyId, ...m, accountRole: PAYMENT_ACCOUNT_ROLES[m.kind] })), skipDuplicates: true });
  // Plan 13: paying with loyalty points and with a gift card ("other" methods told apart by their account).
  await db.paymentMethod.createMany({
    data: SPECIAL_PAYMENT_METHODS.map((m) => ({ companyId, code: m.code, name: m.name, kind: m.kind, accountRole: m.accountRole, allowRefund: m.allowRefund, needsReference: m.needsReference })),
    skipDuplicates: true,
  });
  await db.posSettings.createMany({ data: [{ companyId }], skipDuplicates: true });
  return db.posSettings.findUniqueOrThrow({ where: { companyId } });
}

export type TillWithRefs = Till & { store: { id: string; code: string; name: string; stateCode: string | null; companyId: string }; paymentMethods: { paymentMethodId: string; isDefault: boolean; paymentMethod: { id: string; code: string; name: string; kind: string; allowRefund: boolean; needsReference: boolean; active: boolean; accountRole: string } }[] };

/** A manager's approval checked while a bill is built, marked used when the bill is saved. */
export interface PendingApproval {
  id: string;
  usedFor: string;
}

@Injectable()
export class PosCommon {
  constructor(
    readonly prisma: PrismaService,
    private readonly company: CompanyService,
    readonly gst: GstCoreService,
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
    // Audit 1 (28 October 2026): a computer set up as a till of another shop lands here (that till is not visible).
    if (!till) throw new NotFoundException('This till is not part of the shop you are logged in to. If this computer was set up as a till for another shop, register it again for this shop under Billing counter → Tills.');
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
  /**
   * Checks a manager's approval and marks it used. With `pending`, it is only checked
   * and noted; the caller marks it used with markApprovalsUsed inside the transaction that
   * saves the bill, so an approval is never used up by a bill that is then refused.
   */
  async useApproval(db: Db, token: string | undefined, tillId: string, actions: ApprovalAction[], usedFor: string, pending?: PendingApproval[]): Promise<string> {
    if (!token) throw new ForbiddenException('A manager must approve this');
    const a = await db.posApproval.findUnique({ where: { tokenHash: sha256(token) } });
    if (!a || a.tillId !== tillId || !actions.includes(a.action as ApprovalAction)) throw new ForbiddenException('The manager approval is not valid for this');
    if (a.usedAt || pending?.some((p) => p.id === a.id)) throw new ForbiddenException('The manager approval was already used');
    if (a.expiresAt < new Date()) throw new ForbiddenException('The manager approval has expired; ask again');
    if (pending) pending.push({ id: a.id, usedFor });
    else {
      // Audit 2 (28 October 2026): marked used in one step, so two requests at once cannot both use it.
      const r = await db.posApproval.updateMany({ where: { id: a.id, usedAt: null }, data: { usedAt: new Date(), usedFor } });
      if (r.count !== 1) throw new ForbiddenException('The manager approval was already used');
    }
    return a.managerId;
  }

  /** Marks approvals noted by useApproval(…, pending) as used; refuses if another bill used one first. */
  async markApprovalsUsed(tx: Db, pending: PendingApproval[]): Promise<void> {
    for (const p of pending) {
      const r = await tx.posApproval.updateMany({ where: { id: p.id, usedAt: null }, data: { usedAt: new Date(), usedFor: p.usedFor } });
      if (r.count !== 1) throw new ForbiddenException('The manager approval was already used');
    }
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
    // Audit 1 (28 October 2026): a cashier switched off since cannot keep billing on the switch.
    const cashier = await db.user.findUnique({ where: { id: t.userId }, select: { active: true } });
    if (!cashier?.active) throw new UnauthorizedException('That cashier is switched off; switch again with another PIN');
    return t.userId;
  }

  // ---- GST rate list (decision 56; plan 06 answer 1) ----

  /**
   * The rate for an item on a date (plan 08 G2): the longest matching HSN code
   * (8, 6 or 4 digits) with the latest start date on or before the date, and
   * for price-banded codes the band of the selling price per unit.
   */
  async gstRateFor(db: Db, item: Pick<Item, 'code' | 'hsnCode'>, date: string, unitPrice?: Decimal | string | null): Promise<GstRate> {
    // Till prices include GST (decision L7: the band is on the value before GST).
    return this.gst.rateFor(db, item, date, unitPrice, { gstIncluded: true });
  }

  // ---- Invoice prefix of a till (plan 08: CGST rule 46(b), 16 characters) ----

  /** Whether another till uses the prefix, or ever numbered bills with it (numbers are never reused). */
  async invoicePrefixTaken(db: Db, companyId: string, prefix: string, tillId: string | null): Promise<boolean> {
    const other = await db.till.findFirst({ where: { companyId, seriesKind: prefix, ...(tillId ? { id: { not: tillId } } : {}) }, select: { id: true } });
    if (other) return true;
    const used = await db.posBill.findFirst({ where: { companyId, number: { startsWith: `${prefix}/` }, ...(tillId ? { tillId: { not: tillId } } : {}) }, select: { id: true } });
    return !!used;
  }

  /** The first free default prefix for a till (MAIN + T1 → MAT1), else a numbered one. */
  async freeInvoicePrefix(db: Db, companyId: string, storeCode: string, tillCode: string, tillId: string | null): Promise<string> {
    for (const p of tillInvoicePrefixCandidates(storeCode, tillCode)) if (!(await this.invoicePrefixTaken(db, companyId, p, tillId))) return p;
    for (let n = 1; n < 36 ** 3; n++) {
      const p = `T${n.toString(36).toUpperCase()}`;
      if (!(await this.invoicePrefixTaken(db, companyId, p, tillId))) return p;
    }
    throw new BadRequestException('No free invoice prefix; give the till one by hand');
  }

  /**
   * A till made before GST-length numbers gets its short prefix when it next
   * loads its saved copy (pos-offline §2); bills already made keep their numbers.
   */
  async ensureInvoicePrefix<T extends { id: string; companyId: string; code: string; seriesKind: string; store: { code: string } }>(db: Db, till: T, actorId: string | null): Promise<T> {
    if (TILL_INVOICE_PREFIX_RE.test(till.seriesKind)) return till;
    const prefix = await this.freeInvoicePrefix(db, till.companyId, till.store.code, till.code, till.id);
    await db.till.update({ where: { id: till.id }, data: { seriesKind: prefix, updatedById: actorId } });
    await db.auditLog.create({ data: { userId: actorId, action: 'update', entityType: 'till', entityId: till.id, changes: { numberPrefix: { old: till.seriesKind, new: prefix }, reason: 'GST invoice numbers of at most 16 characters' } } });
    return { ...till, seriesKind: prefix };
  }

  today(): string {
    return businessDate();
  }
}
