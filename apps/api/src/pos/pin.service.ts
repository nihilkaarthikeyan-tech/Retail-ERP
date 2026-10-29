// Copyright (c) 2026, Rademics. All rights reserved.
// PINs for manager approvals (decision 40) and quick cashier switching
// (decision 68). PINs are stored only as strong hashes (rule 12), never on the
// till; five wrong PINs lock it for 15 minutes.
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { type ApprovalInput, type CurrentUser, type PermissionKey, type SetPinInput, type SwitchCashierInput, SYSTEM_ROLES } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import type { Actor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertCanTouchUser, callerRights } from '../users/delegation.js';
import { PosCommon } from './pos-common.service.js';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class PinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
  ) {}

  async setOwnPin(input: SetPinInput, actor: Actor, user: CurrentUser) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(input.currentPassword, me.passwordHash))) throw new UnauthorizedException('The password is not correct');
    if (/^(\d)\1+$/.test(input.pin) || '0123456789'.includes(input.pin) || '9876543210'.includes(input.pin)) throw new BadRequestException('Choose a PIN that is not a repeated or running number');
    const pinHash = await hashPassword(input.pin);
    await this.prisma.$transaction(async (tx) => {
      await tx.userPin.upsert({ where: { userId: user.id }, create: { userId: user.id, pinHash }, update: { pinHash, failedCount: 0, lockedUntil: null } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'user_pin', entityId: user.id, changes: { pin: 'set' } });
    });
    return { ok: true };
  }

  /** A manager removes someone's PIN (forgotten PIN); they set a new one themselves. */
  async clearPin(userId: string, actor: Actor) {
    // Audit 1 (28 October 2026): not the PIN of an Owner, or of someone with more rights or stores.
    await assertCanTouchUser(this.prisma, await callerRights(this.prisma, actor.userId), userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.userPin.deleteMany({ where: { userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'user_pin', entityId: userId, changes: { pin: 'cleared' } });
    });
    return { ok: true };
  }

  async hasPin(userId: string) {
    return { hasPin: !!(await this.prisma.userPin.findUnique({ where: { userId } })) };
  }

  /**
   * Checks a user's PIN; locks after five wrong ones. Audit 1 (28 October 2026): each try first
   * takes one of the five in a single database step, before the (slow) PIN check, so PINs sent all
   * at once cannot get more than five tries between them. A right PIN gives the tries back.
   */
  private async checkPin(userId: string, pin: string): Promise<void> {
    const claimed = await this.prisma.$queryRaw<{ pinHash: string; failedCount: number }[]>`
      UPDATE "UserPin"
         SET "failedCount" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedCount" + 1 END,
             -- The fifth try locks at once; a right PIN on it unlocks again.
             "lockedUntil" = CASE WHEN (CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedCount" + 1 END) >= ${MAX_FAILS}
                                  THEN (now() AT TIME ZONE 'UTC') + make_interval(mins => ${LOCK_MINUTES}) ELSE NULL END
       WHERE "userId" = ${userId}::uuid
         AND ("lockedUntil" IS NULL OR "lockedUntil" <= (now() AT TIME ZONE 'UTC'))
   RETURNING "pinHash", "failedCount"`;
    if (!claimed.length) {
      if (!(await this.prisma.userPin.findUnique({ where: { userId } }))) throw new BadRequestException('That person has not set a PIN yet');
      throw new ForbiddenException('Too many wrong PINs; try again later');
    }
    if (!(await verifyPassword(pin, claimed[0].pinHash))) throw new UnauthorizedException('Wrong PIN');
    await this.prisma.userPin.update({ where: { userId }, data: { failedCount: 0, lockedUntil: null } });
  }

  private async userWithRight(userId: string, key: PermissionKey, storeId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: true } } } }, stores: true },
    });
    if (!u || !u.active) throw new ForbiddenException('That person cannot do this');
    const owner = u.roles.some((r) => r.role.active && r.role.code === SYSTEM_ROLES.OWNER_ADMIN);
    const has = owner || u.roles.some((r) => r.role.active && r.role.permissions.some((p) => p.permissionKey === key));
    const store = owner || u.allStores || u.stores.some((s) => s.storeId === storeId);
    if (!has || !store) throw new ForbiddenException('That person cannot do this at this till');
    return u;
  }

  /** Decision 40: a manager's PIN gives a single-use approval for one action at one till. */
  async approve(input: ApprovalInput, actor: Actor, user: CurrentUser) {
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    const manager = await this.userWithRight(input.managerId, 'pos.approve', till.storeId);
    await this.checkPin(manager.id, input.pin);
    // Audit 5: the cash difference, cash out or bill discount approved is kept and compared when the approval is used.
    const figure = { amount: input.amount ?? null, percent: input.percent ?? null };
    const token = await this.common.createApproval(this.prisma, till.id, manager.id, input.action, input.details ?? null, figure);
    await this.audit.record(this.prisma, { userId: manager.id, ipAddress: actor.ipAddress }, { action: 'update', entityType: 'pos_approval', entityId: till.id, changes: { action: input.action, details: input.details ?? null, till: till.code, requestedBy: user.id, ...(figure.amount ? { amount: figure.amount } : {}), ...(figure.percent ? { percent: figure.percent } : {}) } });
    return { token, manager: { id: manager.id, name: [manager.firstName, manager.lastName].filter(Boolean).join(' ') } };
  }

  /** Decision 68: the next cashier types their PIN; their bills record them. */
  async switchCashier(input: SwitchCashierInput, actor: Actor, user: CurrentUser) {
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    const cashier = await this.userWithRight(input.userId, 'pos.sell', till.storeId);
    await this.checkPin(cashier.id, input.pin);
    const token = await this.common.createCashierToken(this.prisma, till.id, cashier.id);
    await this.audit.record(this.prisma, { userId: cashier.id, ipAddress: actor.ipAddress }, { action: 'update', entityType: 'till_cashier', entityId: till.id, changes: { cashier: cashier.id, till: till.code } });
    return { token, cashier: { id: cashier.id, name: [cashier.firstName, cashier.lastName].filter(Boolean).join(' ') } };
  }

  /** People who may approve at a till (for the till's PIN pad). */
  async approvers(tillId: string, user: CurrentUser) {
    const till = await this.common.usableTill(this.prisma, tillId, user);
    const all = await this.prisma.user.findMany({ where: { active: true }, include: { roles: { include: { role: { include: { permissions: true } } } }, stores: true }, orderBy: { firstName: 'asc' } });
    const pins = new Set((await this.prisma.userPin.findMany({ select: { userId: true } })).map((p) => p.userId));
    const isOwner = (u: (typeof all)[number]) => u.roles.some((r) => r.role.active && r.role.code === SYSTEM_ROLES.OWNER_ADMIN);
    const can = (u: (typeof all)[number], key: PermissionKey) =>
      (isOwner(u) || u.roles.some((r) => r.role.active && r.role.permissions.some((p) => p.permissionKey === key))) && (isOwner(u) || u.allStores || u.stores.some((s) => s.storeId === till.storeId));
    const out = (key: PermissionKey) => all.filter((u) => pins.has(u.id) && can(u, key)).map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') }));
    return { managers: out('pos.approve'), cashiers: out('pos.sell') };
  }
}
