// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 15 (owner, 28 October 2026): checking a GSTIN with the GST network. A check never stops a
// shop from saving: when the network cannot be asked, the record is checked again later.
import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { gstinProblem, INDIA_TIME_ZONE, isStateCode } from 'shared';
import type { Actor } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { forEachShop } from '../../prisma/each-shop.js';
import { PrismaService, SystemPrisma } from '../../prisma/prisma.service.js';
import { FakeGstinProvider, GstinApiProvider, GstinCheckUnavailable, type GstinFacts, type GstinNetworkStatus, type GstinProvider } from './gstin-provider.js';
import { catchUpAtStart } from '../../common/nightly-catch-up.js';

type Db = Prisma.TransactionClient | PrismaService;

/** A fresh answer is reused for a day, so checking on the screen and then saving costs one credit. */
const REUSE_MS = 24 * 60 * 60 * 1000;
/** At most this many paid checks a day per shop (a guard against a runaway import or a loop). */
const DAILY_LIMIT = 300;
/** Audit 8: how long checks wait after the GST network was found down. */
const DOWN_PAUSE_MS = 2 * 60 * 1000;
/** At most this many records re-checked per shop per night. */
const NIGHTLY_LIMIT = 50;

export type GstinCheckStatus = GstinNetworkStatus | 'unavailable' | 'off';

export interface GstinCheckResult {
  gstin: string;
  status: GstinCheckStatus;
  facts: GstinFacts | null;
  checkedAt: string | null;
  /** What to tell the person, in plain words. */
  message: string;
}

const MESSAGES: Record<Exclude<GstinCheckStatus, 'cancelled' | 'unavailable'>, string> = {
  active: 'Active on the GST network.',
  suspended: 'This GSTIN is suspended on the GST portal. Check with the business before issuing a tax invoice to it.',
  inactive: 'This GSTIN is not active on the GST portal. Check with the business before issuing a tax invoice to it.',
  not_found: 'The GST network has no such GSTIN. Check the number.',
  off: 'GSTIN checks are switched off in Settings, GST.',
};

