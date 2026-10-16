// Copyright (c) 2026, Rademics. All rights reserved.
// Sends email through the mail account in the server's .env (plan 09 answer 1;
// rule 12: the password never goes in the database). MAIL_TRANSPORT=memory
// keeps messages in memory instead of sending them (tests and development).
import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

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

  async send(message: MailMessage): Promise<void> {
    if (message.to.length === 0) throw new Error('No one to send it to');
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
    });
    await this.transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: message.to, subject: message.subject, html: message.html, text: message.text });
    this.log.log(`Sent "${message.subject}" to ${message.to.length} recipient(s)`);
  }
}
