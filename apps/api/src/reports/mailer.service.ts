// Copyright (c) 2026, Rademics. All rights reserved.
// Sends email through the mail account in the server's .env (plan 09 answer 1;
// rule 12: the password never goes in the database). MAIL_TRANSPORT=memory
// keeps messages in memory instead of sending them (tests and development).
import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { businessDate } from 'shared';
import { SystemPrisma } from '../prisma/prisma.service.js';

/**
 * Audit 8: the mailbox allows about 100 messages a day (Hostinger), counted per recipient. Account
 * emails (password reset, confirm email, password changed) may use the whole allowance; everything
 * else (summary emails, test emails, alerts) stops short of it, so a password reset still goes out
 * late in the day. MAIL_DAILY_LIMIT sets the allowance.
 */
export type MailKind = 'account' | 'other';
const ACCOUNT_RESERVE = 25;
export const mailDailyLimit = () => Number(process.env.MAIL_DAILY_LIMIT ?? 95);

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
  /** Messages kept by the memory transport, newest last. */
  readonly outbox: MailMessage[] = [];

  constructor(private readonly system: SystemPrisma) {}

  private get memory() {
    return process.env.MAIL_TRANSPORT === 'memory';
  }

  /** Whether email can be sent at all. */
  configured(): boolean {
    return this.memory || !!process.env.SMTP_HOST;
  }

  describe(): string {
    if (this.memory) return 'Kept in memory (test mode)';
    return process.env.SMTP_HOST ? `${process.env.SMTP_HOST} as ${process.env.SMTP_USER ?? '(no user)'}` : 'Not set up';
  }

  async send(message: MailMessage, kind: MailKind = 'other'): Promise<void> {
    if (message.to.length === 0) throw new Error('No one to send it to');
    await this.count(message.to.length, kind);
    if (this.memory) {
      this.outbox.push(message);
      return;
    }
    if (!process.env.SMTP_HOST) throw new Error('No mail account is set up on the server (SMTP_HOST in .env)');
    this.transporter ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' } : undefined,
      // Audit 8: a mail server that does not answer gives up in seconds (the defaults were 2 and 10 minutes).
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    await this.transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: message.to, subject: message.subject, html: message.html, text: message.text });
    this.log.log(`Sent "${message.subject}" to ${message.to.length} recipient(s)`);
  }

  /** Counts the recipients against today's allowance (Indian date), or refuses when it is used up. */
  private async count(recipients: number, kind: MailKind): Promise<void> {
    const cap = kind === 'account' ? mailDailyLimit() : mailDailyLimit() - ACCOUNT_RESERVE;
    const day = new Date(`${businessDate()}T00:00:00Z`);
    const rows = await this.system.$queryRaw<{ sent: number }[]>`
      INSERT INTO "MailDay" ("day", "sent") VALUES (${day}::date, ${recipients})
      ON CONFLICT ("day") DO UPDATE SET "sent" = "MailDay"."sent" + EXCLUDED."sent" WHERE "MailDay"."sent" + EXCLUDED."sent" <= ${cap}
      RETURNING "sent"`;
    if (rows.length === 0 || (rows[0].sent > cap && rows[0].sent === recipients)) {
      throw new Error(kind === 'account' ? "Today's email allowance is used up; try again tomorrow" : "Today's email allowance is kept for password and sign-in emails; this email was not sent");
    }
  }
}
