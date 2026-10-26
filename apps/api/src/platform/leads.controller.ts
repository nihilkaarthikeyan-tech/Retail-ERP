// Copyright (c) 2026, Rademics. All rights reserved.
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { type LeadInput, leadSchema, SHOP_TYPES, type ShopTypeKey } from 'shared';
import { Public } from '../auth/decorators.js';
import { clientIp } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { SystemPrisma } from '../prisma/prisma.service.js';
import { MailerService } from '../reports/mailer.service.js';

/** Where a new landing page message is emailed (owner, 26 October 2026); LEAD_ALERT_TO in .env changes it. */
export const DEFAULT_LEAD_ALERT_TO = 'editor.publicationmart@gmail.com';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Plan 14: the landing page's "Contact us / book a demo" form. Kept above the
 * shops (no shop sees it); Rademics reads it on the platform admin screen and
 * gets an email for each new one.
 */
@Controller('leads')
export class LeadsController {
  private readonly log = new Logger(LeadsController.name);

  constructor(
    private readonly system: SystemPrisma,
    private readonly mailer: MailerService,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  async create(@Body(new ZodValidationPipe(leadSchema)) input: LeadInput, @Req() req: Request): Promise<{ ok: true }> {
    // A form-filling robot fills in the hidden field: it is told "thank you" and nothing is kept.
    if (input.website) return { ok: true };
    const { website: _robotField, ...lead } = input;
    await this.system.lead.create({ data: { ...lead, ipAddress: clientIp(req) } });
    this.log.log(`New message from the landing page: ${lead.name}`);
    // The message is already saved; a mail problem never fails the visitor's form.
    void this.alert(lead).catch((err: unknown) => this.log.warn(`Could not email the new message: ${err instanceof Error ? err.message : String(err)}`));
    return { ok: true };
  }

  private async alert(lead: Omit<LeadInput, 'website'>) {
    if (!this.mailer.configured()) return;
    const to = (process.env.LEAD_ALERT_TO || DEFAULT_LEAD_ALERT_TO).split(',').map((s) => s.trim()).filter(Boolean);
    const kind = lead.shopType && lead.shopType in SHOP_TYPES ? SHOP_TYPES[lead.shopType as ShopTypeKey].label : null;
    const rows: [string, string | null | undefined][] = [
      ['Name', lead.name],
      ['Phone', lead.phone],
      ['Email', lead.email],
      ['Shop', lead.shopName],
      ['Kind of shop', kind],
      ['Message', lead.message],
    ];
    const shown = rows.filter((r): r is [string, string] => !!r[1]);
    await this.mailer.send({
      to,
      subject: `New Retail ERP enquiry: ${lead.name}${lead.shopName ? `, ${lead.shopName}` : ''}`,
      text: `Someone filled in the contact form on retailerp.52digit.com.\n\n${shown.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nSee all messages at https://retailerp.52digit.com/admin`,
      html: `<p>Someone filled in the contact form on retailerp.52digit.com.</p><table cellpadding="6" style="border-collapse:collapse">${shown.map(([k, v]) => `<tr><td style="color:#5c6067">${k}</td><td><strong>${escape(v).replace(/\n/g, '<br>')}</strong></td></tr>`).join('')}</table><p><a href="https://retailerp.52digit.com/admin">See all messages in the Retail ERP admin</a></p>`,
    });
  }
}
