// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyPassword } from '../auth/password.js';
import { hashSessionToken, isSessionLive, lockoutUntil, newSessionToken } from '../auth/session.js';
import { SystemPrisma } from '../prisma/prisma.service.js';

/** The Retail ERP admin's own cookie, separate from the shops' session cookie. */
export const PLATFORM_COOKIE = 'erp_admin';

/** Stricter than a shop's defaults: the admin sees every shop. */
export const PLATFORM_LIMITS = { idleMinutes: 30, maxHours: 8 };
const LOCKOUT = { attempts: 5, seconds: 15 * 60 };
const WRONG_LOGIN = 'Wrong email or password';

export interface PlatformAdminUser {
  id: string;
  email: string;
  name: string;
  sessionId: string;
}

/**
 * Plan 14: login of the people who run the Retail ERP service. Kept apart from
 * the shops: its own accounts, sessions and cookie, read only with the system client.
 */
@Injectable()
export class PlatformAuthService {
  private readonly log = new Logger(PlatformAuthService.name);

  constructor(private readonly system: SystemPrisma) {}

  async login(email: string, password: string, ipAddress: string | null): Promise<{ token: string; admin: Omit<PlatformAdminUser, 'sessionId'> }> {
    const now = new Date();
    const admin = await this.system.platformAdmin.findUnique({ where: { email } });
    if (!admin || !admin.active) {
      this.log.warn(`Retail ERP admin login refused for an unknown or inactive email from ${ipAddress ?? 'unknown address'}`);
      throw new UnauthorizedException(WRONG_LOGIN);
    }
    if (admin.lockedUntil && admin.lockedUntil > now) {
      throw new UnauthorizedException('Too many wrong passwords. Try again in 15 minutes.');
    }
    if (!(await verifyPassword(password, admin.passwordHash))) {
      const failed = admin.failedLoginCount + 1;
      const lockedUntil = lockoutUntil(failed, LOCKOUT.attempts, LOCKOUT.seconds, now);
      await this.system.platformAdmin.update({ where: { id: admin.id }, data: { failedLoginCount: lockedUntil ? 0 : failed, lockedUntil } });
      this.log.warn(`Wrong Retail ERP admin password for ${admin.email} from ${ipAddress ?? 'unknown address'}`);
      throw new UnauthorizedException(WRONG_LOGIN);
    }
    const token = newSessionToken();
    await this.system.$transaction([
      this.system.platformAdmin.update({ where: { id: admin.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } }),
      this.system.platformSession.create({
        data: { adminId: admin.id, tokenHash: hashSessionToken(token), ipAddress, createdAt: now, lastActiveAt: now, expiresAt: new Date(now.getTime() + PLATFORM_LIMITS.maxHours * 3_600_000) },
      }),
    ]);
    this.log.log(`Retail ERP admin ${admin.email} logged in from ${ipAddress ?? 'unknown address'}`);
    return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
  }

  async adminForToken(token: string): Promise<PlatformAdminUser | null> {
    const now = new Date();
    const session = await this.system.platformSession.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { admin: true } });
    if (!session || !session.admin.active || !isSessionLive(session, PLATFORM_LIMITS, now)) return null;
    if (now.getTime() - session.lastActiveAt.getTime() > 60_000) await this.system.platformSession.update({ where: { id: session.id }, data: { lastActiveAt: now } });
    return { id: session.admin.id, email: session.admin.email, name: session.admin.name, sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.system.platformSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
