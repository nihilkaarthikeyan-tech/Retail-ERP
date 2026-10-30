// Copyright (c) 2026, Rademics. All rights reserved.
// "Download all my data" (owner, 23 October 2026): the Owner takes a copy of
// every record of their own shop, one CSV file per table in one zip. The
// tables are the ones the database keeps per shop (row-level policy
// shop_only), so the file can only ever hold this shop's rows. Login secrets
// (password, PIN and token hashes, sessions) are left out.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { businessDate, type CurrentUser } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { csvRow, ZipFileWriter } from '../imports/spreadsheet.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Tables of login secrets only: never in the copy. */
export const SECRET_TABLES = new Set(['Session', 'PosCashierToken', 'UserPin', 'UserToken']);
/** Columns holding a password, PIN or token hash: left out of every table. */
export const isSecretColumn = (column: string) => /hash$/i.test(column);

const PAGE = 5000;
/** Audit 8: downloads being prepared at once on this server (each reads a whole shop). */
const MAX_AT_ONCE = 1;
let running = 0;

const README = (shop: string, at: string, files: { table: string; rows: number }[]) =>
  [
    `A copy of all the data of ${shop}, taken ${at}.`,
    '',
    'Each .csv file is one list of records and opens in Excel.',
    'Amounts and quantities are exact, as stored. Dates and times are in UTC (add 5:30 for Indian time).',
    'Passwords, PINs and login sessions are not included.',
    '',
    'Files and number of rows:',
    ...files.map((f) => `  ${f.table}.csv  ${f.rows}`),
    '',
  ].join('\r\n');

@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
  ) {}

  /**
   * The whole shop as a zip of CSV files, read in one consistent snapshot. Audit 8: written to a
   * temporary file as it is read (a large shop's data does not fit in memory), one download at a
   * time on the server; the caller sends the file and then calls done().
   */
  async exportAll(actor: Actor, user: CurrentUser): Promise<{ fileName: string; path: string; contentType: string; done: () => Promise<void> }> {
    if (!user.isOwnerAdmin) throw new ForbiddenException('Only the Owner can download all the data');
    const company = await this.company.current();
    if (running >= MAX_AT_ONCE) throw new HttpException('Another "Download all my data" is being prepared on the server. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    running++;
    const dir = await mkdtemp(join(tmpdir(), 'retail-erp-export-'));
    const path = join(dir, 'all-data.zip');
    const done = async () => {
      await rm(dir, { recursive: true, force: true });
    };
    try {
      const zip = await ZipFileWriter.create(path);
      let counts: { table: string; rows: number }[];
      try {
        counts = await this.prisma.$transaction(
          async (tx) => {
            const tables = await tx.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'shop_only' ORDER BY tablename`;
            const out: { table: string; rows: number }[] = [];
            for (const { tablename } of tables) {
              if (SECRET_TABLES.has(tablename)) continue;
              const cols = (
                await tx.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${tablename} ORDER BY ordinal_position`
              )
                .map((c) => c.column_name)
                .filter((c) => !isSecretColumn(c));
              const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
              // Every value as text, so numeric amounts keep every digit.
              const select = cols.map((c) => `${q(c)}::text AS ${q(c)}`).join(', ');
              // Audit 7: a fixed order (the primary key), so the file is the same each time.
              const key = (
                await tx.$queryRaw<{ c: string }[]>`SELECT a.attname AS c FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = format('public.%I', ${tablename}::text)::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`
              ).map((r) => r.c);
              const order = ` ORDER BY ${(key.length ? key : cols).map(q).join(', ')}`;
              // Audit 8: read through a cursor, a page at a time (OFFSET re-read every earlier page).
              await tx.$executeRawUnsafe(`DECLARE export_rows NO SCROLL CURSOR FOR SELECT ${select} FROM ${q(tablename)}${order}`);
              let rows = 0;
              await zip.add(`${tablename}.csv`, (async function* () {
                yield `\uFEFF${csvRow(cols)}`;
                for (;;) {
                  const page = await tx.$queryRawUnsafe<Record<string, string | null>[]>(`FETCH ${PAGE} FROM export_rows`);
                  rows += page.length;
                  if (page.length) yield page.map((r) => csvRow(cols.map((c) => r[c]))).join('');
                  if (page.length < PAGE) break;
                }
              })());
              await tx.$executeRawUnsafe('CLOSE export_rows');
              out.push({ table: tablename, rows });
            }
            return out;
          },
          { isolationLevel: 'RepeatableRead', timeout: 60 * 60_000, maxWait: 10_000 },
        );
        const at = new Date().toISOString();
        await zip.add('READ ME.txt', (async function* () {
          yield README(company.legalName, at, counts);
        })());
        await zip.finish();
      } catch (err) {
        await zip.abandon();
        throw err;
      }
      await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'company', entityId: company.id, changes: { report: 'All data', tables: counts.length, rows: counts.reduce((sum, c) => sum + c.rows, 0) } });
      const code = company.code.replace(/[^A-Za-z0-9-]/g, '');
      return { fileName: `RetailERP-${code}-all-data-${businessDate()}.zip`, path, contentType: 'application/zip', done };
    } catch (err) {
      await done();
      throw err;
    } finally {
      running--;
    }
  }
}
