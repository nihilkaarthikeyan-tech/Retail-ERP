// Copyright (c) 2026, Rademics. All rights reserved.
// The only code that writes ledger entries (plan 07 §3; blueprint 11 process 1).
// Every caller passes its own transaction, so a document and its ledger lines
// succeed or fail together (rule 5). Posted lines are never changed: the
// database refuses updates and deletes, and checks every entry balances.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ACCOUNT_ROLES, combinePosting, Decimal, POSTING_TOLERANCE, roundMoney, STORE_ACCOUNT_ROLES, SYSTEM_ROLES, wrongSideBalance } from 'shared';
import type { Db } from '../audit/audit.service.js';
import type { Account, LedgerEntry } from '../generated/prisma/client.js';
import { AccountingSetup } from './accounting-setup.service.js';

type Amount = Decimal | string | number | { toString(): string };
const D = (v: Amount) => new Decimal(v.toString());
const ZERO = new Decimal(0);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(fromIso(s).getTime() + n * 86_400_000));

/** Stock ledger roles that are a different name for an account role. */
const ROLE_ALIASES: Record<string, string> = { transfer: 'stock_transfer_clearing' };

export interface LedgerLineInput {
  /** A specific account, or… */
  accountId?: string;
  /** …an account role from ACCOUNT_ROLES, or cash_in_till / cash_in_hand (with storeId). */
  role?: string;
  storeId?: string | null;
  partyType?: 'customer' | 'supplier' | null;
  partyId?: string | null;
  debit?: Amount;
  credit?: Amount;
  /** The open item this party line belongs to (bill, payment, credit note). */
  itemType?: string | null;
  itemId?: string | null;
  itemNumber?: string | null;
  dueDate?: string | null;
  remark?: string | null;
}

export interface PostInput {
  companyId: string;
  date: string;
  documentType: string;
  documentId: string;
  documentNumber?: string | null;
  storeId?: string | null;
  isOpening?: boolean;
  remark?: string | null;
  /** document: up to 50 paise goes to Rounding; journal: 5 paise. */
  tolerance?: keyof typeof POSTING_TOLERANCE;
  actorId: string | null;
  lines: LedgerLineInput[];
  /** refuse (default): a date in locked books is refused unless the actor may post there; next_open: moved to the first open day. */
  whenLocked?: 'refuse' | 'next_open';
}

export interface OpenItemRow {
  itemType: string;
  itemId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  storeId: string | null;
  /** The item's own amount (negative for payments and credits). */
  amount: Decimal;
  settled: Decimal;
  /** Still open: positive owed, negative unused. */
  owed: Decimal;
}

export interface StockSyncOptions {
  actorId: string | null;
  /** Entries created in this call (posted on their own date); others are corrections (moved past locked books). */
  newIds?: Set<bigint>;
  /** Directly revalued entries post against this role instead of their own (freight added later). */
  counterRole?: Map<bigint, string>;
  remark?: string;
}

