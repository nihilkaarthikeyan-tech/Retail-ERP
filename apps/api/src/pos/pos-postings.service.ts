// Copyright (c) 2026, Rademics. All rights reserved.
// The till's day-end posting (decision 39; plan 07 §4 and §1a). When a shift
// closes, its bills reach the ledger as summarised entries, one per business
// date: sales, output GST and rounding; each payment method's account (cash in
// till, card and UPI settlement, the customer's balance for on-account bills);
// cost of goods sold against stock. A separate drawer entry moves the starting
// float and cash in/out between cash in hand and the till, takes the counted
// cash back to cash in hand and posts any shortage, so the till's account is
// zero after every shift; it is dated on the shift's business date. Plan 13: points earned on the bills post here too
// (loyalty expense against the points liability); points and gift cards paid
// with are payment methods whose accounts are those liabilities.
import { Injectable } from '@nestjs/common';
import { Decimal, dueDates } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';

type Amount = { toString(): string };
const D = (v: Amount) => new Decimal(v.toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class PosPostings {
  constructor(
    private readonly ledger: LedgerService,
    private readonly loyalty: LoyaltyService,
  ) {}

  async postShift(tx: Db, shiftId: string, actorId: string | null): Promise<string | null> {
    const shift = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { till: true, openingCash: true, cashMovements: true, closing: { include: { lines: true } } },
    });
    const methodKind = new Map((await tx.paymentMethod.findMany({ where: { companyId: shift.companyId }, select: { id: true, kind: true } })).map((m) => [m.id, m.kind as string]));
    const storeId = shift.till.storeId;
    const companyId = shift.companyId;
    const bills = await tx.posBill.findMany({ where: { shiftId }, include: { payments: { include: { paymentMethod: true } } } });
    const terms = new Map(
      (await tx.customer.findMany({ where: { id: { in: [...new Set(bills.map((b) => b.customerId))] } }, select: { id: true, paymentTermsId: true } })).map((c) => [c.id, c.paymentTermsId]),
    );
    const completed = bills.filter((b) => b.status === 'completed');
    const entryIds: string[] = [];
    // Plan 13 (decision 15): points earned on the bills (less points taken back by returns) post with the shift.
    const earned = await this.loyalty.earnedValues(tx, completed.map((b) => b.id));

    // Stock: everything the shift's bills moved and that is not in the ledger yet (cancelled bills net to zero).
    const stockIds = (await tx.stockLedgerEntry.findMany({ where: { documentType: 'pos_bill', documentId: { in: bills.map((b) => b.id) } }, select: { id: true } })).map((e) => e.id);
    const stock = await this.ledger.unposted(tx, stockIds);

    const dates = [...new Set(completed.map((b) => iso(b.businessDate)))].sort();
    const stockByDate = new Map<string, typeof stock>();
    if (stock.length) {
      const entries = await tx.stockLedgerEntry.findMany({ where: { id: { in: stock.map((s) => s.id) } }, select: { id: true, postingDate: true } });
      const dateOf = new Map(entries.map((e) => [e.id, iso(e.postingDate)]));
      for (const s of stock) {
        const d = dateOf.get(s.id)!;
        stockByDate.set(d, [...(stockByDate.get(d) ?? []), s]);
        if (!dates.includes(d)) dates.push(d);
      }
      dates.sort();
    }

    for (const date of dates) {
      const lines: LedgerLineInput[] = [];
      const billsOnDate = completed.filter((x) => iso(x.businessDate) === date);
      for (const b of billsOnDate) {
        lines.push({ role: 'sales', storeId, credit: D(b.taxableAmount) });
        lines.push({ role: 'gst_output_cgst', storeId, credit: D(b.cgst) });
        lines.push({ role: 'gst_output_sgst', storeId, credit: D(b.sgst) });
        lines.push({ role: 'gst_output_igst', storeId, credit: D(b.igst) });
        lines.push({ role: 'rounding', storeId, credit: D(b.roundingAdjustment) });
        for (const p of b.payments) {
          const amount = D(p.amount);
          if (p.paymentMethod.kind === 'cash') lines.push({ role: 'cash_in_till', storeId, debit: amount });
          else if (p.paymentMethod.kind === 'on_account') {
            lines.push({
              role: 'customer_receivable',
              storeId,
              partyType: 'customer',
              partyId: b.customerId,
              debit: amount,
              itemType: 'pos_bill',
              itemId: b.id,
              itemNumber: b.number,
              dueDate: amount.gt(0) ? await this.dueDate(tx, terms.get(b.customerId) ?? null, date) : null,
            });
          } else lines.push({ role: p.paymentMethod.accountRole, storeId, debit: amount });
        }
        if (!D(b.changeAmount).isZero()) lines.push({ role: 'cash_in_till', storeId, credit: D(b.changeAmount), remark: 'Change given' });
        const points = earned.get(b.id);
        if (points && !points.isZero()) lines.push({ role: 'loyalty_expense', storeId, debit: points, remark: 'Loyalty points earned' }, { role: 'loyalty_liability', storeId, credit: points, remark: 'Loyalty points earned' });
      }
      for (const s of stockByDate.get(date) ?? []) {
        lines.push(s.transit ? { role: 'goods_in_transit', debit: s.amount } : { role: 'stock', storeId: s.storeId, debit: s.amount });
        lines.push({ role: s.role, storeId: s.storeId ?? storeId, credit: s.amount });
      }
      const entry = await this.ledger.post(tx, {
        companyId,
        date,
        documentType: 'pos_shift',
        documentId: shiftId,
        documentNumber: `${shift.till.code} ${iso(shift.businessDate)}`,
        storeId,
        actorId,
        lines,
        remark: `Till ${shift.till.code}: ${billsOnDate.length} bills`,
        // Decision L9 (owner, 28 October 2026): at most 1 paisa per bill goes to Rounding unnoticed; more is refused.
        tolerance: new Decimal('0.01').mul(Math.max(1, billsOnDate.length)),
        // Tills never stop because the books are locked; the entry moves to the first open day (plan 06 §9c item 8).
        whenLocked: 'next_open',
      });
      if (entry) entryIds.push(entry.id);
    }
    await this.ledger.markPosted(tx, stock.map((s) => s.id));

    // The drawer: float in, cash in/out, counted cash back to cash in hand, the difference to cash short or over.
    const cash = new Set(shift.openingCash.filter((c) => methodKind.get(c.paymentMethodId) === 'cash').map((c) => c.paymentMethodId));
    const drawer: LedgerLineInput[] = [];
    const float = shift.openingCash.filter((c) => cash.has(c.paymentMethodId)).reduce((s, c) => s.add(D(c.amount)), new Decimal(0));
    drawer.push({ role: 'cash_in_till', storeId, debit: float, remark: 'Starting float' }, { role: 'cash_in_hand', storeId, credit: float, remark: 'Starting float' });
    for (const m of shift.cashMovements) {
      const amount = D(m.amount).mul(m.direction === 'in' ? 1 : -1);
      drawer.push({ role: 'cash_in_till', storeId, debit: amount, remark: m.reason }, { role: 'cash_in_hand', storeId, credit: amount, remark: m.reason });
    }
    const cashLines = shift.closing?.lines.filter((l) => methodKind.get(l.paymentMethodId) === 'cash') ?? [];
    const counted = cashLines.reduce((s, l) => s.add(D(l.counted)), new Decimal(0));
    const difference = cashLines.reduce((s, l) => s.add(D(l.difference)), new Decimal(0));
    drawer.push({ role: 'cash_in_hand', storeId, debit: counted, remark: 'Counted at closing' }, { role: 'cash_in_till', storeId, credit: counted, remark: 'Counted at closing' });
    // Short: the till account still holds the missing cash; it goes to cash short or over (over: the other way).
    drawer.push({ role: 'cash_short_over', storeId, debit: difference.neg(), remark: 'Cash difference at closing' }, { role: 'cash_in_till', storeId, credit: difference.neg() });
    const drawerEntry = await this.ledger.post(tx, {
      companyId,
      // Audit 5 (29 October 2026): the drawer belongs to the shift's own business date, like its float and
      // bills, not to the day it was closed (a shift closed after midnight, C2); a locked day moves on as above.
      date: iso(shift.businessDate),
      documentType: 'pos_shift',
      documentId: shiftId,
      documentNumber: `${shift.till.code} ${iso(shift.businessDate)}`,
      storeId,
      actorId,
      lines: drawer,
      remark: `Till ${shift.till.code}: drawer`,
      whenLocked: 'next_open',
    });
    if (drawerEntry) entryIds.push(drawerEntry.id);

    // A refund on account settles the bill it returns, as far as that bill is still owed.
    for (const b of completed.filter((x) => x.kind === 'return' && x.returnOfId)) {
      const refund = b.payments.filter((p) => p.paymentMethod.kind === 'on_account').reduce((s, p) => s.add(D(p.amount)), new Decimal(0)).neg();
      if (refund.lte(0)) continue;
      const owed = await this.ledger.openAmount(tx, 'pos_bill', b.returnOfId!);
      const take = Decimal.min(owed, refund);
      if (take.gt(0)) await this.ledger.link(tx, { companyId, partyType: 'customer', partyId: b.customerId, billType: 'pos_bill', billId: b.returnOfId!, byType: 'pos_bill', byId: b.id, amount: take, date: iso(b.businessDate), actorId });
    }
    return entryIds[0] ?? null;
  }

  /** Due date from the customer's payment terms (module 3: the last part's due date). */
  private async dueDate(tx: Db, paymentTermsId: string | null, date: string): Promise<string> {
    if (!paymentTermsId) return date;
    const parts = await tx.paymentTermsPart.findMany({ where: { paymentTermsId }, orderBy: { sortOrder: 'asc' } });
    if (!parts.length) return date;
    return dueDates(date, parts.map((p) => ({ share: p.share.toString(), dueBasis: p.dueBasis, days: p.days, months: p.months }))).dueDate;
  }
}
