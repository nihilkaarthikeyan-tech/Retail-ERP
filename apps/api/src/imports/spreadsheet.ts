// Copyright (c) 2026, Rademics. All rights reserved.
// Reading and writing spreadsheets without a library (plan 10 answer 1). An
// .xlsx file is a zip of XML parts; Node's own zlib inflates and deflates the
// parts. Only what imports and templates need is supported: the first sheet,
// text, numbers and true/false; dates come through as spreadsheet numbers and
// are read by readDate. CSV files are read with the separator detected.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export type Cell = string | number | boolean | null;
export type Sheet = Cell[][];

// ---- Zip ----

/** An import file is a few megabytes; real Excel files unpack to well under this. */
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const TOO_BIG = 'The Excel file is too large to read. Split it into smaller files of a few thousand rows each.';

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: signature 0x06054b50, searched from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  // Code audit, 27 October 2026: a crafted file of a few kilobytes can unpack to gigabytes
  // ("zip bomb") and stop the server, so the unpacked size and the number of parts are capped.
  if (count > MAX_ZIP_ENTRIES) throw new Error(TOO_BIG);
  let total = 0;
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The Excel file is damaged');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(local + 26);
    const localExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compressed);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) {
      let data: Buffer;
      try {
        data = inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED_BYTES - total });
      } catch {
        throw new Error(TOO_BIG);
      }
      out.set(name, data);
    }
    else throw new Error('The Excel file uses a kind of compression that cannot be read');
    total += out.get(name)?.length ?? 0;
    if (total > MAX_UNZIPPED_BYTES) throw new Error(TOO_BIG);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** A zip of the given files (also used by the tests to build files shaped like Excel's own). */
export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // file names in UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---- XML ----

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    return String.fromCodePoint(e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function encodeXml(s: string): string {
  // Control characters other than tab and newlines are not allowed in XML.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** All the text inside <t> elements of a fragment (a shared string may be split into runs). */
function textOf(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? '');
  return out;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function columnName(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The first sheet of an .xlsx file (or the sheet of that name) as rows of cells. */
export function readXlsx(buf: Buffer, sheetName?: string): Sheet {
  const files = readZip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8');
  const shared: string[] = [];
  const sst = text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  // The first sheet named in the workbook, through its relationship.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const firstSheet = sheetName
    ? [...(workbook?.matchAll(/<sheet\b([^>]*)\/?>/g) ?? [])]
        .map((m) => m[1])
        .find((a) => decodeXml(a.match(/\bname="([^"]*)"/)?.[1] ?? '') === sheetName)
        ?.match(/\br:id="([^"]+)"/)
    : workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (sheetName && !firstSheet) throw new Error(`The Excel file has no sheet ${sheetName}`);
  if (firstSheet && rels) {
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((r) => r[1]).find((a) => a.includes(`Id="${firstSheet[1]}"`));
    const target = rel?.match(/Target="([^"]+)"/)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new Error('The Excel file has no sheet');
  const rows: Sheet = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rm[1] ?? rm[3] ?? '';
    const r = Number(attrs.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row: Cell[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = a.match(/\br="([A-Z]+\d+)"/)?.[1];
      const col = ref ? columnIndex(ref) : row.length;
      const type = a.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
      const body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (type === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = v !== undefined ? decodeXml(v) : '';
      else if (type === 'b') value = v === '1';
      else if (type === 'e') value = null;
      else value = v !== undefined && v !== '' ? Number(v) : null;
      row[col] = value;
    }
    rows[r] = Array.from(row, (c) => (c === undefined ? null : c));
  }
  return Array.from(rows, (r) => r ?? []);
}

/**
 * A one-sheet .xlsx. Columns listed in `textColumns` are formatted as text, so
 * barcodes, HSN codes and mobile numbers keep their leading zeros in Excel.
 */
export function writeXlsx(sheetName: string, rows: Sheet, opts: { textColumns?: number[]; widths?: number[] } = {}): Buffer {
  return writeXlsxBook([{ name: sheetName, rows, ...opts }]);
}

export interface BookSheet {
  name: string;
  rows: Sheet;
  textColumns?: number[];
  widths?: number[];
}

function sheetXml(sheet: BookSheet): string {
  const { rows } = sheet;
  const text = new Set(sheet.textColumns ?? []);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const colXml = Array.from({ length: cols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${sheet.widths?.[i] ?? 18}" customWidth="1"${text.has(i) ? ' style="1"' : ''}/>`).join('');
  const rowXml = rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          if (c === null || c === undefined || c === '') return text.has(i) ? `<c r="${columnName(i)}${r + 1}" s="1"/>` : '';
          const ref = `${columnName(i)}${r + 1}`;
          const style = r === 0 ? ' s="2"' : text.has(i) ? ' s="1"' : '';
          if (typeof c === 'number' && !text.has(i)) return `<c r="${ref}"${style}><v>${c}</v></c>`;
          if (typeof c === 'boolean') return `<c r="${ref}" t="b"${style}><v>${c ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${encodeXml(String(c))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const ns = 'http://schemas.openxmlformats.org';
  return `<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colXml}</cols><sheetData>${rowXml}</sheetData></worksheet>`;
}

/**
 * An .xlsx with one or more sheets (module 8: GSTR-1 has one sheet per
 * section). The first row of each sheet is the bold heading row.
 */
export function writeXlsxBook(sheets: BookSheet[]): Buffer {
  const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`, 'utf8');
  const ns = 'http://schemas.openxmlformats.org';
  // Excel sheet names: at most 31 characters, none of : \ / ? * [ ].
  const names = sheets.map((s) => s.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31));
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const sheetList = sheets.map((_, i) => `<sheet name="${encodeXml(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  return writeZip([
    {
      name: '[Content_Types].xml',
      data: xml(
        `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    { name: '_rels/.rels', data: xml(`<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    {
      name: 'xl/workbook.xml',
      data: xml(`<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheetList}</sheets></workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: xml(`<Relationships xmlns="${ns}/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    {
      // Style 1: text format "@" (keeps leading zeros); style 2: bold heading row.
      name: 'xl/styles.xml',
      data: xml(
        `<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
      ),
    },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(sheetXml(sh)) })),
  ]);
}

// ---- CSV ----

/** A CSV file as rows; the separator (comma, semicolon or tab) is found from the first line. */
export function readCsv(text: string): Sheet {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((s) => [s, (firstLine.match(new RegExp(s === '\t' ? '\t' : `\\${s}`, 'g')) ?? []).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
  const rows: Sheet = [];
  let row: Cell[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => (c === '' ? null : c)));
}

/** Reads an uploaded file by its name: .xlsx or .csv. */
export function readSpreadsheet(fileName: string, buf: Buffer): Sheet {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return readXlsx(buf);
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return readCsv(buf.toString('utf8'));
  if (lower.endsWith('.xls')) throw new Error('Old Excel files (.xls) cannot be read; in Excel choose File → Save As → Excel Workbook (.xlsx)');
  throw new Error('Upload an Excel file (.xlsx) or a CSV file');
}

/** A CSV file from rows (for exports when CSV is asked for). */
export function writeCsv(rows: Sheet): string {
  const esc = (c: Cell) => {
    if (c === null || c === undefined) return '';
    const s = typeof c === 'string' ? noFormula(c) : String(c);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
}

/** Code audit, 27 October 2026: text starting with = + - @ would run as a formula when the
 *  CSV is opened in Excel (a customer named "=HYPERLINK(...)"), so it gets a leading '.
 *  Plain numbers such as -120.50 are left alone. */
export function noFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}
