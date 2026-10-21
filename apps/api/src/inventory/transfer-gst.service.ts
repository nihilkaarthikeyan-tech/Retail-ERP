// Copyright (c) 2026, Rademics. All rights reserved.
// GST on transfers between stores (plan 08 G10; blueprint 13 edge case
// "Stores in several states"). Stores under one GSTIN move goods on a
// delivery challan and no tax. Stores under different GSTINs are separate
// registrations ("distinct persons", CGST Act section 25(4)), and goods sent
// between them are a taxable supply even without payment (CGST Act Schedule I
// para 2): the send is invoiced with IGST (other state) or CGST + SGST
// (a second registration in the same state), and posted as output tax of the
// sending registration and input tax of the receiving one in the same entry.
// Stock itself still moves at cost (blueprint 08); the taxable value is that
// cost (the CA confirms it against CGST Rules rule 28 before go-live).
// Official sources: https://taxinformation.cbic.gov.in (CGST Act) and the CBIC
// invoice rules for the delivery challan, https://cbic-gst.gov.in/gst-invoice-rules.html.
import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal, gstNumberProblem, hsnLookupCodes, pickGstRate, roundMoney, roundTo, suggestGst } from 'shared';
import type { Db } from '../audit/audit.service.js';
import type { GstRegistration } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';

