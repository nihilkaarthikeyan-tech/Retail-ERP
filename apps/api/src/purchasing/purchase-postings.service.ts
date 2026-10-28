// Copyright (c) 2026, Rademics. All rights reserved.
// Ledger postings of purchasing documents (plan 07 §4; accounting effects map
// section 1). Each runs inside the document's own transaction (rule 5).
import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal, purchaseTaxSplit } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';

type Amount = { toString(): string };
const D = (v: Amount) => new Decimal(v.toString());
/** Decision L5: the freight share of goods returned, a ledger entry of its own beside the return's stock entries. */
const RETURN_FREIGHT = 'goods_return_freight';
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class PurchasePostings {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * Goods received: stock up at stock value; goods received not billed for the
   * net line amounts; freight added to stock credited to Freight inward. The
   * tiny difference from per-unit rounding goes to cost of goods sold.
   */
  async goodsReceipt(tx: Db, receiptId: string, stockEntryIds: bigint[], actorId: string | null): Promise<void> {
    const r = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { lines: true } });
    const parts = await this.ledger.unposted(tx, stockEntryIds);
    const lines: LedgerLineInput[] = [];
    let stock = new Decimal(0);
    for (const p of parts) {
      lines.push(p.transit ? { role: 'goods_in_transit', debit: p.amount } : { role: 'stock', storeId: p.storeId, debit: p.amount });
      stock = stock.add(p.amount);
    }
    const taxable = r.lines.reduce((s, l) => s.add(D(l.taxableAmount)), new Decimal(0));
    const charges = r.lines.reduce((s, l) => s.add(D(l.extraCharges)), new Decimal(0));
    // Plan 11 part 2: sale-or-return goods are owed only once sold, so they go to the consignment balance.
    lines.push({ role: r.isConsignment ? 'consignment_payable' : 'goods_received_not_billed', storeId: r.storeId, credit: taxable });
    if (!charges.isZero()) lines.push({ role: 'freight_inward', storeId: r.storeId, credit: charges });
    const rounding = stock.sub(taxable).sub(charges);
    if (!rounding.isZero()) lines.push({ role: 'cost_of_goods_sold', storeId: r.storeId, credit: rounding });
    await this.ledger.post(tx, {
      companyId: r.companyId,
      date: iso(r.postingDate),
      documentType: 'goods_receipt',
      documentId: r.id,
      documentNumber: r.number,
      storeId: r.storeId,
      actorId,
      lines,
    });
    await this.ledger.markPosted(tx, stockEntryIds);
  }

  /** Cancelling a goods receipt: everything it posted (with later freight and re-costing) is reversed. */
  async cancelGoodsReceipt(tx: Db, receiptId: string, reversalEntryIds: bigint[], actorId: string | null): Promise<void> {
    await this.ledger.reverseDocument(tx, 'goods_receipt', receiptId, actorId);
    await this.ledger.markPosted(tx, reversalEntryIds);
  }

  /**
   * Decision L5 (owner, 28 October 2026): goods going back to the supplier leave stock at their full
   * cost, freight included, against goods received not billed; the supplier's debit note clears only
   * the goods. The freight share goes back to Freight inward, so nothing is left behind. It is kept
   * as its own document type, so cancelling the return reverses it (`cancelReturnFreight`) while the
   * stock engine reverses the stock (audit 2, 28 October 2026).
   */
  async returnFreight(tx: Db, r: { id: string; companyId: string; number: string; storeId: string; postingDate: Date }, amount: Decimal, averaging: Decimal, counterRole: string, actorId: string | null): Promise<void> {
    if (amount.lte(0) && averaging.isZero()) return;
    await this.ledger.post(tx, {
      companyId: r.companyId,
      date: iso(r.postingDate),
      documentType: RETURN_FREIGHT,
      documentId: r.id,
      documentNumber: r.number,
      storeId: r.storeId,
      actorId,
      remark: 'Freight share of the goods returned',
      lines: [
        ...(amount.gt(0) ? [{ role: 'freight_inward', storeId: r.storeId, debit: amount }] : []),
        // Audit 3: the goods left at the average cost, not the receipt's; the difference is the cost of what was sold earlier.
        ...(averaging.isZero() ? [] : [{ role: 'cost_of_goods_sold', storeId: r.storeId, debit: averaging, remark: 'Average cost against the receipt cost' }]),
        { role: counterRole, storeId: r.storeId, credit: amount.add(averaging) },
      ],
    });
  }

  /** Cancelling a return: its freight share goes back to goods received not billed. */
  async cancelReturnFreight(tx: Db, returnId: string, actorId: string | null): Promise<void> {
    await this.ledger.reverseDocument(tx, RETURN_FREIGHT, returnId, actorId);
  }

  /**
   * A supplier bill or debit note: the supplier's balance for the total; on the
   * other side each line's account (goods received not billed, stock or an
   * expense), the price difference, input GST per head and rounding. Debit
   * notes carry minus amounts, so the same lines come out the other way round.
   */
  async supplierBill(tx: Db, billId: string, actorId: string | null): Promise<void> {
    const b = await tx.supplierBill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true, supplier: { select: { name: true } } } });
    let storeId = b.storeId;
    if (!storeId && b.receiptId) storeId = (await tx.goodsReceipt.findUnique({ where: { id: b.receiptId }, select: { storeId: true } }))?.storeId ?? null;
    if (!storeId) {
      const receiptLine = b.lines.find((l) => l.receiptLineId);
      if (receiptLine) storeId = (await tx.goodsReceiptLine.findUnique({ where: { id: receiptLine.receiptLineId! }, include: { receipt: { select: { storeId: true } } } }))?.receipt.storeId ?? null;
    }
    storeId ??= await this.ledger.firstStore(tx, b.companyId);
    const lines: LedgerLineInput[] = [];
    for (const l of b.lines) {
      const priceDifference = D(l.priceDifference);
      // Goods that came in through a goods receipt (a bill that received them, or its debit note) are already
      // in stock against goods received not billed; the bill clears that account instead of adding stock again.
      const role = l.accountRole === 'stock' && b.receiptId ? 'goods_received_not_billed' : l.accountRole;
      lines.push({ role, storeId, debit: D(l.taxableAmount).sub(priceDifference) });
      if (!priceDifference.isZero()) lines.push({ role: 'purchase_price_difference', storeId, debit: priceDifference });
      // Plan 08 G7, G8 (accounting effects map §5): claimable tax to input credit; tax that cannot be claimed
      // into the cost (goods already received: goods received not billed, which the bill's re-costing of the
      // receipt credited; sale-or-return goods already sold: cost of goods sold; services: the expense);
      // under reverse charge the shop owes the tax to the government, not to the supplier.
      const split = purchaseTaxSplit({ cgst: l.cgst.toString(), sgst: l.sgst.toString(), igst: l.igst.toString(), creditClaimable: l.creditClaimable }, { reverseCharge: b.reverseCharge, composition: false });
      lines.push({ role: 'gst_input_cgst', storeId, debit: split.input.cgst });
      lines.push({ role: 'gst_input_sgst', storeId, debit: split.input.sgst });
      lines.push({ role: 'gst_input_igst', storeId, debit: split.input.igst });
      if (!split.toCost.isZero()) lines.push({ role: role === 'consignment_payable' ? 'cost_of_goods_sold' : role, storeId, debit: split.toCost });
      lines.push({ role: 'gst_rcm_cgst', storeId, credit: split.reverseCharge.cgst });
      lines.push({ role: 'gst_rcm_sgst', storeId, credit: split.reverseCharge.sgst });
      lines.push({ role: 'gst_rcm_igst', storeId, credit: split.reverseCharge.igst });
    }
    if (!D(b.roundingAdjustment).isZero()) lines.push({ role: 'rounding', storeId, debit: D(b.roundingAdjustment) });
    lines.push({
      role: 'supplier_payable',
      storeId,
      partyType: 'supplier',
      partyId: b.supplierId,
      credit: D(b.total),
      itemType: 'supplier_bill',
      itemId: b.id,
      itemNumber: b.supplierBillNo,
      dueDate: iso(b.dueDate),
    });
    await this.ledger.post(tx, {
      companyId: b.companyId,
      date: iso(b.postingDate),
      documentType: 'supplier_bill',
      documentId: b.id,
      documentNumber: b.number,
      storeId,
      actorId,
      lines,
      remark: `${b.supplier.name} ${b.supplierBillNo}`,
    });
    // A debit note settles the bill it was made against, as far as that bill is still owed.
    if (b.kind === 'debit_note' && b.returnOfId) {
      await this.settleDebitNote(tx, b.companyId, b.supplierId, b.returnOfId, b.id, D(b.total).neg(), iso(b.postingDate), actorId);
    }
  }

  async cancelSupplierBill(tx: Db, billId: string, actorId: string | null): Promise<void> {
    const paid = await tx.settlement.count({ where: { undone: false, billType: 'supplier_bill', billId, byType: { not: 'supplier_bill' } } });
    if (paid) throw new BadRequestException('Payments are linked to this bill; undo the links or cancel the payments first');
    // A debit note's link to its bill goes with it.
    await this.ledger.undoLinks(tx, 'supplier_bill', billId, actorId);
    await this.ledger.reverseDocument(tx, 'supplier_bill', billId, actorId);
  }

  private async settleDebitNote(tx: Db, companyId: string, supplierId: string, billId: string, noteId: string, amount: Decimal, date: string, actorId: string | null) {
    const owed = await this.ledger.openAmount(tx, 'supplier_bill', billId);
    const take = Decimal.min(owed, amount);
    if (take.lte(0)) return;
    await this.ledger.link(tx, { companyId, partyType: 'supplier', partyId: supplierId, billType: 'supplier_bill', billId, byType: 'supplier_bill', byId: noteId, amount: take, date, actorId });
  }
}