@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name);

  constructor(private readonly setup: AccountingSetup) {}

  /** Writes one balanced ledger entry. Returns null when every line nets to zero. */
  async post(tx: Db, input: PostInput): Promise<LedgerEntry | null> {
    await this.setup.ensure(tx, input.companyId);
    const date = await this.postingDate(tx, input.companyId, input.date, input.actorId, input.whenLocked ?? 'refuse', input.documentType);
    const fy = await this.openYear(tx, input.companyId, date);

    // Resolve roles to accounts and check each line.
    const resolved: { account: Account; line: LedgerLineInput }[] = [];
    // Lines naming the same account or role and store resolve to the same account: look each up once (plan 11 A5).
    const lookedUp = new Map<string, Account>();
    for (const l of input.lines) {
      if (D(l.debit ?? 0).isZero() && D(l.credit ?? 0).isZero()) continue;
      const k = [l.accountId ?? '', l.role ?? '', l.storeId ?? ''].join('|');
      let account = lookedUp.get(k);
      if (!account) {
        account = await this.accountFor(tx, input.companyId, l);
        lookedUp.set(k, account);
      }
      resolved.push({ account, line: l });
    }
    const accounts = new Map(resolved.map((r) => [r.account.id, r.account]));
    // Locked accounts take postings only from the trusted role (blueprint 11).
    const locked = resolved.find((r) => r.account.locked);
    if (locked && !(await this.mayPostLocked(tx, input.actorId))) throw new BadRequestException(`${locked.account.name} is locked; only the Accountant can post to it`);
    const keyOf = (accountId: string, l: LedgerLineInput) =>
      [accountId, l.storeId ?? '', l.partyType ?? '', l.partyId ?? '', l.itemType ?? '', l.itemId ?? '', l.dueDate ?? ''].join('|');
    const meta = new Map<string, LedgerLineInput>();
    for (const r of resolved) {
      this.checkLine(r.account, r.line);
      const k = keyOf(r.account.id, r.line);
      if (!meta.has(k)) meta.set(k, r.line);
    }
    const tolerance = POSTING_TOLERANCE[input.tolerance ?? 'document'];
    const combined = combinePosting(
      resolved.map((r) => ({ key: keyOf(r.account.id, r.line), debit: (r.line.debit ?? 0).toString(), credit: (r.line.credit ?? 0).toString() })),
      tolerance,
    );
    if (!combined.ok) {
      throw new BadRequestException(`Debits and credits must balance: the difference is ₹${combined.difference.abs().toFixed(2)}`);
    }
    const lines = combined.lines.map((c) => ({ ...c, l: meta.get(c.key)!, accountId: c.key.split('|')[0] }));
    if (!combined.rounding.isZero()) {
      const rounding = await this.accountFor(tx, input.companyId, { role: 'rounding' });
      accounts.set(rounding.id, rounding);
      const l: LedgerLineInput = { storeId: input.storeId ?? null, remark: 'Rounding' };
      lines.push({ key: keyOf(rounding.id, l), debit: combined.rounding.gt(0) ? combined.rounding : ZERO, credit: combined.rounding.lt(0) ? combined.rounding.neg() : ZERO, l, accountId: rounding.id });
    }
    if (lines.length === 0) return null;

    const entry = await tx.ledgerEntry.create({
      data: {
        companyId: input.companyId,
        entryDate: fromIso(date),
        financialYearId: fy,
        documentType: input.documentType,
        documentId: input.documentId,
        documentNumber: input.documentNumber ?? null,
        storeId: input.storeId ?? null,
        isOpening: input.isOpening ?? false,
        remark: input.remark ?? null,
        createdById: input.actorId,
      },
    });
    await tx.ledgerLine.createMany({
      data: lines.map((x) => ({
        entryId: entry.id,
        companyId: input.companyId,
        entryDate: fromIso(date),
        accountId: x.accountId,
        storeId: x.l.storeId ?? null,
        partyType: x.l.partyType ?? null,
        partyId: x.l.partyId ?? null,
        debit: x.debit.toFixed(2),
        credit: x.credit.toFixed(2),
        itemType: x.l.itemType ?? null,
        itemId: x.l.itemId ?? null,
        itemNumber: x.l.itemNumber ?? null,
        dueDate: x.l.dueDate ? fromIso(x.l.dueDate) : null,
        remark: x.l.remark ?? null,
      })),
    });
    await this.checkMustBe(tx, [...new Set(lines.map((x) => x.accountId))].map((id) => accounts.get(id)!));
    return entry;
  }

  /** Cancels one entry with equal and opposite lines on the same date (plan 07 answer 3). */
  async reverse(tx: Db, entryId: string, actorId: string | null, remark?: string): Promise<LedgerEntry> {
    const original = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true, cancelledBy: true } });
    if (original.cancelledBy) throw new BadRequestException('This ledger entry is already cancelled');
    if (original.cancelsId) throw new BadRequestException('A cancellation cannot itself be cancelled');
    const date = iso(original.entryDate);
    await this.postingDate(tx, original.companyId, date, actorId, 'refuse', original.documentType);
    await this.openYear(tx, original.companyId, date);
    const entry = await tx.ledgerEntry.create({
      data: {
        companyId: original.companyId,
        entryDate: original.entryDate,
        financialYearId: original.financialYearId,
        documentType: original.documentType,
        documentId: original.documentId,
        documentNumber: original.documentNumber,
        storeId: original.storeId,
        isOpening: original.isOpening,
        cancelsId: original.id,
        remark: remark ?? 'Cancelled',
        createdById: actorId,
      },
    });
    await tx.ledgerLine.createMany({
      data: original.lines.map((l) => ({
        entryId: entry.id,
        companyId: l.companyId,
        entryDate: l.entryDate,
        accountId: l.accountId,
        storeId: l.storeId,
        partyType: l.partyType,
        partyId: l.partyId,
        debit: l.credit,
        credit: l.debit,
        itemType: l.itemType,
        itemId: l.itemId,
        itemNumber: l.itemNumber,
        dueDate: l.dueDate,
        remark: l.remark,
      })),
    });
    const accounts = await tx.account.findMany({ where: { id: { in: [...new Set(original.lines.map((l) => l.accountId))] } } });
    await this.checkMustBe(tx, accounts);
    return entry;
  }

  /** Cancels every entry a document has posted (its own posting and any corrections). */
  async reverseDocument(tx: Db, documentType: string, documentId: string, actorId: string | null, remark?: string): Promise<LedgerEntry[]> {
    const entries = await tx.ledgerEntry.findMany({ where: { documentType, documentId, cancelsId: null, cancelledBy: null }, orderBy: { createdAt: 'asc' } });
    const out: LedgerEntry[] = [];
    for (const e of entries) out.push(await this.reverse(tx, e.id, actorId, remark));
    return out;
  }

  /**
   * Posts the stock value of stock ledger entries that has not reached the
   * ledger yet (value − posted value): stock on one side, the entry's account
   * role on the other. Used by the stock engine for every movement and every
   * re-costing, so the stock account always equals the stock value.
   */
  async syncStock(tx: Db, ids: bigint[], opts: StockSyncOptions): Promise<void> {
    if (ids.length === 0) return;
    const entries = await tx.stockLedgerEntry.findMany({ where: { id: { in: ids }, ledgerHeld: false }, orderBy: { id: 'asc' } });
    const pending = entries.filter((e) => !D(e.valueChange).eq(D(e.postedValue)));
    if (pending.length === 0) return;
    const locations = new Map(
      (await tx.stockLocation.findMany({ where: { id: { in: [...new Set(pending.map((e) => e.locationId))] } }, select: { id: true, storeId: true, kind: true } })).map((l) => [l.id, l]),
    );
    const groups = new Map<string, typeof pending>();
    for (const e of pending) {
      const isNew = opts.newIds?.has(e.id) ?? false;
      const k = `${e.documentType}|${e.documentId}|${iso(e.postingDate)}|${isNew ? 'new' : 'fix'}`;
      const group = groups.get(k);
      if (group) group.push(e);
      else groups.set(k, [e]);
    }
    for (const [k, group] of groups) {
      const [documentType, documentId, date, mode] = k.split('|');
      const lines: LedgerLineInput[] = [];
      for (const e of group) {
        const delta = D(e.valueChange).sub(D(e.postedValue));
        const loc = locations.get(e.locationId)!;
        const stockLine: LedgerLineInput = loc.kind === 'transit' ? { role: 'goods_in_transit' } : { role: 'stock', storeId: loc.storeId };
        const counter = opts.counterRole?.get(e.id) ?? ROLE_ALIASES[e.accountRole] ?? e.accountRole;
        lines.push({ ...stockLine, debit: delta });
        lines.push({ role: counter, storeId: loc.storeId, credit: delta });
      }
      await this.post(tx, {
        companyId: group[0].companyId,
        date,
        documentType,
        documentId,
        storeId: locations.get(group[0].locationId)?.storeId ?? null,
        actorId: opts.actorId,
        lines,
        remark: mode === 'fix' ? (opts.remark ?? 'Stock value corrected (re-costing)') : (opts.remark ?? null),
        whenLocked: mode === 'fix' ? 'next_open' : 'refuse',
      });
    }
    await this.markPosted(tx, pending.map((e) => e.id));
  }

  /** Records that these stock entries' current value is in the ledger. */
  async markPosted(tx: Db, ids: bigint[], release = true): Promise<void> {
    if (ids.length === 0) return;
    await tx.$executeRaw`SELECT set_config('app.stock_recost', 'on', true)`;
    await tx.$executeRawUnsafe(
      `UPDATE "StockLedgerEntry" SET "postedValue" = "valueChange"${release ? ', "ledgerHeld" = false' : ''} WHERE "id" = ANY($1::bigint[])`,
      ids.map((i) => i.toString()),
    );
  }

  /** Stock not yet in the ledger for these entries, per location: value − posted value. */
  async unposted(tx: Db, ids: bigint[]): Promise<{ id: bigint; locationId: string; storeId: string | null; transit: boolean; role: string; amount: Decimal }[]> {
    if (ids.length === 0) return [];
    const entries = await tx.stockLedgerEntry.findMany({ where: { id: { in: ids } } });
    const locations = new Map(
      (await tx.stockLocation.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.locationId))] } }, select: { id: true, storeId: true, kind: true } })).map((l) => [l.id, l]),
    );
    return entries
      .map((e) => ({ id: e.id, locationId: e.locationId, storeId: locations.get(e.locationId)?.storeId ?? null, transit: locations.get(e.locationId)?.kind === 'transit', role: e.accountRole, amount: D(e.valueChange).sub(D(e.postedValue)) }))
      .filter((x) => !x.amount.isZero());
  }

  // ---- Open items and settlement links (decision 51: balances come from the ledger) ----

  /** What is still open on an item (a bill, payment or credit note): its ledger amount less its links. */
  /** What is still open on each of several items of one kind (bills on a list screen), in one go. */
  async openAmounts(tx: Db, itemType: string, itemIds: string[]): Promise<Map<string, Decimal>> {
    const out = new Map<string, Decimal>();
    if (!itemIds.length) return out;
    const sums = await tx.ledgerLine.groupBy({ by: ['itemId'], where: { itemType, itemId: { in: itemIds } }, _sum: { debit: true, credit: true } });
    for (const r of sums) out.set(r.itemId!, D(r._sum.credit ?? 0).sub(D(r._sum.debit ?? 0)).abs());
    const asBill = await tx.settlement.groupBy({ by: ['billId'], where: { undone: false, billType: itemType, billId: { in: itemIds } }, _sum: { amount: true } });
    const asBy = await tx.settlement.groupBy({ by: ['byId'], where: { undone: false, byType: itemType, byId: { in: itemIds } }, _sum: { amount: true } });
    for (const r of asBill) out.set(r.billId, (out.get(r.billId) ?? ZERO).sub(D(r._sum.amount ?? 0)));
    for (const r of asBy) out.set(r.byId, (out.get(r.byId) ?? ZERO).sub(D(r._sum.amount ?? 0)));
    return out;
  }

  async openAmount(tx: Db, itemType: string, itemId: string): Promise<Decimal> {
    const sum = await tx.ledgerLine.aggregate({ where: { itemType, itemId }, _sum: { debit: true, credit: true } });
    const amount = D(sum._sum.credit ?? 0).sub(D(sum._sum.debit ?? 0)).abs();
    const links = await tx.settlement.aggregate({ where: { undone: false, OR: [{ billType: itemType, billId: itemId }, { byType: itemType, byId: itemId }] }, _sum: { amount: true } });
    return amount.sub(D(links._sum.amount ?? 0));
  }

  /**
   * A customer's or supplier's open items: every bill, payment or credit note
   * with what is still open on it. `owed` is positive when the party owes the
   * shop (customers) or the shop owes the party (suppliers); a negative amount
   * is an advance or credit not yet used.
   */
  async openItems(tx: Db, partyType: 'customer' | 'supplier', partyId: string, asOf?: string): Promise<OpenItemRow[]> {
    const lines = await tx.ledgerLine.findMany({
      where: { partyType, partyId, itemId: { not: null }, ...(asOf ? { entryDate: { lte: fromIso(asOf) } } : {}) },
      select: { itemType: true, itemId: true, itemNumber: true, dueDate: true, entryDate: true, debit: true, credit: true, storeId: true },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    });
    const items = new Map<string, OpenItemRow>();
    for (const l of lines) {
      const k = `${l.itemType}|${l.itemId}`;
      const signed = partyType === 'customer' ? D(l.debit).sub(D(l.credit)) : D(l.credit).sub(D(l.debit));
      const it = items.get(k);
      if (it) it.amount = it.amount.add(signed);
      else items.set(k, { itemType: l.itemType!, itemId: l.itemId!, number: l.itemNumber, date: iso(l.entryDate), dueDate: l.dueDate ? iso(l.dueDate) : null, storeId: l.storeId, amount: signed, settled: ZERO, owed: ZERO });
    }
    const links = await tx.settlement.findMany({ where: { partyType, partyId, undone: false, ...(asOf ? { settledOn: { lte: fromIso(asOf) } } : {}) } });
    for (const s of links) {
      for (const k of [`${s.billType}|${s.billId}`, `${s.byType}|${s.byId}`]) {
        const it = items.get(k);
        if (it) it.settled = it.settled.add(D(s.amount));
      }
    }
    const out: OpenItemRow[] = [];
    for (const it of items.values()) {
      // A bill (positive) is reduced by its links; an advance (negative) is used up by them.
      it.owed = it.amount.gte(0) ? it.amount.sub(it.settled) : it.amount.add(it.settled);
      if (!it.owed.isZero()) out.push(it);
    }
    return out;
  }

  /** The party's balance from the ledger (positive = owes the shop for customers, shop owes for suppliers). */
  async partyBalance(tx: Db, partyType: 'customer' | 'supplier', partyId: string, asOf?: string): Promise<Decimal> {
    const sum = await tx.ledgerLine.aggregate({ where: { partyType, partyId, ...(asOf ? { entryDate: { lte: fromIso(asOf) } } : {}) }, _sum: { debit: true, credit: true } });
    const dr = D(sum._sum.debit ?? 0).sub(D(sum._sum.credit ?? 0));
    return partyType === 'customer' ? dr : dr.neg();
  }

  async link(tx: Db, s: { companyId: string; partyType: string; partyId: string; billType: string; billId: string; byType: string; byId: string; amount: Decimal; date: string; actorId: string | null }) {
    return tx.settlement.create({
      data: { companyId: s.companyId, partyType: s.partyType, partyId: s.partyId, billType: s.billType, billId: s.billId, byType: s.byType, byId: s.byId, amount: s.amount.toFixed(2), settledOn: fromIso(s.date), createdById: s.actorId },
    });
  }

  /** Undoes every live link an item takes part in (kept for the history). */
  async undoLinks(tx: Db, itemType: string, itemId: string, actorId: string | null): Promise<number> {
    const r = await tx.settlement.updateMany({
      where: { undone: false, OR: [{ billType: itemType, billId: itemId }, { byType: itemType, byId: itemId }] },
      data: { undone: true, undoneAt: new Date(), undoneById: actorId },
    });
    return r.count;
  }

  /** The company's first store: the cost centre for automatic postings that name no store (plan 07 §9c). */
  async firstStore(tx: Db, companyId: string): Promise<string | null> {
    const s = await tx.store.findFirst({ where: { companyId }, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }], select: { id: true } });
    return s?.id ?? null;
  }

  // ---- Accounts ----

  async accountFor(tx: Db, companyId: string, l: Pick<LedgerLineInput, 'accountId' | 'role' | 'storeId'>): Promise<Account> {
    if (l.accountId) {
      const a = await tx.account.findUnique({ where: { id: l.accountId } });
      if (!a || a.companyId !== companyId) throw new BadRequestException('Account not found');
      return a;
    }
    if (!l.role) throw new Error('A ledger line needs an account or a role');
    const role = ROLE_ALIASES[l.role] ?? l.role;
    if (role in STORE_ACCOUNT_ROLES) {
      if (!l.storeId) throw new Error(`${role} needs a store`);
      return this.setup.storeAccount(tx, companyId, l.storeId, role as keyof typeof STORE_ACCOUNT_ROLES);
    }
    if (!(role in ACCOUNT_ROLES)) throw new Error(`Unknown account role ${role}`);
    const d = await tx.accountDefault.findUnique({ where: { companyId_role: { companyId, role } }, include: { account: true } });
    if (!d) throw new BadRequestException(`No default account is set for ${ACCOUNT_ROLES[role as keyof typeof ACCOUNT_ROLES]}`);
    return d.account;
  }

  private checkLine(a: Account, l: LedgerLineInput) {
    const name = `${a.number ? `${a.number} ` : ''}${a.name}`;
    if (a.isGroup) throw new BadRequestException(`${name} is a folder; post to an account under it`);
    if (!a.active) throw new BadRequestException(`${name} is switched off`);
    const partyKind = a.kind === 'receivable' ? 'customer' : a.kind === 'payable' ? 'supplier' : null;
    if (partyKind && (l.partyType !== partyKind || !l.partyId)) throw new BadRequestException(`${name} needs the ${partyKind}`);
    if (!partyKind && l.partyType && l.partyId && a.kind !== 'receivable' && a.kind !== 'payable') {
      // A party is allowed only on customer and supplier balance accounts.
      throw new BadRequestException(`${name} is not a customer or supplier balance account`);
    }
    if ((a.family === 'income' || a.family === 'expense') && !l.storeId) throw new BadRequestException(`${name} needs a store (profit is tracked by shop)`);
  }

  private async checkMustBe(tx: Db, accounts: Account[]) {
    for (const a of accounts) {
      if (!a.balanceMustBe) continue;
      const sum = await tx.ledgerLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
      const balance = D(sum._sum.debit ?? 0).sub(D(sum._sum.credit ?? 0));
      if (wrongSideBalance(a.balanceMustBe as 'debit' | 'credit', balance)) {
        throw new BadRequestException(`${a.name} must always have a ${a.balanceMustBe} balance; this would make it ₹${roundMoney(balance.abs()).toFixed(2)} ${balance.lt(0) ? 'credit' : 'debit'}`);
      }
    }
  }

  // ---- Dates and locks ----

  /** The date to post on, after the books-locked date and the last year-end closing. */
  private async postingDate(tx: Db, companyId: string, date: string, actorId: string | null, whenLocked: 'refuse' | 'next_open', documentType: string): Promise<string> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { lockDate: true } });
    const closing = documentType === 'year_end_closing' ? null : await tx.yearEndClosing.findFirst({ where: { companyId, status: 'posted' }, orderBy: { periodEnd: 'desc' } });
    const closedTo = closing ? iso(closing.periodEnd) : null;
    const lockedTo = company.lockDate ? iso(company.lockDate) : null;
    if (closedTo && date <= closedTo) {
      if (whenLocked === 'next_open') return this.postingDate(tx, companyId, addDays(closedTo, 1), actorId, whenLocked, documentType);
      throw new BadRequestException(`The year up to ${closedTo} is closed; nothing can be posted on ${date}`);
    }
    if (lockedTo && date <= lockedTo) {
      if (whenLocked === 'next_open') return addDays(lockedTo, 1);
      if (!(await this.mayPostLocked(tx, actorId))) throw new BadRequestException(`The books are locked up to ${lockedTo}; only the Accountant can post on ${date}`);
    }
    return date;
  }

  private async openYear(tx: Db, companyId: string, date: string): Promise<string> {
    const fy = await tx.financialYear.findFirst({ where: { companyId, startDate: { lte: fromIso(date) }, endDate: { gte: fromIso(date) } } });
    if (!fy) throw new BadRequestException(`No financial year covers ${date}`);
    if (fy.status !== 'open') throw new BadRequestException(`The financial year ${fy.name} is locked`);
    return fy.id;
  }

  /** books.lock (or Owner/Admin) may post before the locked date (blueprint 11 settings). */
  async mayPostLocked(tx: Db, actorId: string | null): Promise<boolean> {
    if (!actorId) return false;
    const user = await tx.user.findUnique({ where: { id: actorId }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
    if (!user) return false;
    const roles = user.roles.map((r) => r.role).filter((r) => r.active);
    return roles.some((r) => r.code === SYSTEM_ROLES.OWNER_ADMIN || r.permissions.some((p) => p.permissionKey === 'books.lock'));
  }

  warn(message: string) {
    this.log.warn(message);
  }
}
