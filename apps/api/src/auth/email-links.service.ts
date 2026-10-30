// Copyright (c) 2026, Rademics. All rights reserved.
// "Forgot password?" and "Confirm your email" (owner, 26 October 2026). Each is
// a one-time link sent by email: only a hash of it is kept, it works once, and
// it expires (30 minutes to reset a password, 7 days to confirm an email).
// "Forgot password?" answers the same whether or not the email has an account,
// so the page cannot be used to find out who is signed up.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ConfirmEmailInput, ForgotPasswordInput, NewPasswordByLinkInput } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor, AuthUser } from '../common/request-context.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { enterCompany } from '../prisma/tenancy.js';
import { MailerService } from '../reports/mailer.service.js';
import { AuthService } from './auth.service.js';
import { hashPassword } from './password.js';
import { hashSessionToken, newSessionToken } from './session.js';

export type LinkPurpose = 'password_reset' | 'email_confirm';

const LIFETIME_MS: Record<LinkPurpose, number> = { password_reset: 30 * 60_000, email_confirm: 7 * 86_400_000 };
/** At most this many links of one kind per person per hour, so the form cannot flood an inbox. */
const PER_HOUR = 3;

const BAD_LINK = 'This link has expired or has already been used. Ask for a new one.';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The address people open the links on: the first allowed web address. */
export function siteUrl(): string {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');
}

