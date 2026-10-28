// Copyright (c) 2026, Rademics. All rights reserved.
// Shapes and small helpers for the GST return screens (module 8, plan 08 §3).
// The shapes mirror apps/api/src/reports/gst-returns.service.ts. Money arrives
// as decimal strings and stays that way (rule 1).
import { type Gstr1B2csRow, type Gstr1HsnRow, type Gstr1Invoice, type Gstr1Item, type Gstr1NilRow, gstReturnPeriod, INDIAN_STATES, previousReturnPeriod } from "shared";

export interface GstRegistrationOption {
  id: string;
  gstin: string;
  stateCode: string;
  isDefault: boolean;
  active: boolean;
  stores: { id: string; code: string; name: string }[];
}

export interface GstRegistrationsDto {
  filingFrequency: string;
  currentPeriod: string;
  registrations: GstRegistrationOption[];
}

export interface GstHeader {
  gstin: string;
  gstRegistrationId: string;
  stateCode: string;
  period: string;
  periodLabel: string;
  from: string;
  to: string;
  fp: string;
  filingFrequency: string;
  workedOutAt: string;
}

export interface Figures {
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
  tax: string;
}

export interface SalesRegisterRow extends Figures {
  billId: string;
  /** till: a till bill; transfer: goods sent to a store under another GSTIN of the company. */
  source: "till" | "transfer";
  number: string;
  date: string;
  kind: "invoice" | "credit_note";
  invoiceKind: string;
  store: string;
  buyerGstin: string | null;
  buyerName: string | null;
  placeOfSupply: string;
  interState: boolean;
  section: string;
  original: { number: string; date: string } | null;
  value: string;
  provisional: boolean;
}

export interface SalesRegisterDto extends GstHeader {
  rows: SalesRegisterRow[];
  totals: Figures & { documents: number; value: string };
  warnings: string[];
}

export interface Gstr1NoteRow extends Gstr1Invoice {
  noteType: "C" | "D";
  originalNumber: string | null;
  originalDate: string | null;
  late: boolean;
}

export interface Gstr1DocumentRow {
  nature: number;
  natureLabel: string;
  series: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
  net: number;
  missing: number;
}

export interface Gstr1Dto extends GstHeader {
  /** Audit 4: a quarterly filer's month (business invoices only); invoices left out because filed in an IFF. */
  iff?: boolean;
  filedInIff?: number;
  b2b: Gstr1Invoice[];
  b2cl: Gstr1Invoice[];
  b2cs: Gstr1B2csRow[];
  cdnr: Gstr1NoteRow[];
  cdnur: Gstr1NoteRow[];
  nil: Gstr1NilRow[];
  hsnBusiness: Gstr1HsnRow[];
  hsnConsumer: Gstr1HsnRow[];
  documents: Gstr1DocumentRow[];
  smallSales: (Figures & { date: string; store: string; bills: number; value: string })[];
  combineSmallSales: boolean;
  excludedBills: number;
  reconciliation: {
    register: Figures;
    sections: Record<string, Figures>;
    sectionsTotal: Figures;
    sectionsAgree: boolean;
    hsnTotal: Figures;
    hsnAgrees: boolean;
    documentsNet: number;
    registerDocuments: number;
    documentsAgree: boolean;
  };
  warnings: string[];
}

export interface HeadAmounts {
  igst: string;
  cgst: string;
  sgst: string;
  total: string;
}

export interface Gstr3bDto extends GstHeader {
  outward: { taxable: Figures; zeroRated: Figures; nilExempt: string; reverseChargeInward: Figures; nonGst: string };
  interStateUnregistered: { placeOfSupply: string; taxable: string; igst: string }[];
  outputTaxFromBills: HeadAmounts;
  outputTaxFromAccounts: HeadAmounts;
  credit: {
    reverseCharge: HeadAmounts;
    allOther: HeadAmounts;
    reversed: HeadAmounts;
    net: HeadAmounts;
    ineligible: HeadAmounts;
    /** Audit 4 (T11): past the s.16(4) limit; not in GSTR-2B (held back); held back earlier, now in GSTR-2B. */
    timeBarred?: HeadAmounts;
    notInGstr2b?: HeadAmounts;
    fromEarlierGstr2b?: HeadAmounts;
    gstr2bImported?: boolean;
    broughtForward: HeadAmounts;
    available: HeadAmounts;
  };
  /** Audit 4 (T13): a composition dealer's quarterly statement (CMP-08) instead of GSTR-3B. */
  composition?: {
    period: string;
    periodLabel: string;
    outward: { taxable: string; exempt: string; rate: string; cgst: string; sgst: string };
    reverseCharge: Figures;
    payable: HeadAmounts;
    note: string;
  } | null;
  /** Table 5: purchases with no GST (nil-rated, exempt, from composition suppliers). */
  inwardNoTax?: { interState: string; intraState: string };
  setOff: { steps: { credit: "igst" | "cgst" | "sgst"; against: "igst" | "cgst" | "sgst"; amount: string }[]; paidByCredit: HeadAmounts; cash: HeadAmounts };
  reverseChargePayable: HeadAmounts;
  netPayable: HeadAmounts;
  totalPayable: string;
  creditCarriedForward: HeadAmounts;
  notes: string[];
}

export interface NoteRegisterRow extends Figures {
  billId: string;
  kind: "credit_note" | "debit_note";
  number: string;
  date: string;
  store: string;
  party: string;
  originalNumber: string | null;
  originalDate: string | null;
  deadline: string | null;
  status: "ok" | "near" | "late" | "no_original";
  section: string;
  value: string;
}

export interface NotesRegisterDto extends GstHeader {
  rows: NoteRegisterRow[];
  totals: { creditNotes: number; debitNotes: number; late: number; near: number };
}

export type { Gstr1B2csRow, Gstr1HsnRow, Gstr1Invoice, Gstr1Item, Gstr1NilRow };

/** "29 Karnataka". */
export function stateText(code: string | null | undefined): string {
  if (!code) return "—";
  return INDIAN_STATES[code] ? `${code} ${INDIAN_STATES[code]}` : code;
}

/** The periods to choose from, newest first: the current one and the ones before it. */
export function periodOptions(currentPeriod: string, count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let p = currentPeriod;
  for (let i = 0; i < count && gstReturnPeriod(p); i++) {
    out.push({ value: p, label: `${gstReturnPeriod(p)!.label}${i === 0 ? " (so far)" : ""}` });
    p = previousReturnPeriod(p);
  }
  return out;
}

/** The period usually being filed: the one before the current one. */
export function defaultPeriod(currentPeriod: string): string {
  return previousReturnPeriod(currentPeriod);
}

export const SECTION_LABELS: Record<string, string> = {
  b2b: "B2B",
  b2cl: "B2C large",
  b2cs: "B2C small",
  cdnr: "Credit note (registered)",
  cdnur: "Credit note (unregistered)",
  excluded: "Bill of supply (not reported)",
  nil: "Nil-rated and exempt",
  purchase: "Purchase return",
};

export const NOTE_STATUS_LABELS: Record<NoteRegisterRow["status"], string> = {
  ok: "In time",
  near: "Within 30 days of the deadline",
  late: "After the deadline: tax cannot be reduced",
  no_original: "No original bill",
};

export const HEAD_NAMES = { igst: "IGST", cgst: "CGST", sgst: "SGST" } as const;