const D = (v: { toString(): string } | string | number) => new Decimal(v.toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Ledger entries of the tax on a transfer between registrations. */
export const TRANSFER_TAX_DOCUMENT = 'transfer_tax_invoice';

export interface TransferTaxLine {
  lineId: string;
  hsnCode: string;
  gstRate: Decimal;
  /** Value per basic unit, frozen when the goods were sent. */
  unitValue: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}

export interface TransferTax {
  from: GstRegistration;
  to: GstRegistration;
  interState: boolean;
  /** State code of the place of supply: the receiving store's registration. */
  placeOfSupply: string;
  /** False when the company is under the composition scheme (bill of supply, no tax). */
  taxed: boolean;
  lines: TransferTaxLine[];
  totals: { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal; total: Decimal };
}

interface SendLine {
  id: string;
  itemId: string;
  basicQuantity: { toString(): string };
  valueChange: { toString(): string };
  unitCost: { toString(): string } | null;
}

interface SendDoc {
  id: string;
  companyId: string;
  number: string;
  kind: string;
  postingDate: Date;
  storeId: string;
  toStoreId: string | null;
}

@Injectable()
export class TransferGstService {
  constructor(private readonly ledger: LedgerService) {}

  /** The two registrations when the stores belong to different GSTINs; null when the transfer stays inside one. */
  async registrations(db: Db, fromStoreId: string, toStoreId: string | null): Promise<{ from: GstRegistration; to: GstRegistration } | null> {
    if (!toStoreId) return null;
    const stores = await db.store.findMany({ where: { id: { in: [fromStoreId, toStoreId] } }, include: { gstRegistration: true } });
    const from = stores.find((s) => s.id === fromStoreId)?.gstRegistration;
    const to = stores.find((s) => s.id === toStoreId)?.gstRegistration;
    if (!from || !to || from.id === to.id) return null;
    return { from, to };
  }

  /**
   * Called inside the send's own transaction, after its stock moved (rule 5):
   * freezes each line's value per unit (kept in the send line's unit cost,
   * which a transfer does not otherwise use) and posts the tax.
   */
  async onSend(tx: Db, doc: SendDoc, actorId: string | null): Promise<TransferTax | null> {
    if (doc.kind !== 'transfer_send') return null;
    const regs = await this.registrations(tx, doc.storeId, doc.toStoreId);
    if (!regs) return null;
    // Plan 08 (CGST rule 46(b)): the transfer number is the tax invoice number, so at most 16 characters.
    const numberProblem = gstNumberProblem(doc.number);
    if (numberProblem) throw new BadRequestException(`${numberProblem}. Shorten the transfer number pattern under Numbering, for example TRS/{FYS}/`);
    const lines = await tx.stockDocumentLine.findMany({ where: { documentId: doc.id }, orderBy: { lineNo: 'asc' } });
    for (const l of lines) {
      const basic = D(l.basicQuantity);
      const unitValue = basic.isZero() ? new Decimal(0) : roundTo(D(l.valueChange).abs().div(basic), 4);
      await tx.stockDocumentLine.update({ where: { id: l.id }, data: { unitCost: unitValue.toFixed(4) } });
      l.unitCost = unitValue.toFixed(4) as never;
    }
    const tax = await this.work(tx, doc, lines, regs);
    if (!tax.taxed) return tax;
    const t = tax.totals;
    await this.ledger.post(tx, {
      companyId: doc.companyId,
      date: iso(doc.postingDate),
      documentType: TRANSFER_TAX_DOCUMENT,
      documentId: doc.id,
      documentNumber: doc.number,
      storeId: doc.storeId,
      actorId,
      remark: `GST on transfer ${doc.number} from ${regs.from.gstin} to ${regs.to.gstin}`,
      lines: [
        // Output tax of the sending registration…
        { role: 'gst_output_cgst', storeId: doc.storeId, credit: t.cgst },
        { role: 'gst_output_sgst', storeId: doc.storeId, credit: t.sgst },
        { role: 'gst_output_igst', storeId: doc.storeId, credit: t.igst },
        // …is input credit of the receiving one.
        { role: 'gst_input_cgst', storeId: doc.toStoreId, debit: t.cgst },
        { role: 'gst_input_sgst', storeId: doc.toStoreId, debit: t.sgst },
        { role: 'gst_input_igst', storeId: doc.toStoreId, debit: t.igst },
      ],
    });
    return tax;
  }

  /** Cancelling the send takes its tax back (opposite entries, same date). */
  async onCancel(tx: Db, documentId: string, actorId: string | null): Promise<void> {
    await this.ledger.reverseDocument(tx, TRANSFER_TAX_DOCUMENT, documentId, actorId);
  }

  /** The tax figures of a send already made, for its printed tax invoice; null for a delivery challan. */
  async forPrint(db: Db, doc: SendDoc & { lines: SendLine[] }): Promise<TransferTax | null> {
    if (doc.kind !== 'transfer_send') return null;
    const regs = await this.registrations(db, doc.storeId, doc.toStoreId);
    if (!regs) return null;
    // A draft has no value yet; one sent before this was built has no frozen value: printed as a challan.
    if (doc.lines.some((l) => l.unitCost === null)) return null;
    return this.work(db, doc, doc.lines, regs);
  }

  private async work(db: Db, doc: SendDoc, lines: SendLine[], regs: { from: GstRegistration; to: GstRegistration }): Promise<TransferTax> {
    const settings = await db.gstSettings.findUnique({ where: { companyId: doc.companyId }, select: { scheme: true } });
    const taxed = settings?.scheme !== 'composition';
    const interState = regs.from.stateCode !== regs.to.stateCode;
    const items = new Map((await db.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, select: { id: true, code: true, hsnCode: true } })).map((i) => [i.id, i]));
    const codes = [...new Set([...items.values()].flatMap((i) => (i.hsnCode ? hsnLookupCodes(i.hsnCode) : [])))];
    const rows = (await db.gstRate.findMany({ where: { hsnCode: { in: codes } } })).map((r) => ({
      hsnCode: r.hsnCode,
      rate: r.rate.toString(),
      kind: r.kind,
      priceFrom: r.priceFrom?.toString() ?? null,
      priceUpTo: r.priceUpTo?.toString() ?? null,
      effectiveFrom: iso(r.effectiveFrom),
    }));
    const date = iso(doc.postingDate);
    const zero = new Decimal(0);
    const out: TransferTaxLine[] = [];
    for (const l of lines) {
      const item = items.get(l.itemId)!;
      if (!item.hsnCode) throw new BadRequestException(`${item.code} has no HSN code; goods sent to a store under another GSTIN go on a tax invoice, which needs it`);
      const unitValue = D(l.unitCost ?? 0);
      const taxable = roundMoney(unitValue.mul(D(l.basicQuantity)));
      const rate = taxed ? pickGstRate(rows, item.hsnCode, date, unitValue) : null;
      if (taxed && !rate) throw new BadRequestException(`No GST rate is set for HSN ${item.hsnCode} (${item.code}) on ${date}; add it to the GST rate list`);
      const gstRate = rate ? D(rate.rate) : zero;
      const split = taxed && rate?.kind !== 'exempt' && rate?.kind !== 'nil' ? suggestGst(taxable, gstRate, interState) : { cgst: zero, sgst: zero, igst: zero };
      out.push({ lineId: l.id, hsnCode: item.hsnCode, gstRate, unitValue, taxable, cgst: D(split.cgst), sgst: D(split.sgst), igst: D(split.igst) });
    }
    const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst') => out.reduce((s, l) => s.add(l[k]), zero);
    const totals = { taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), total: zero };
    totals.total = totals.taxable.add(totals.cgst).add(totals.sgst).add(totals.igst);
    return { from: regs.from, to: regs.to, interState, placeOfSupply: regs.to.stateCode, taxed, lines: out, totals };
  }
}