/** A plain, branded email body: a greeting, a few lines and one button. */
function emailHtml(lines: string[], button?: { href: string; label: string }, after?: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0a0a0a;max-width:520px">
<p style="font-weight:600;font-size:16px">Retail ERP</p>
${lines.map((l) => `<p>${l}</p>`).join('\n')}
${button ? `<p><a href="${button.href}" style="display:inline-block;padding:11px 22px;border-radius:999px;background:#1f4ea3;color:#ffffff;text-decoration:none;font-weight:600">${button.label}</a></p><p style="font-size:13px;color:#5c6067">Or copy this address into your browser:<br>${button.href}</p>` : ''}
${after ? `<p style="font-size:13px;color:#5c6067">${after}</p>` : ''}
</div>`;
}

@Injectable()
export class EmailLinksService {
  private readonly log = new Logger(EmailLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly mailer: MailerService,
  ) {}

  /** A new link for a person (inside their shop); earlier unused links of the same kind stop working. */
  private async newLink(userId: string, purpose: LinkPurpose, ipAddress: string | null): Promise<string | null> {
    const now = new Date();
    const recent = await this.prisma.userToken.count({ where: { userId, purpose, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
    if (recent >= PER_HOUR) return null;
    const token = newSessionToken();
    await this.prisma.$transaction([
      this.prisma.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } }),
      this.prisma.userToken.create({ data: { userId, purpose, tokenHash: hashSessionToken(token), expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]), ipAddress } }),
    ]);
    return token;
  }

  /** The live link with this code, found across shops; the request then works inside that link's shop. */
  private async useLink(token: string, purpose: LinkPurpose) {
    const found = await this.system.userToken.findUnique({ where: { tokenHash: hashSessionToken(token) }, select: { id: true, companyId: true, purpose: true, usedAt: true, expiresAt: true, userId: true, company: { select: { active: true } } } });
    if (!found || found.purpose !== purpose || found.usedAt || found.expiresAt <= new Date() || !found.company.active) throw new BadRequestException(BAD_LINK);
    enterCompany(found.companyId);
    const user = await this.prisma.user.findUnique({ where: { id: found.userId } });
    if (!user || !user.active) throw new BadRequestException(BAD_LINK);
    return { linkId: found.id, user };
  }

  // ---- Forgot password ----

  /** Always answers the same; sends a link only to an active account in an active shop. */
  async forgotPassword(input: ForgotPasswordInput, ipAddress: string | null): Promise<void> {
    const found = await this.system.user.findUnique({ where: { email: input.email }, select: { id: true, companyId: true, active: true, firstName: true, emailVerifiedAt: true, lastLoginAt: true, company: { select: { active: true } } } });
    // Audit 1 #19 (owner, 28 October 2026): only to an email that was confirmed or whose account has
    // been used; someone added with an address that never did either asks the Owner for a new password.
    if (!found || !found.active || !found.company.active || (!found.emailVerifiedAt && !found.lastLoginAt)) {
      this.log.warn(`Password reset asked for an unknown or switched-off account from ${ipAddress ?? 'unknown address'}`);
      return;
    }
    enterCompany(found.companyId);
    const token = await this.newLink(found.id, 'password_reset', ipAddress);
    if (!token) {
      this.log.warn(`Password reset links limit reached for one account from ${ipAddress ?? 'unknown address'}`);
      return;
    }
    await this.audit.recordNow({ userId: null, ipAddress }, { action: 'password_reset_requested', entityType: 'user', entityId: found.id });
    const href = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(input.email, 'Choose a new password for Retail ERP', [`Hello ${escape(found.firstName)},`, 'Someone asked to reset the password of your Retail ERP account. If it was you, choose a new password with the button below. The link works once and stops working in 30 minutes.'], { href, label: 'Choose a new password' }, 'If you did not ask for this, you can ignore this email: your password stays as it is.', [`Hello ${found.firstName},`, 'Someone asked to reset the password of your Retail ERP account. If it was you, open this link within 30 minutes to choose a new password:', href, 'If you did not ask for this, ignore this email: your password stays as it is.']);
  }

  /** Sets the new password, ends every session of the account and says so by email. */
  async newPasswordByLink(input: NewPasswordByLinkInput, ipAddress: string | null): Promise<void> {
    const { linkId, user } = await this.useLink(input.token, 'password_reset');
    await this.auth.assertPasswordAllowed(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    const actor: Actor = { userId: user.id, ipAddress };
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // The link is spent first, so the same link sent twice cannot set two passwords.
      const spent = await tx.userToken.updateMany({ where: { id: linkId, usedAt: null }, data: { usedAt: now } });
      if (spent.count !== 1) throw new BadRequestException(BAD_LINK);
      await tx.user.update({
        where: { id: user.id },
        // The link proves the person reads this email, so it also counts as confirmed.
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: user.emailVerifiedAt ?? now, updatedById: user.id },
      });
      await this.audit.record(tx, actor, { action: 'password_reset', entityType: 'user', entityId: user.id });
      await this.auth.endAllSessions(tx, user.id, actor);
    });
    await this.send(user.email, 'Your Retail ERP password was changed', [`Hello ${escape(user.firstName)},`, 'The password of your Retail ERP account was just changed, and every device that was logged in has been logged out.'], undefined, 'If this was not you, use "Forgot password?" on the login page straight away and tell your shop owner.', [`Hello ${user.firstName},`, 'The password of your Retail ERP account was just changed, and every device that was logged in has been logged out.', 'If this was not you, use "Forgot password?" on the login page straight away and tell your shop owner.']);
  }

  // ---- Confirm email ----

  /** Sends the "confirm your email" link to a signed-in person who has not confirmed yet. */
  async sendConfirmation(user: { id: string; email: string; firstName: string }, ipAddress: string | null): Promise<boolean> {
    const token = await this.newLink(user.id, 'email_confirm', ipAddress);
    if (!token) return false;
    const href = `${siteUrl()}/confirm-email?token=${encodeURIComponent(token)}`;
    await this.send(user.email, 'Confirm your email for Retail ERP', [`Welcome to Retail ERP, ${escape(user.firstName)}.`, 'Please confirm this is your email address. It is how you get back into your account if you ever forget your password.'], { href, label: 'Confirm my email' }, 'The link works for 7 days. If you did not sign up for Retail ERP, you can ignore this email.', [`Welcome to Retail ERP, ${user.firstName}.`, 'Please confirm this is your email address by opening this link (it works for 7 days):', href, 'If you did not sign up for Retail ERP, ignore this email.']);
    return true;
  }

  /** "Send the link again" from the reminder bar. */
  async resendConfirmation(authUser: AuthUser, ipAddress: string | null): Promise<{ sent: boolean; alreadyConfirmed: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.id }, select: { id: true, email: true, firstName: true, emailVerifiedAt: true } });
    if (user.emailVerifiedAt) return { sent: false, alreadyConfirmed: true };
    return { sent: await this.sendConfirmation(user, ipAddress), alreadyConfirmed: false };
  }

  async confirmEmail(input: ConfirmEmailInput, ipAddress: string | null): Promise<void> {
    const { linkId, user } = await this.useLink(input.token, 'email_confirm');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const spent = await tx.userToken.updateMany({ where: { id: linkId, usedAt: null }, data: { usedAt: now } });
      if (spent.count !== 1) throw new BadRequestException(BAD_LINK);
      if (!user.emailVerifiedAt) await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
      await this.audit.record(tx, { userId: user.id, ipAddress }, { action: 'email_confirmed', entityType: 'user', entityId: user.id });
    });
  }

  // ---- Mail ----

  private async send(to: string, subject: string, htmlLines: string[], button: { href: string; label: string } | undefined, after: string | undefined, textLines: string[]) {
    if (!this.mailer.configured()) {
      this.log.warn(`No mail account is set up; "${subject}" was not sent`);
      return;
    }
    try {
      await this.mailer.send({ to: [to], subject, html: emailHtml(htmlLines, button, after), text: textLines.join('\n\n') }, 'account');
    } catch (err) {
      // The answer to the visitor stays the same; the problem is in the server log.
      this.log.error(`Could not send "${subject}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
