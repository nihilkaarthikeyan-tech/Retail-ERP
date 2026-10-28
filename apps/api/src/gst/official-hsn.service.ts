// Copyright (c) 2026, Rademics. All rights reserved.
// The official HSN / SAC list (owner, 28 October 2026): the same for every shop, loaded from the
// GST portal's file when the API starts and the file is new, then searched from the item screens.
import { readFile } from 'node:fs/promises';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { SystemPrisma } from '../prisma/prisma.service.js';
import { HSN_FILE, readOfficialHsnFile } from './official-hsn.js';

const VERSION_KEY = 'official-hsn';
const BATCH = 2000;
const MAX_RESULTS = 20;

export interface OfficialHsnDto {
  code: string;
  description: string;
  isService: boolean;
  /** For a 6- or 8-digit code, its 4-digit heading's description ("610610 OF COTTON" is read with "6106 WOMEN'S BLOUSES…"). */
  heading?: string | null;
}

@Injectable()
export class OfficialHsnService implements OnApplicationBootstrap {
  private readonly log = new Logger(OfficialHsnService.name);

  constructor(private readonly system: SystemPrisma) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.loadIfNew();
    } catch (err) {
      // The shops keep working without the list; the item screens then suggest only the shop's own codes.
      this.log.error(`Could not load the official HSN list: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Replaces the list when the file is not the one loaded last; returns how many codes were loaded (0 when already current). */
  async loadIfNew(): Promise<number> {
    const loaded = await this.system.referenceDataVersion.findUnique({ where: { key: VERSION_KEY } });
    if (loaded?.version === HSN_FILE) return 0;
    const rows = readOfficialHsnFile(await readFile(new URL(`../../data/gst/${HSN_FILE}`, import.meta.url)));
    await this.system.$transaction(
      async (tx) => {
        await tx.officialHsnCode.deleteMany({});
        for (let i = 0; i < rows.length; i += BATCH) await tx.officialHsnCode.createMany({ data: rows.slice(i, i + BATCH) });
        await tx.referenceDataVersion.upsert({ where: { key: VERSION_KEY }, create: { key: VERSION_KEY, version: HSN_FILE }, update: { version: HSN_FILE, loadedAt: new Date() } });
      },
      { timeout: 120_000 },
    );
    this.log.log(`Loaded ${rows.length} official HSN / SAC codes from ${HSN_FILE}`);
    return rows.length;
  }

  /** By code ("6106" finds 6106 and the codes under it) or by words in the description ("cotton saree"). */
  async search(text: string): Promise<OfficialHsnDto[]> {
    const q = text.trim();
    if (q.length < 2) return [];
    const select = { code: true, description: true, isService: true } as const;
    let rows: OfficialHsnDto[];
    if (/^\d+$/.test(q)) {
      rows = await this.system.officialHsnCode.findMany({ where: { code: { startsWith: q } }, select, take: 200 });
    } else {
      const words = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
      if (!words.length) return [];
      const where: Prisma.OfficialHsnCodeWhereInput = { AND: words.map((w) => ({ description: { contains: w, mode: 'insensitive' } })) };
      rows = await this.system.officialHsnCode.findMany({ where, select, take: 200 });
    }
    return this.withHeadings(sortByLevel(rows).slice(0, MAX_RESULTS));
  }

  private async withHeadings(rows: OfficialHsnDto[]): Promise<OfficialHsnDto[]> {
    const wanted = [...new Set(rows.filter((r) => r.code.length > 4).map((r) => r.code.slice(0, 4)))];
    const headings = await this.descriptions(wanted);
    return rows.map((r) => ({ ...r, heading: r.code.length > 4 ? (headings.get(r.code.slice(0, 4)) ?? null) : null }));
  }

  /** One code exactly, or null when it is not in the official list. */
  find(code: string): Promise<OfficialHsnDto | null> {
    return this.system.officialHsnCode.findUnique({ where: { code: code.trim() }, select: { code: true, description: true, isService: true } });
  }

  /** Descriptions of the given codes, for GST returns when the shop gave none. */
  async descriptions(codes: string[]): Promise<Map<string, string>> {
    if (!codes.length) return new Map();
    const rows = await this.system.officialHsnCode.findMany({ where: { code: { in: codes } }, select: { code: true, description: true } });
    return new Map(rows.map((r) => [r.code, r.description]));
  }
}

/** Shorter codes (the headings a shop usually uses) first, then in code order. */
function sortByLevel<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
}