function messageFor(status: GstinCheckStatus, facts: GstinFacts | null, problem: string | null): string {
  if (status === 'cancelled') {
    const on = facts?.cancelledOn ? ` on ${new Date(`${facts.cancelledOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : '';
    return `This GSTIN was cancelled${on} on the GST portal. Check with the business before issuing a tax invoice to it.`;
  }
  if (status === 'unavailable') {
    return problem === 'not_configured' ? 'GSTIN checks are not set up on this system yet.' : 'Could not check with the GST network just now. It will be checked again later; you can save as usual.';
  }
  return MESSAGES[status];
}

function chooseProvider(): GstinProvider {
  return process.env.GSTIN_PROVIDER === 'fake' ? new FakeGstinProvider() : new GstinApiProvider(process.env.GSTINAPI_KEY);
}

@Injectable()
export class GstinCheckService implements OnApplicationBootstrap {
  private readonly log = new Logger(GstinCheckService.name);
  readonly provider: GstinProvider = chooseProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
  ) {}

  private async settings(db: Db = this.prisma): Promise<{ on: boolean; recheckDays: number }> {
    const s = await db.gstSettings.findFirst({ select: { gstinChecks: true, gstinRecheckDays: true } });
    return { on: s?.gstinChecks ?? true, recheckDays: s?.gstinRecheckDays ?? 90 };
  }

  /** Asks the GST network (or reuses an answer from the last day); never throws for a network problem. */
  async check(raw: string, actor: Actor, patient = false): Promise<GstinCheckResult> {
    const gstin = raw.trim().toUpperCase();
    const problem = gstinProblem(gstin, isStateCode);
    if (problem) throw new BadRequestException(problem);
    if (!(await this.settings()).on) return { gstin, status: 'off', facts: null, checkedAt: null, message: messageFor('off', null, null) };

    const since = new Date(Date.now() - REUSE_MS);
    const recent = await this.prisma.gstinCheck.findFirst({ where: { gstin, status: { not: 'unavailable' }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } });
    if (recent) return this.toResult(recent);

    const usedToday = await this.prisma.gstinCheck.count({ where: { status: { not: 'unavailable' }, createdAt: { gte: since } } });
    let row;
    // Audit 8: while the GST network was found down in the last 2 minutes, nobody waits on it again
    // (an import of thousands of customers would wait on each); the nightly re-check catches up.
    const down = !patient && (await this.prisma.gstinCheck.count({ where: { status: 'unavailable', problem: 'down', createdAt: { gte: new Date(Date.now() - DOWN_PAUSE_MS) } } })) > 0;
    if (usedToday >= DAILY_LIMIT || down) {
      row = await this.prisma.gstinCheck.create({ data: { gstin, provider: this.provider.name, status: 'unavailable', problem: down ? 'down' : 'busy', createdById: actor.userId } });
    } else {
      try {
        const facts = await this.provider.lookup(gstin, patient);
        row = await this.prisma.gstinCheck.create({ data: { gstin, provider: this.provider.name, status: facts.status, facts: facts as unknown as Prisma.InputJsonValue, createdById: actor.userId } });
      } catch (err) {
        if (!(err instanceof GstinCheckUnavailable)) throw err;
        if (err.reason !== 'not_configured') this.log.warn(`GSTIN check could not be made (${err.reason}): ${err.message}`);
        row = await this.prisma.gstinCheck.create({ data: { gstin, provider: this.provider.name, status: 'unavailable', problem: err.reason, createdById: actor.userId } });
      }
    }
    return this.toResult(row);
  }

  private toResult(row: { gstin: string; status: string; facts: Prisma.JsonValue; problem: string | null; createdAt: Date }): GstinCheckResult {
    const status = row.status as GstinCheckStatus;
    const facts = (row.facts as unknown as GstinFacts | null) ?? null;
    return { gstin: row.gstin, status, facts, checkedAt: status === 'unavailable' ? null : row.createdAt.toISOString(), message: messageFor(status, facts, row.problem) };
  }

  /**
   * Copies the latest answer about the GSTIN (within the re-check interval) onto the customer or
   * supplier; clears it when the GSTIN is removed or no answer is known yet.
   */
  async applyToParty(tx: Db, kind: 'customer' | 'supplier', id: string, gstin: string | null): Promise<void> {
    let data: Prisma.CustomerUpdateInput & Prisma.SupplierUpdateInput = { gstinStatus: null, gstinLegalName: null, gstinTradeName: null, gstinCancelledOn: null, gstinCheckedAt: null };
    if (gstin) {
      const { recheckDays } = await this.settings(tx);
      const latest = await tx.gstinCheck.findFirst({ where: { gstin, status: { not: 'unavailable' }, createdAt: { gte: new Date(Date.now() - recheckDays * 86_400_000) } }, orderBy: { createdAt: 'desc' } });
      if (latest) {
        const f = (latest.facts as unknown as GstinFacts | null) ?? null;
        data = { gstinStatus: latest.status, gstinLegalName: f?.legalName ?? null, gstinTradeName: f?.tradeName ?? null, gstinCancelledOn: f?.cancelledOn ? new Date(`${f.cancelledOn}T00:00:00Z`) : null, gstinCheckedAt: latest.createdAt };
      }
    }
    if (kind === 'customer') await tx.customer.update({ where: { id }, data });
    else await tx.supplier.update({ where: { id }, data });
  }

  /** Before saving a new or changed GSTIN: ask now, so the record shows the answer at once. */
  async checkBeforeSave(gstin: string | null | undefined, actor: Actor): Promise<void> {
    if (!gstin) return;
    try {
      await this.check(gstin, actor);
    } catch (err) {
      // A wrong GSTIN is refused by the form's own rules; here nothing may stop the save.
      this.log.warn(`GSTIN check before saving skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One shop: GSTINs never checked, or last checked longer ago than the interval, at most NIGHTLY_LIMIT. */
  async recheckShop(limit = NIGHTLY_LIMIT): Promise<number> {
    const { on, recheckDays } = await this.settings();
    if (!on) return 0;
    const due = { gstin: { not: null }, OR: [{ gstinCheckedAt: null }, { gstinCheckedAt: { lt: new Date(Date.now() - recheckDays * 86_400_000) } }] };
    const customers = await this.prisma.customer.findMany({ where: { ...due, isWalkIn: false }, select: { id: true, gstin: true }, orderBy: { gstinCheckedAt: { sort: 'asc', nulls: 'first' } }, take: limit });
    const suppliers = await this.prisma.supplier.findMany({ where: due, select: { id: true, gstin: true }, orderBy: { gstinCheckedAt: { sort: 'asc', nulls: 'first' } }, take: Math.max(0, limit - customers.length) });
    const system: Actor = { userId: null, ipAddress: null };
    let done = 0;
    for (const [kind, rows] of [
      ['customer', customers],
      ['supplier', suppliers],
    ] as const) {
      for (const r of rows) {
        const result = await this.check(r.gstin!, system, true).catch(() => null);
        if (!result || result.status === 'unavailable') continue;
        await this.applyToParty(this.prisma, kind, r.id, r.gstin);
        done++;
      }
    }
    return done;
  }

  onApplicationBootstrap(): void {
    catchUpAtStart(this.log, 'Nightly GSTIN re-check', () => this.nightly());
  }

  @Cron('15 3 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    if (process.env.GSTIN_RECHECK_SCHEDULE === 'off') return;
    await forEachShop(this.system, this.log, 'Nightly GSTIN re-check', async () => {
      const n = await this.recheckShop();
      if (n) this.log.log(`${n} GSTIN(s) re-checked`);
    });
  }
}
