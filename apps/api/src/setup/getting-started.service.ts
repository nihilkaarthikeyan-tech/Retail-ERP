// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §4: the getting-started checklist on the owner's dashboard. Each step
// ticks itself from what is really in the database; nothing is ticked by hand.
import { ForbiddenException, Injectable } from '@nestjs/common';
import { type CurrentUser, GETTING_STARTED_STEPS, type GettingStartedDto, type GettingStartedKey } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class GettingStartedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  private owner(user: CurrentUser) {
    if (!user.isOwnerAdmin) throw new ForbiddenException('Only the Owner sees the getting-started checklist');
  }

  async checklist(user: CurrentUser): Promise<GettingStartedDto> {
    this.owner(user);
    const company = await this.company.current();
    const companyId = company.id;
    const [tills, methods, items, stockIn, staff, logo, rates, registrations, bills] = await Promise.all([
      this.prisma.till.count({ where: { companyId, active: true } }),
      this.prisma.paymentMethod.count({ where: { companyId, active: true } }),
      this.prisma.item.count({ where: { active: true } }),
      this.prisma.stockLedgerEntry.count({ where: { companyId, kind: { in: ['in', 'set'] } } }),
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.company.count({ where: { id: companyId, logo: { not: null } } }),
      this.prisma.gstRate.count(),
      this.prisma.gstRegistration.count({ where: { companyId, active: true } }),
      this.prisma.posBill.count({ where: { companyId } }),
    ]);

    const state: Record<GettingStartedKey, { done: boolean; note: string | null }> = {
      tills: { done: tills > 0 && methods > 0, note: tills > 0 ? `${tills} ${tills === 1 ? 'till' : 'tills'}` : null },
      items: { done: items > 0, note: items > 0 ? `${items} ${items === 1 ? 'item' : 'items'}` : null },
      opening_stock: { done: stockIn > 0, note: null },
      staff: { done: staff > 1, note: staff > 1 ? `${staff - 1} ${staff === 2 ? 'person' : 'people'} besides you` : null },
      letterhead: { done: logo > 0, note: null },
      gst_rates:
        registrations === 0
          ? { done: true, note: 'Not registered for GST yet; nothing to do now' }
          : { done: rates > 0, note: rates > 0 ? `${rates} ${rates === 1 ? 'rate' : 'rates'}` : null },
      test_bill: { done: bills > 0, note: null },
      go_live: { done: !!company.goLiveDate, note: company.goLiveDate ? `Went live on ${company.goLiveDate.toISOString().slice(0, 10)}` : null },
    };

    const steps = GETTING_STARTED_STEPS.map((s) => ({ ...s, ...state[s.key] }));
    return { hidden: company.checklistHidden, steps, doneCount: steps.filter((s) => s.done).length, total: steps.length };
  }

  /** The owner hides the checklist (or brings it back); recorded in the history. */
  async setHidden(hidden: boolean, actor: Actor, user: CurrentUser): Promise<GettingStartedDto> {
    this.owner(user);
    const company = await this.company.current();
    if (company.checklistHidden !== hidden) {
      await this.prisma.$transaction(async (tx) => {
        await tx.company.update({ where: { id: company.id }, data: { checklistHidden: hidden, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'company', entityId: company.id, changes: { checklistHidden: { old: company.checklistHidden, new: hidden } } });
      });
    }
    return this.checklist(user);
  }

  /** Plan 12 §5: the security settings, read only (no screen changes them yet). */
  async securitySettings(user: CurrentUser) {
    this.owner(user);
    const s = await this.prisma.securitySettings.findFirstOrThrow();
    return {
      minPasswordLength: s.minPasswordLength,
      lockoutAttempts: s.lockoutAttempts,
      lockoutSeconds: s.lockoutSeconds,
      sessionIdleMinutes: s.sessionIdleMinutes,
      sessionMaxHours: s.sessionMaxHours,
      singleSessionPerUser: s.singleSessionPerUser,
      updatedAt: s.updatedAt,
    };
  }
}
