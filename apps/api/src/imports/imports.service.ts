// Copyright (c) 2026, Rademics. All rights reserved.
// Imports and exports (plan 10 §1.C–D; blueprint 17 process 1). A file is
// read and checked first (preview); nothing is saved until the user runs it.
// The run goes on in the background, one row at a time, and every row's
// outcome is kept so failed rows can be downloaded, fixed and imported again.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { type CurrentUser, type ExportKind, hasPermission, IMPORT_KINDS, type ImportKind, type ImportMode, type ImportOptions } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import type { ImportJob } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Importer, type ImportContext, matchColumns, parseRow, type ParsedRow } from './importers.js';
import { ImportKindsService } from './kinds.service.js';
import { type Cell, readSpreadsheet, writeCsv, writeXlsx } from './spreadsheet.js';

const MAX_ROWS = 20_000;
const BATCH = 500;

@Injectable()
export class ImportsService implements OnApplicationBootstrap {
  private readonly log = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly kinds: ImportKindsService,
  ) {}

  /** An import cut off by a server restart is marked as stopped; running it again skips the rows already done. */
  async onApplicationBootstrap() {
    await this.prisma.importJob.updateMany({ where: { status: 'running' }, data: { status: 'failed', message: 'The server restarted during the import; run the file again (rows already done are skipped)', finishedAt: new Date() } });
  }

  private importer(kind: string, user: CurrentUser): Importer {
    if (!(kind in IMPORT_KINDS)) throw new BadRequestException('Unknown kind of import');
    const i = this.kinds.get(kind as ImportKind);
    if (!hasPermission(user, i.importRight)) throw new ForbiddenException('You are not allowed to import this');
    for (const r of i.rights) if (!hasPermission(user, r)) throw new ForbiddenException('You are not allowed to create or change these records');
    return i;
  }

  /** The kind's columns as they are now (fixed for most kinds). */
  private async shape(i: Importer): Promise<{ fields: Importer['fields']; example: Importer['example'] }> {
    return i.columns ? i.columns() : { fields: i.fields, example: i.example };
  }

  async kindsFor(user: CurrentUser) {
    const allowed = (Object.keys(IMPORT_KINDS) as ImportKind[]).map((k) => this.kinds.get(k)).filter((i) => hasPermission(user, i.importRight) && i.rights.every((r) => hasPermission(user, r)));
    const out = [];
    for (const i of allowed) out.push({ kind: i.kind, label: IMPORT_KINDS[i.kind], fields: (await this.shape(i)).fields, exportable: !!i.exportRows });
    return out;
  }

  /** The template: headings, one example row, and text columns formatted as text (leading zeros kept). */
  async template(kind: string, user: CurrentUser): Promise<{ fileName: string; data: Buffer }> {
    const i = this.importer(kind, user);
    const { fields, example } = await this.shape(i);
    const headings = fields.map((f) => `${f.label}${f.required ? ' *' : ''}`);
    // A birthday column is text too, so a typed 15-08 is not turned into a date of this year.
    const textColumns = fields.flatMap((f, n) => (f.type === 'code' || f.type === 'daymonth' ? [n] : []));
    const notes = fields.map((f) => f.hint ?? (f.type === 'date' ? 'Date, e.g. 16/10/2026' : f.type === 'yesno' ? 'Yes or No' : f.type === 'number' ? 'Number' : null));
    const data = writeXlsx(IMPORT_KINDS[i.kind], [headings, example as Cell[], [], ['Notes (delete these rows before importing):'], ...fields.map((f, n) => [`${f.label}${f.required ? ' (required)' : ''}`, notes[n]])], {
      textColumns,
      widths: fields.map((f) => Math.max(14, f.label.length + 4)),
    });
    return { fileName: `${i.kind}-template.xlsx`, data };
  }

  /** Reads the file and checks every row; saves the job as "previewed". */
  async preview(fileName: string, buf: Buffer, options: ImportOptions, actor: Actor, user: CurrentUser) {
    const i = this.importer(options.kind, user);
    const { fields } = await this.shape(i);
    const company = await this.company.current();
    let sheet: Cell[][];
    try {
      sheet = readSpreadsheet(fileName, buf);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const headerAt = sheet.findIndex((r) => r.some((c) => c !== null && String(c).trim() !== ''));
    if (headerAt < 0) throw new BadRequestException('The file is empty');
    // Headings may carry the template's " *" for required columns.
    const headings = sheet[headerAt].map((h) => (h === null ? null : String(h).replace(/\s*\*\s*$/, '')));
    const { columns, unmatched } = matchColumns(headings, fields, options.mapping);
    // In change mode only the columns being changed (and the one that finds the record) are needed.
    const missing = options.mode === 'change' ? [] : fields.filter((f) => f.required && !columns.includes(f.key)).map((f) => f.label);
    const dataRows: { rowNumber: number; cells: Cell[] }[] = [];
    for (let r = headerAt + 1; r < sheet.length; r++) {
      const cells = sheet[r] ?? [];
      if (!cells.some((c) => c !== null && String(c).trim() !== '')) continue;
      // The template's notes block ends the data.
      if (String(cells[0] ?? '').startsWith('Notes (delete these rows')) break;
      dataRows.push({ rowNumber: r + 1, cells });
    }
    if (dataRows.length > MAX_ROWS) throw new BadRequestException(`The file has ${dataRows.length} rows; import at most ${MAX_ROWS} at a time`);
    const rowFields = options.mode === 'change' ? fields.map((f) => ({ ...f, required: false })) : fields;
    // A new look at a file replaces this person's earlier previews that were never run.
    await this.prisma.importJob.deleteMany({ where: { companyId: company.id, createdById: actor.userId, status: 'previewed' } });
    const parsed = dataRows.map((d) => ({ rowNumber: d.rowNumber, ...parseRow(d.cells, columns, rowFields), cells: d.cells }));
    const job = await this.prisma.$transaction(async (tx) => {
      const j = await tx.importJob.create({
        data: { companyId: company.id, kind: i.kind, mode: options.mode, fileName, status: 'previewed', // An ordered list: the database would reorder the keys of an object.
          mapping: headings.map((h, n) => ({ heading: h ?? `Column ${n + 1}`, field: columns[n] ?? '' })), totalRows: parsed.length, createdById: actor.userId },
      });
      for (let n = 0; n < parsed.length; n += BATCH) {
        await tx.importRow.createMany({
          data: parsed.slice(n, n + BATCH).map((p) => ({
            jobId: j.id,
            rowNumber: p.rowNumber,
            outcome: p.problems.length ? 'failed' : 'pending',
            recordKey: i.keyOf(p.values),
            message: p.problems.length ? p.problems.join('; ') : null,
            data: { values: p.values, cells: p.cells } as never,
          })),
        });
      }
      return j;
    }, { timeout: 120_000 });
    const problems = parsed.filter((p) => p.problems.length);
    return {
      jobId: job.id,
      kind: i.kind,
      mode: options.mode,
      fileName,
      columns: headings.map((h, n) => ({ heading: h, field: columns[n], label: fields.find((f) => f.key === columns[n])?.label ?? null })),
      unmatched,
      missingRequired: missing,
      rows: parsed.length,
      ready: parsed.length - problems.length,
      problems: problems.slice(0, 200).map((p) => ({ rowNumber: p.rowNumber, problems: p.problems })),
      fields,
    };
  }

  /** Starts the run in the background; the screen follows it with GET /imports/:id. */
  async run(jobId: string, actor: Actor, user: CurrentUser) {
    const job = await this.job(jobId);
    const i = this.importer(job.kind, user);
    if (job.status !== 'previewed') throw new BadRequestException(job.status === 'running' ? 'This import is already running' : 'This import has already been run; upload the file again');
    const mapped = (job.mapping as { heading: string; field: string }[]).map((m) => m.field);
    const missing = job.mode === 'change' ? [] : (await this.shape(i)).fields.filter((f) => f.required && !mapped.includes(f.key));
    if (missing.length) throw new BadRequestException(`Match these columns first: ${missing.map((f) => f.label).join(', ')}`);
    const claimed = await this.prisma.importJob.updateMany({ where: { id: jobId, status: 'previewed' }, data: { status: 'running', startedAt: new Date() } });
    if (!claimed.count) throw new BadRequestException('This import is already running');
    await this.audit.record(this.prisma, actor, { action: 'create', entityType: 'import', entityId: jobId, changes: { kind: job.kind, mode: job.mode, file: job.fileName, rows: job.totalRows } });
    const ctx: ImportContext = { user, actor, companyId: job.companyId, seen: new Map() };
    setImmediate(() => {
      this.process(job, i, ctx).catch(async (err) => {
        this.log.error(`Import ${jobId} stopped: ${err instanceof Error ? err.message : String(err)}`);
        await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'failed', message: err instanceof Error ? err.message : String(err), finishedAt: new Date() } });
      });
    });
    return this.status(jobId, user);
  }

  /** The run itself; exposed for the tests, which wait for it. */
  async process(job: ImportJob, i: Importer, ctx: ImportContext): Promise<void> {
    const counts = { added: 0, changed: 0, unchanged: 0, failed: 0 };
    counts.failed = await this.prisma.importRow.count({ where: { jobId: job.id, outcome: 'failed' } });
    const record = async (id: bigint, outcome: string, recordId: string | null | undefined, message: string | null | undefined) =>
      this.prisma.importRow.update({ where: { id }, data: { outcome, recordId: recordId ?? null, message: message ?? null } });
    let after = 0n;
    for (;;) {
      const rows = await this.prisma.importRow.findMany({ where: { jobId: job.id, outcome: 'pending', id: { gt: after } }, orderBy: { id: 'asc' }, take: BATCH });
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      if (job.kind === 'opening_stock') {
        const results = await this.kinds.openingCounts(rows.map((r) => ({ rowNumber: r.rowNumber, values: (r.data as { values: ParsedRow['values'] }).values })), ctx);
        for (const r of rows) {
          const res = results.get(r.rowNumber)!;
          if ('error' in res) {
            counts.failed++;
            await record(r.id, 'failed', null, res.error);
          } else {
            counts[res.outcome]++;
            await record(r.id, res.outcome, res.recordId, res.message);
          }
        }
      } else {
        for (const r of rows) {
          try {
            const res = await i.apply((r.data as { values: ParsedRow['values'] }).values, job.mode as ImportMode, ctx);
            counts[res.outcome]++;
            await record(r.id, res.outcome, res.recordId, res.outcome === 'unchanged' ? (res.message ?? 'Nothing to change') : res.message);
          } catch (err) {
            counts.failed++;
            // A Nest error carries the message (or the list of validation messages) in its response.
            const raw = err instanceof Error ? ((err as { response?: { message?: string | string[] } }).response?.message ?? err.message) : String(err);
            await record(r.id, 'failed', null, Array.isArray(raw) ? raw.join('; ') : raw);
          }
        }
      }
      await this.prisma.importJob.update({ where: { id: job.id }, data: counts });
    }
    const done = counts.added + counts.changed + counts.unchanged;
    await this.prisma.importJob.update({
      where: { id: job.id },
      data: { ...counts, status: counts.failed === 0 ? 'done' : done === 0 ? 'failed' : 'partly_done', finishedAt: new Date() },
    });
  }

  async status(jobId: string, user: CurrentUser) {
    const job = await this.job(jobId);
    this.importer(job.kind, user);
    const failed = await this.prisma.importRow.findMany({ where: { jobId, outcome: 'failed' }, orderBy: { rowNumber: 'asc' }, take: 200, select: { rowNumber: true, message: true } });
    const done = await this.prisma.importRow.count({ where: { jobId, outcome: { not: 'pending' } } });
    return { ...this.jobDto(job), done, failedRows: failed };
  }

  async list(user: CurrentUser) {
    const company = await this.company.current();
    const rows = await this.prisma.importJob.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.filter((r) => {
      try {
        this.importer(r.kind, user);
        return true;
      } catch {
        return false;
      }
    }).map((r) => this.jobDto(r));
  }

  /** The rows that failed, in the original columns plus "Problem", to fix and import again. */
  async failedRows(jobId: string, user: CurrentUser): Promise<{ fileName: string; data: Buffer }> {
    const job = await this.job(jobId);
    const i = this.importer(job.kind, user);
    const rows = await this.prisma.importRow.findMany({ where: { jobId, outcome: 'failed' }, orderBy: { rowNumber: 'asc' } });
    const mapping = job.mapping as { heading: string; field: string }[];
    const headings = mapping.map((m) => m.heading);
    const { fields } = await this.shape(i);
    const textColumns = mapping.flatMap((m, n) => (fields.find((f) => f.key === m.field)?.type === 'code' ? [n] : []));
    const data = writeXlsx('Failed rows', [[...headings, 'Problem'], ...rows.map((r) => [...headings.map((_, n) => ((r.data as { cells: Cell[] }).cells[n] ?? null) as Cell), r.message])], { textColumns });
    return { fileName: `${job.kind}-failed-rows.xlsx`, data };
  }

  /** "Export for Excel" (plan 10 §1.D): the same columns as the import template; logged. */
  async export(kind: ExportKind, format: 'xlsx' | 'csv', actor: Actor, user: CurrentUser): Promise<{ fileName: string; data: Buffer; contentType: string }> {
    if (!hasPermission(user, 'export.masters')) throw new ForbiddenException('You are not allowed to export lists');
    const i = this.kinds.get(kind as ImportKind);
    if (!i.exportRows) throw new BadRequestException('This list cannot be exported');
    const company = await this.company.current();
    const rows = await i.exportRows({ user, companyId: company.id });
    const headings = i.fields.map((f) => f.label);
    await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'list', entityId: null, changes: { report: IMPORT_KINDS[i.kind], format, rows: rows.length } });
    if (format === 'csv') return { fileName: `${kind}.csv`, data: Buffer.from(writeCsv([headings, ...rows]), 'utf8'), contentType: 'text/csv; charset=utf-8' };
    const textColumns = i.fields.flatMap((f, n) => (f.type === 'code' ? [n] : []));
    return { fileName: `${kind}.xlsx`, data: writeXlsx(IMPORT_KINDS[i.kind], [headings, ...rows], { textColumns }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  private async job(id: string): Promise<ImportJob> {
    const company = await this.company.current();
    const j = await this.prisma.importJob.findUnique({ where: { id } });
    if (!j || j.companyId !== company.id) throw new NotFoundException('Import not found');
    return j;
  }

  private jobDto(j: ImportJob) {
    return {
      id: j.id,
      kind: j.kind,
      kindLabel: IMPORT_KINDS[j.kind as ImportKind] ?? j.kind,
      mode: j.mode,
      fileName: j.fileName,
      status: j.status,
      totalRows: j.totalRows,
      added: j.added,
      changed: j.changed,
      unchanged: j.unchanged,
      failed: j.failed,
      message: j.message,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
    };
  }
}
