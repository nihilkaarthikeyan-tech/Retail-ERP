// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 part 2 §4: export the books to Tally (TallyPrime's XML import format).
// Export only: nothing here writes to the ledger. One Tally voucher per ledger
// entry; each account goes to the Tally ledger named in the ledger-name map
// (our account name when not mapped); customer and supplier lines go to the
// party's own name. The same period always gives the same bytes: stable order,
// no timestamps inside the file.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { type CurrentUser, Decimal, hasPermission, type TallyExportQuery, type TallyLedgerMapInput, type TallyVoucherType } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Account, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

const ZERO = new Decimal(0);

/** Entries that are not exported: Tally carries balances forward itself, and opening balances belong on its ledgers. */
const NOT_EXPORTED = ['year_end_closing'];

/**
 * Tally's own groups for our chart folders (nearest folder wins), for the ledger list.
 * Keys are our standard accounts' system keys (apps/api/src/ledger/chart-template.ts).
 */
const TALLY_GROUPS: Record<string, string> = {
  cash_group: 'Cash-in-Hand',
  bank_group: 'Bank Accounts',
  customer_receivable: 'Sundry Debtors',
  supplier_payable: 'Sundry Creditors',
  stock: 'Stock-in-Hand',
  goods_in_transit: 'Stock-in-Hand',
  tax_receivable: 'Duties & Taxes',
  duties_taxes: 'Duties & Taxes',
  advances_deposits: 'Loans & Advances (Asset)',
  fixed_assets: 'Fixed Assets',
  investments: 'Investments',
  temporary_opening: 'Suspense A/c',
  loans_overdraft: 'Loans (Liability)',
  current_assets: 'Current Assets',
  current_liabilities: 'Current Liabilities',
  capital_reserves: 'Capital Account',
  direct_income: 'Sales Accounts',
  indirect_income: 'Indirect Incomes',
  direct_expenses: 'Direct Expenses',
  indirect_expenses: 'Indirect Expenses',
};
const FAMILY_GROUPS: Record<string, string> = {
  asset: 'Current Assets',
  liability: 'Current Liabilities',
  equity: 'Capital Account',
  income: 'Indirect Incomes',
  expense: 'Indirect Expenses',
};

/** Where our document numbers live for postings that do not carry one (stock postings). */
const NUMBER_TABLES = ['stock_document', 'goods_receipt', 'landed_charge', 'pos_bill', 'supplier_bill'] as const;

/** Text for XML: the five special characters escaped, and anything outside plain ASCII as a character reference. */
export function xmlText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&apos;';
    else if (c < 0x20) out += c === 0x0a || c === 0x09 ? ch : ' ';
    else if (c > 0x7e) out += `&#${c};`;
    else out += ch;
  }
  return out;
}

export interface TallyLine {
  ledger: string;
  /** Debit minus credit. */
  amount: Decimal;
}

export interface TallyVoucher {
  id: string;
  type: TallyVoucherType | 'Debit Note';
  date: string;
  number: string;
  narration: string;
  lines: TallyLine[];
}

