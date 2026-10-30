// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 8 (growth): expired sign-ins and used or expired email links are kept for a while (for the
// history of who was logged in), then deleted every night, so the tables do not grow for ever.
// Every shop's rows at once (system connection); safe to run twice.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { INDIA_TIME_ZONE } from 'shared';
import { SystemPrisma } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
/** Sign-ins are kept this long after they end; email links this long after they were made. */
export const KEEP_SESSIONS_DAYS = 90;
export const KEEP_LINKS_DAYS = 30;

@Injectable()
export class CleanupService {
  private readonly log = new Logger(CleanupService.name);

  constructor(private readonly system: SystemPrisma) {}

  @Cron('40 3 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    try {
      const removed = await this.run();
      this.log.log(`Removed ${removed.sessions} old sign-ins, ${removed.links} old email links, ${removed.platform} old platform sign-ins`);
    } catch (err) {
      this.log.error(`Clean-up failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async run(now = new Date()) {
    const ended = new Date(now.getTime() - KEEP_SESSIONS_DAYS * DAY_MS);
    const made = new Date(now.getTime() - KEEP_LINKS_DAYS * DAY_MS);
    const over = { OR: [{ expiresAt: { lt: ended } }, { revokedAt: { lt: ended } }] };
    const sessions = await this.system.session.deleteMany({ where: over });
    const platform = await this.system.platformSession.deleteMany({ where: over });
    const links = await this.system.userToken.deleteMany({ where: { createdAt: { lt: made }, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] } });
    return { sessions: sessions.count, links: links.count, platform: platform.count };
  }
}
