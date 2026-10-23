// Copyright (c) 2026, Rademics. All rights reserved.
// "Download all my data" (owner, 23 October 2026): the Owner takes a copy of
// every record of their own shop, one CSV file per table in one zip. The
// tables are the ones the database keeps per shop (row-level policy
// shop_only), so the file can only ever hold this shop's rows. Login secrets
// (password, PIN and token hashes, sessions) are left out.
import { ForbiddenException, Injectable } from '@nestjs/common';
import { businessDate, type CurrentUser } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { type Cell, writeCsv, writeZip } from '../imports/spreadsheet.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Tables of login secrets only: never in the copy. */
export const SECRET_TABLES = new Set(['Session', 'PosCashierToken', 'UserPin']);
/** Columns holding a password, PIN or token hash: left out of every table. */
export const isSecretColumn = (column: string) => /hash$/i.test(column);

const PAGE = 5000;

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

  /** The whole shop as a zip of CSV files, read in one consistent snapshot. */
  async exportAll(actor: Actor, user: CurrentUser): Promise<{ fileName: string; data: Buffer; contentType: string }> {
    if (!user.isOwnerAdmin) throw new ForbiddenException('Only the Owner can download all the data');
    const company = await this.company.current();
    const files = await this.prisma.$transaction(
      async (tx) => {
        const tables = await tx.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'shop_only' ORDER BY tablename`;
        const out: { table: string; sheet: Cell[][] }[] = [];
        for (const { tablename } of tables) {
          if (SECRET_TABLES.has(tablename)) continue;
          const cols = (
            await tx.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${tablename} ORDER BY ordinal_position`
          )
            .map((c) => c.column_name)
            .filter((c) => !isSecretColumn(c));
          const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
          // Every value as text, so numeric amounts keep every digit.
          const select = cols.map((c) => `${q(c)}::text AS ${q(c)}`).join(', ');
          const order = cols.includes('id') ? ' ORDER BY "id"' : '';
          const sheet: Cell[][] = [cols];
          for (let offset = 0; ; offset += PAGE) {
            const rows = await tx.$queryRawUnsafe<Record<string, string | null>[]>(`SELECT ${select} FROM ${q(tablename)}${order} LIMIT ${PAGE} OFFSET ${offset}`);
            for (const r of rows) sheet.push(cols.map((c) => r[c]));
            if (rows.length < PAGE) break;
          }
          out.push({ table: tablename, sheet });
        }
        return out;
      },
      { isolationLevel: 'RepeatableRead', timeout: 300_000, maxWait: 10_000 },
    );
    const at = new Date().toISOString();
    const counts = files.map((f) => ({ table: f.table, rows: f.sheet.length - 1 }));
    const data = writeZip([
      { name: 'READ ME.txt', data: Buffer.from(README(company.legalName, at, counts), 'utf8') },
      ...files.map((f) => ({ name: `${f.table}.csv`, data: Buffer.from(writeCsv(f.sheet), 'utf8') })),
    ]);
    await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'company', entityId: company.id, changes: { report: 'All data', tables: files.length, rows: counts.reduce((s, c) => s + c.rows, 0) } });
    const code = company.code.replace(/[^A-Za-z0-9-]/g, '');
    return { fileName: `RetailERP-${code}-all-data-${businessDate()}.zip`, data, contentType: 'application/zip' };
  }
}
