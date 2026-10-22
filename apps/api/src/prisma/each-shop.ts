// Copyright (c) 2026, Rademics. All rights reserved.
import type { Logger } from '@nestjs/common';
import type { SystemPrisma } from './prisma.service.js';
import { runForCompany } from './tenancy.js';

/**
 * Plan 14: nightly jobs and start-up checks run shop by shop, each one seeing
 * only that shop's rows. A failure in one shop is logged and the next shop
 * still runs.
 */
export async function forEachShop(system: SystemPrisma, log: Logger, job: string, run: (companyId: string) => Promise<void>): Promise<void> {
  for (const company of await system.company.findMany({ where: { active: true }, select: { id: true }, orderBy: { createdAt: 'asc' } })) {
    try {
      await runForCompany(company.id, () => run(company.id));
    } catch (err) {
      log.error(`${job} failed for shop ${company.id}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
