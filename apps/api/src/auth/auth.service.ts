// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { type ChangePasswordInput, type CurrentUser, type LoginInput, type PermissionKey, SYSTEM_ROLES } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor, AuthUser } from '../common/request-context.js';
import type { Prisma, SecuritySettings } from '../generated/prisma/client.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { enterCompany } from '../prisma/tenancy.js';
import { hashPassword, passwordProblem, verifyPassword } from './password.js';
import { absoluteExpiry, hashSessionToken, isSessionLive, lockoutUntil, newSessionToken } from './session.js';

export const userAccessInclude = {
  roles: { include: { role: { include: { permissions: true } } } },
  stores: { include: { store: true } },
} satisfies Prisma.UserInclude;

export type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userAccessInclude }>;

const WRONG_LOGIN = 'Wrong email or password';
/** How often lastActiveAt is written back, to avoid a write on every request. */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export interface LoginMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  private readonly allowedOrigins: string[];
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly system: SystemPrisma,
  ) {
    this.allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  }

  isAllowedOrigin(origin: string): boolean {
    return this.allowedOrigins.includes(origin);
  }

  async securitySettings(db: Db = this.prisma): Promise<SecuritySettings> {
    const row = await db.securitySettings.findFirst();
    if (!row) throw new Error("The shop's security settings are missing");
    return row;
  }

  // ---- Login and sessions ----

  async login(input: LoginInput, meta: LoginMeta): Promise<{ token: string; user: CurrentUser }> {
    const now = new Date();
    const actor: Actor = { userId: null, ipAddress: meta.ipAddress };
    // Plan 14: which shop the email belongs to is looked up across all shops; the rest of
    // the login then works for that shop only.
    const found = await this.system.user.findUnique({ where: { email: input.email }, select: { id: true, companyId: true, company: { select: { active: true } } } });
    if (!found) {
      // No shop to keep the history in: written to the server log instead.
      this.log.warn(`Login with an unknown email from ${meta.ipAddress ?? 'unknown address'}`);
      throw new UnauthorizedException(WRONG_LOGIN);
    }
    enterCompany(found.companyId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: found.id }, include: userAccessInclude });

    if (!user.active || !found.company.active) {
      await this.audit.recordNow(actor, {
        action: 'login_failed',
        entityType: 'user',
        entityId: user.id,
        changes: { email: input.email, reason: user.active ? 'shop_switched_off' : 'inactive' },
      });
      throw new UnauthorizedException(user.active ? 'This shop is switched off. Contact Retail ERP support.' : WRONG_LOGIN);
    }
    actor.userId = user.id;

    if (user.lockedUntil && user.lockedUntil > now) {
      // Audit 1 (28 October 2026): a stranger typing wrong passwords must not keep the real person out
      // all day. The lock stops everyone except a connection this person logged in from in the last 90 days.
      const known = actor.ipAddress
        ? await this.prisma.auditLog.count({ where: { action: 'login', entityType: 'user', entityId: user.id, ipAddress: actor.ipAddress, at: { gt: new Date(now.getTime() - 90 * 86_400_000) } } })
        : 0;
      if (!known) {
        await this.audit.recordNow(actor, { action: 'login_locked', entityType: 'user', entityId: user.id });
        throw new UnauthorizedException('Account is locked after too many failed attempts. Try again later.');
      }
    }

    const settings = await this.securitySettings();
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      // Counted in the database itself (code audit, 27 October 2026): guesses sent all at
      // once must not each read "no failures yet" and so never reach the lock.
      const { failedLoginCount } = await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
      const lockedUntil = lockoutUntil(failedLoginCount, settings.lockoutAttempts, settings.lockoutSeconds, now);
      if (lockedUntil) await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil } });
      await this.audit.recordNow(actor, {
        action: 'login_failed',
        entityType: 'user',
        entityId: user.id,
        changes: { reason: 'wrong_password', failedLoginCount, lockedUntil: lockedUntil?.toISOString() ?? null },
      });
      throw new UnauthorizedException(WRONG_LOGIN);
    }

    return this.openSession(user, meta, actor, settings, now);
  }

  /** A new session for a person whose password is checked (login) or just chosen (sign-up). */
  async openSession(user: UserWithAccess, meta: LoginMeta, actor: Actor, settings: SecuritySettings, now = new Date()): Promise<{ token: string; user: CurrentUser }> {
    const token = newSessionToken();
    await this.prisma.$transaction(async (tx) => {
      if (settings.singleSessionPerUser) {
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      }
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
          createdAt: now,
          lastActiveAt: now,
          expiresAt: absoluteExpiry(now, { idleMinutes: settings.sessionIdleMinutes, maxHours: settings.sessionMaxHours }),
        },
      });
      await this.audit.record(tx, actor, { action: 'login', entityType: 'user', entityId: user.id });
    });
    return { token, user: this.toCurrentUser(user) };
  }

  async userForSessionToken(token: string): Promise<AuthUser | null> {
    const now = new Date();
    // Plan 14: the session says which shop the request works for (looked up across all shops).
    const found = await this.system.session.findUnique({ where: { tokenHash: hashSessionToken(token) }, select: { id: true, companyId: true, company: { select: { active: true } } } });
    if (!found || !found.company.active) return null;
    enterCompany(found.companyId);
    const session = await this.prisma.session.findUnique({ where: { id: found.id }, include: { user: { include: userAccessInclude } } });
    if (!session || !session.user.active) return null;

    const settings = await this.securitySettings();
    const limits = { idleMinutes: settings.sessionIdleMinutes, maxHours: settings.sessionMaxHours };
    if (!isSessionLive(session, limits, now)) return null;

    if (now.getTime() - session.lastActiveAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: now } });
    }
    return { ...this.toCurrentUser(session.user), sessionId: session.id, companyId: session.companyId };
  }

  async logout(user: AuthUser, actor: Actor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({ where: { id: user.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, actor, { action: 'logout', entityType: 'user', entityId: user.id });
    });
  }

  async listSessions(userId: string) {
    const settings = await this.securitySettings();
    const limits = { idleMinutes: settings.sessionIdleMinutes, maxHours: settings.sessionMaxHours };
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return sessions
      .filter((s) => isSessionLive(s, limits, now))
      .map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
      }));
  }

  /** Ends one of the caller's own sessions. */
  async endOwnSession(user: AuthUser, sessionId: string, actor: Actor): Promise<void> {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId: user.id, revokedAt: null } });
    if (!session) throw new NotFoundException('Session not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, actor, {
        action: 'sessions_ended',
        entityType: 'user',
        entityId: user.id,
        changes: { sessionId },
      });
    });
  }

  /** Ends every live session of a user (deactivation, password reset, admin action). */
  async endAllSessions(db: Db, userId: string, actor: Actor, exceptSessionId?: string): Promise<number> {
    const result = await db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await this.audit.record(db, actor, {
        action: 'sessions_ended',
        entityType: 'user',
        entityId: userId,
        changes: { count: result.count },
      });
    }
    return result.count;
  }

  // ---- Passwords ----

  async changePassword(user: AuthUser, input: ChangePasswordInput, actor: Actor): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(input.currentPassword, row.passwordHash))) {
      throw new UnauthorizedException('Current password is wrong');
    }
    await this.assertPasswordAllowed(input.newPassword);
    if (input.newPassword === input.currentPassword) {
      throw new BadRequestException('New password must differ from the current one');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), updatedById: user.id },
      });
      await this.audit.record(tx, actor, { action: 'password_change', entityType: 'user', entityId: user.id });
      // A password change ends every other session of this user, and (audit 1, 28 October 2026) any
      // "forgot password" link still open, so an old emailed link cannot change it back.
      await this.endAllSessions(tx, user.id, actor, user.sessionId);
      await tx.userToken.updateMany({ where: { userId: user.id, purpose: 'password_reset', usedAt: null }, data: { usedAt: new Date() } });
    });
  }

  async assertPasswordAllowed(password: string, db: Db = this.prisma): Promise<void> {
    const settings = await this.securitySettings(db);
    const problem = passwordProblem(password, settings.minPasswordLength);
    if (problem) throw new BadRequestException(problem);
  }

  // ---- Mapping ----

  toCurrentUser(user: UserWithAccess): CurrentUser {
    const activeRoles = user.roles.map((ur) => ur.role).filter((r) => r.active);
    const permissions = new Set<PermissionKey>();
    for (const role of activeRoles) {
      for (const p of role.permissions) permissions.add(p.permissionKey as PermissionKey);
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      isOwnerAdmin: activeRoles.some((r) => r.code === SYSTEM_ROLES.OWNER_ADMIN),
      permissions: [...permissions].sort(),
      allStores: user.allStores,
      stores: user.stores
        .filter((us) => us.store.active)
        .map((us) => ({ id: us.store.id, code: us.store.code, name: us.store.name, isDefault: us.isDefault })),
      mustChangePassword: user.mustChangePassword,
      emailConfirmed: !!user.emailVerifiedAt,
      roles: activeRoles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    };
  }
}