/** One voucher in Tally's import format. Tally reads debits as negative amounts with ISDEEMEDPOSITIVE Yes. */
export function voucherXml(v: TallyVoucher): string {
  const lines = v.lines
    .map((l) => {
      const debit = l.amount.gt(0);
      // Debits are negative in Tally's import; credits positive.
      const amount = l.amount.neg().toFixed(2);
      return [
        '      <ALLLEDGERENTRIES.LIST>',
        `       <LEDGERNAME>${xmlText(l.ledger)}</LEDGERNAME>`,
        `       <ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
        `       <AMOUNT>${amount}</AMOUNT>`,
        '      </ALLLEDGERENTRIES.LIST>',
      ].join('\r\n');
    })
    .join('\r\n');
  return [
    `     <VOUCHER REMOTEID="${xmlText(v.id)}" VCHTYPE="${xmlText(v.type)}" ACTION="Create">`,
    `      <DATE>${v.date.replaceAll('-', '')}</DATE>`,
    `      <VOUCHERTYPENAME>${xmlText(v.type)}</VOUCHERTYPENAME>`,
    `      <VOUCHERNUMBER>${xmlText(v.number)}</VOUCHERNUMBER>`,
    `      <NARRATION>${xmlText(v.narration)}</NARRATION>`,
    lines,
    '     </VOUCHER>',
  ].join('\r\n');
}

/** The import envelope around TALLYMESSAGE blocks. */
export function envelope(reportName: 'Vouchers' | 'All Masters', company: string, messages: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    ' <HEADER>',
    '  <TALLYREQUEST>Import Data</TALLYREQUEST>',
    ' </HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    '   <REQUESTDESC>',
    `    <REPORTNAME>${reportName}</REPORTNAME>`,
    '    <STATICVARIABLES>',
    `     <SVCURRENTCOMPANY>${xmlText(company)}</SVCURRENTCOMPANY>`,
    '    </STATICVARIABLES>',
    '   </REQUESTDESC>',
    '   <REQUESTDATA>',
    ...messages.map((m) => ['    <TALLYMESSAGE xmlns:UDF="TallyUDF">', m, '    </TALLYMESSAGE>'].join('\r\n')),
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\r\n');
}

/** Lines netted per Tally ledger, in the order each ledger first appears; refuses a voucher that does not balance. */
export function nettedLines(raw: { ledger: string; debit: Decimal; credit: Decimal }[], label: string): TallyLine[] {
  const net = new Map<string, Decimal>();
  for (const l of raw) net.set(l.ledger, (net.get(l.ledger) ?? ZERO).add(l.debit).sub(l.credit));
  const lines = [...net].filter(([, a]) => !a.isZero()).map(([ledger, amount]) => ({ ledger, amount }));
  const total = lines.reduce((s, l) => s.add(l.amount), ZERO);
  if (!total.isZero()) throw new BadRequestException(`${label} does not balance (debits and credits differ by ₹${total.abs().toFixed(2)}), so nothing was exported. Please check this entry in the day book.`);
  return lines;
}

@Injectable()
export class TallyExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: AccountingCommon,
  ) {}

  // ---- The ledger-name map ----

  /** Every account (not folders) with its Tally ledger name and Tally group. */
  async ledgerMap(user: CurrentUser) {
    this.mayExport(user, 'see');
    const company = await this.common.ready();
    const accounts = await this.prisma.account.findMany({ where: { companyId: company.id }, orderBy: [{ number: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
    const maps = new Map((await this.prisma.tallyLedgerMap.findMany({ where: { companyId: company.id } })).map((m) => [m.accountId, m.tallyLedger]));
    const groupOf = this.groupFinder(accounts);
    return {
      rows: accounts
        .filter((a) => !a.isGroup)
        .map((a) => ({
          accountId: a.id,
          number: a.number,
          name: a.name,
          kind: a.kind,
          active: a.active,
          tallyGroup: groupOf(a),
          tallyLedger: maps.get(a.id) ?? a.name,
          mapped: maps.has(a.id),
        })),
    };
  }

  /** Saves Tally ledger names. Blank, or the same as our account name, goes back to our account name. */
  async saveMap(input: TallyLedgerMapInput, actor: Actor, user: CurrentUser) {
    this.mayExport(user, 'change');
    const company = await this.common.ready();
    const ids = [...new Set(input.rows.map((r) => r.accountId))];
    if (ids.length !== input.rows.length) throw new BadRequestException('Each account can appear only once');
    await this.prisma.$transaction(async (tx) => {
      const accounts = new Map((await tx.account.findMany({ where: { id: { in: ids }, companyId: company.id } })).map((a) => [a.id, a]));
      const existing = new Map((await tx.tallyLedgerMap.findMany({ where: { accountId: { in: ids } } })).map((m) => [m.accountId, m]));
      for (const r of input.rows) {
        const a = accounts.get(r.accountId);
        if (!a) throw new BadRequestException('Account not found');
        if (a.isGroup) throw new BadRequestException(`${a.name} is a folder; only accounts go to Tally ledgers`);
        const wanted = r.tallyLedger?.trim() || null;
        const value = wanted && wanted !== a.name ? wanted : null;
        const before = existing.get(a.id)?.tallyLedger ?? null;
        if (before === value) continue;
        if (value === null) await tx.tallyLedgerMap.delete({ where: { accountId: a.id } });
        else if (before === null) await tx.tallyLedgerMap.create({ data: { companyId: company.id, accountId: a.id, tallyLedger: value, createdById: actor.userId, updatedById: actor.userId } });
        else await tx.tallyLedgerMap.update({ where: { accountId: a.id }, data: { tallyLedger: value, updatedById: actor.userId } });
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'tally_ledger_map',
          entityId: a.id,
          changes: { account: a.name, tallyLedger: { old: before ?? a.name, new: value ?? a.name } },
        });
      }
    });
    return this.ledgerMap(user);
  }

  // ---- Vouchers ----

  /** The vouchers of a period (and optionally one store), as Tally will receive them. */
  async vouchers(q: TallyExportQuery, user: CurrentUser): Promise<{ company: string; vouchers: TallyVoucher[]; storeCode: string | null }> {
    this.mayExport(user, 'export');
    if (q.from > q.to) throw new BadRequestException('The start date is after the end date');
    if (q.storeId) this.common.assertStore(user, q.storeId);
    const company = await this.common.ready();
    const allowed = this.common.storeFilter(user);
    const where: Prisma.LedgerEntryWhereInput = {
      companyId: company.id,
      entryDate: { gte: fromIso(q.from), lte: fromIso(q.to) },
      isOpening: false,
      documentType: { notIn: NOT_EXPORTED },
      ...(q.storeId ? { storeId: q.storeId } : allowed ? { storeId: { in: allowed } } : {}),
    };
    const entries = await this.prisma.ledgerEntry.findMany({ where, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    const store = q.storeId ? await this.prisma.store.findUnique({ where: { id: q.storeId }, select: { code: true } }) : null;

    // Ledger names: the map, else our account name; parties under their own names.
    const accounts = new Map((await this.prisma.account.findMany({ where: { companyId: company.id } })).map((a) => [a.id, a]));
    const maps = new Map((await this.prisma.tallyLedgerMap.findMany({ where: { companyId: company.id } })).map((m) => [m.accountId, m.tallyLedger]));
    const ledgerOf = (accountId: string) => maps.get(accountId) ?? accounts.get(accountId)?.name ?? accountId;
    const party = await this.partyNames(entries.flatMap((e) => e.lines));

    // Voucher numbers: our document number; a document's second and later entries get /2, /3… (counted over all its entries).
    const ordinal = await this.ordinals(entries);
    const numbers = await this.documentNumbers(entries);
    const stores = new Map((await this.prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, code: true } })).map((s) => [s.id, s.code]));
    const kinds = await this.documentKinds(entries);

    const vouchers: TallyVoucher[] = [];
    for (const e of entries) {
      const base = e.documentNumber ?? numbers.get(`${e.documentType}|${e.documentId}`) ?? `${e.documentType}-${e.documentId.slice(0, 8)}`;
      const n = ordinal.get(e.id) ?? 1;
      const number = n > 1 ? `${base}/${n}` : base;
      const label = `Voucher ${number} of ${iso(e.entryDate)}`;
      const lines = nettedLines(
        e.lines.map((l) => ({ ledger: l.partyId && l.partyType ? party(l.partyType, l.partyId) : ledgerOf(l.accountId), debit: D(l.debit), credit: D(l.credit) })),
        label,
      );
      if (lines.length === 0) continue;
      // A cancellation is its own voucher, pointing at the voucher it reverses (both are exported; they net to zero).
      const cancelledNo = e.cancelsId ? ((ordinal.get(e.cancelsId) ?? 1) > 1 ? `${base}/${ordinal.get(e.cancelsId)}` : base) : null;
      const narration = [
        e.storeId ? `[${stores.get(e.storeId) ?? ''}]` : null,
        cancelledNo ? `Cancels voucher ${cancelledNo}.` : null,
        e.remark || null,
      ]
        .filter(Boolean)
        .join(' ');
      vouchers.push({
        id: e.id,
        type: this.voucherType(e.documentType, kinds.get(`${e.documentType}|${e.documentId}`) ?? null, e.lines.map((l) => accounts.get(l.accountId))),
        date: iso(e.entryDate)!,
        number,
        narration,
        lines,
      });
    }
    return { company: company.tradeName || company.legalName, vouchers, storeCode: store?.code ?? null };
  }

  /** The .xml file for Tally, recorded in the history. */
  async exportVouchers(q: TallyExportQuery, actor: Actor, user: CurrentUser) {
    const { company, vouchers, storeCode } = await this.vouchers(q, user);
    const xml = envelope('Vouchers', company, vouchers.map(voucherXml));
    await this.audit.record(this.prisma, actor, {
      action: 'export',
      entityType: 'report',
      entityId: null,
      changes: { report: 'Tally vouchers', filters: { from: q.from, to: q.to, store: storeCode }, rows: vouchers.length },
    });
    return { fileName: `tally-vouchers-${q.from}-to-${q.to}${storeCode ? `-${storeCode}` : ''}.xml`, data: Buffer.from(xml, 'utf8'), contentType: 'application/xml; charset=utf-8' };
  }

  /** The ledger list (accounts with Tally groups, and every customer and supplier with entries), for creating ledgers in Tally first. */
  async exportMasters(actor: Actor, user: CurrentUser) {
    this.mayExport(user, 'export');
    const company = await this.common.ready();
    const accounts = await this.prisma.account.findMany({ where: { companyId: company.id }, orderBy: [{ number: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
    const maps = new Map((await this.prisma.tallyLedgerMap.findMany({ where: { companyId: company.id } })).map((m) => [m.accountId, m.tallyLedger]));
    const groupOf = this.groupFinder(accounts);
    const ledgers = new Map<string, string>();
    for (const a of accounts) {
      if (a.isGroup) continue;
      const name = maps.get(a.id) ?? a.name;
      if (!ledgers.has(name)) ledgers.set(name, groupOf(a));
    }
    const used = await this.prisma.ledgerLine.findMany({ where: { companyId: company.id, partyId: { not: null } }, distinct: ['partyType', 'partyId'], select: { partyType: true, partyId: true } });
    const party = await this.partyNames(used);
    const parties = used
      .filter((u) => u.partyType && u.partyId)
      .map((u) => ({ name: party(u.partyType!, u.partyId!), group: u.partyType === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors' }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const p of parties) if (!ledgers.has(p.name)) ledgers.set(p.name, p.group);
    const messages = [...ledgers].map(([name, group]) =>
      [
        `     <LEDGER NAME="${xmlText(name)}" ACTION="Create">`,
        '      <NAME.LIST>',
        `       <NAME>${xmlText(name)}</NAME>`,
        '      </NAME.LIST>',
        `      <PARENT>${xmlText(group)}</PARENT>`,
        '     </LEDGER>',
      ].join('\r\n'),
    );
    const xml = envelope('All Masters', company.tradeName || company.legalName, messages);
    await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'report', entityId: null, changes: { report: 'Tally ledgers', filters: {}, rows: messages.length } });
    return { fileName: 'tally-ledgers.xml', data: Buffer.from(xml, 'utf8'), contentType: 'application/xml; charset=utf-8' };
  }

  // ---- Helpers ----

  private mayExport(user: CurrentUser, what: 'see' | 'change' | 'export') {
    const ok = what === 'see' ? hasPermission(user, 'tally.export') || hasPermission(user, 'accounts.view') : what === 'change' ? hasPermission(user, 'tally.export') || hasPermission(user, 'accounts.manage') : hasPermission(user, 'tally.export');
    if (!ok) throw new ForbiddenException(what === 'export' ? 'You are not allowed to export to Tally' : 'You are not allowed to change Tally ledger names');
  }

  /**
   * Our postings → Tally voucher types:
   * till shifts (and bills) → Sales; supplier bills → Purchase (debit notes → Debit Note);
   * receipts → Receipt; payments → Payment; transfers → Contra when only cash and bank
   * accounts are involved, else Journal; everything else (journals, expenses,
   * goods receipts, stock documents, freight sharing, other new kinds) → Journal.
   */
  private voucherType(documentType: string, kind: string | null, accounts: (Account | undefined)[]): TallyVoucher['type'] {
    switch (documentType) {
      case 'pos_shift':
      case 'pos_bill':
        return 'Sales';
      case 'supplier_bill':
        return kind === 'debit_note' ? 'Debit Note' : 'Purchase';
      case 'payment':
        if (kind === 'receipt') return 'Receipt';
        if (kind === 'payment') return 'Payment';
        if (kind === 'transfer') return accounts.every((a) => a?.kind === 'cash' || a?.kind === 'bank') ? 'Contra' : 'Journal';
        return 'Journal';
      default:
        return 'Journal';
    }
  }

  /** The kind of payment (receipt, payment, transfer) or supplier bill (bill, debit note) behind entries. */
  private async documentKinds(entries: { documentType: string; documentId: string }[]) {
    const ids = (t: string) => [...new Set(entries.filter((e) => e.documentType === t).map((e) => e.documentId))];
    const [payments, bills] = await Promise.all([
      this.prisma.payment.findMany({ where: { id: { in: ids('payment') } }, select: { id: true, kind: true } }),
      this.prisma.supplierBill.findMany({ where: { id: { in: ids('supplier_bill') } }, select: { id: true, kind: true } }),
    ]);
    return new Map<string, string>([...payments.map((p) => [`payment|${p.id}`, p.kind] as const), ...bills.map((b) => [`supplier_bill|${b.id}`, String(b.kind)] as const)]);
  }

  /** Document numbers for entries posted without one (stock postings carry only the document id). */
  private async documentNumbers(entries: { documentType: string; documentId: string; documentNumber: string | null }[]) {
    const out = new Map<string, string>();
    const ids = (t: string) => [...new Set(entries.filter((e) => e.documentType === t && !e.documentNumber).map((e) => e.documentId))];
    const select = { id: true, number: true } as const;
    for (const t of NUMBER_TABLES) {
      const want = ids(t);
      if (want.length === 0) continue;
      const rows: { id: string; number: string }[] =
        t === 'stock_document'
          ? await this.prisma.stockDocument.findMany({ where: { id: { in: want } }, select })
          : t === 'goods_receipt'
            ? await this.prisma.goodsReceipt.findMany({ where: { id: { in: want } }, select })
            : t === 'landed_charge'
              ? await this.prisma.landedCharge.findMany({ where: { id: { in: want } }, select })
              : t === 'pos_bill'
                ? await this.prisma.posBill.findMany({ where: { id: { in: want } }, select })
                : await this.prisma.supplierBill.findMany({ where: { id: { in: want } }, select });
      for (const r of rows) out.set(`${t}|${r.id}`, r.number);
    }
    return out;
  }

  /** Each entry's place among all entries of its document (1 = first), by when it was written. */
  private async ordinals(entries: { documentType: string; documentId: string }[]) {
    const docIds = [...new Set(entries.map((e) => e.documentId))];
    const all = docIds.length
      ? await this.prisma.ledgerEntry.findMany({ where: { documentId: { in: docIds } }, select: { id: true, documentType: true, documentId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      : [];
    const count = new Map<string, number>();
    const out = new Map<string, number>();
    for (const e of all) {
      const k = `${e.documentType}|${e.documentId}`;
      const n = (count.get(k) ?? 0) + 1;
      count.set(k, n);
      out.set(e.id, n);
    }
    return out;
  }

  /** Customer and supplier ledger names: the party's name, with its code added when two parties share a name. */
  private async partyNames(lines: { partyType: string | null; partyId: string | null }[]) {
    const ids = (t: string) => [...new Set(lines.filter((l) => l.partyType === t && l.partyId).map((l) => l.partyId!))];
    const [customers, suppliers] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: ids('customer') } }, select: { id: true, code: true, name: true } }),
      this.prisma.supplier.findMany({ where: { id: { in: ids('supplier') } }, select: { id: true, code: true, name: true } }),
    ]);
    const names = [...new Set([...customers, ...suppliers].map((p) => p.name.trim()))];
    const [sameC, sameS] = names.length
      ? await Promise.all([
          this.prisma.customer.groupBy({ by: ['name'], where: { name: { in: names } }, _count: { _all: true } }),
          this.prisma.supplier.groupBy({ by: ['name'], where: { name: { in: names } }, _count: { _all: true } }),
        ])
      : [[], []];
    const uses = new Map<string, number>();
    for (const g of [...sameC, ...sameS]) uses.set(g.name.trim(), (uses.get(g.name.trim()) ?? 0) + g._count._all);
    const nameOf = (p: { name: string; code: string }) => ((uses.get(p.name.trim()) ?? 1) > 1 ? `${p.name.trim()} (${p.code})` : p.name.trim());
    const c = new Map(customers.map((p) => [p.id, nameOf(p)]));
    const s = new Map(suppliers.map((p) => [p.id, nameOf(p)]));
    return (type: string, id: string) => (type === 'customer' ? c.get(id) : s.get(id)) ?? id;
  }

  /** The Tally group of an account: from its nearest standard folder, else its family. */
  private groupFinder(accounts: Account[]) {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return (a: Account): string => {
      for (let x: Account | undefined = a, depth = 0; x && depth < 20; x = x.parentId ? byId.get(x.parentId) : undefined, depth++) {
        const key = x.systemKey?.split(':')[0];
        if (key && TALLY_GROUPS[key]) return TALLY_GROUPS[key];
      }
      return FAMILY_GROUPS[a.family] ?? 'Suspense A/c';
    };
  }
}
