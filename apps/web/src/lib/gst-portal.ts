// Copyright (c) 2026, Rademics. All rights reserved.
// E-invoice and e-way bill files (plan 08 §4): what the API sends back, labels,
// and saving an exported file. The rules themselves live in the API and shared.
import { INDIAN_STATES } from "shared";

export type EInvoiceStatus = "waiting" | "registered" | "failed" | "cancelled";
export type EWayStatus = "draft" | "generated" | "cancelled" | "expired";

export interface EInvoiceRow {
  id: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  documentKind: "Invoice" | "Credit note";
  documentDate: string;
  store: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  total: string | null;
  billCancelled: boolean;
  status: EInvoiceStatus;
  irn: string | null;
  ackNumber: string | null;
  ackDate: string | null;
  error: string | null;
  exportedAt: string | null;
  registeredAt: string | null;
  cancelledAt: string | null;
  lastDay: string | null;
  nearLimit: boolean;
  canCancel: boolean;
}

export interface EInvoiceList {
  applies: boolean;
  thirtyDayLimit: boolean;
  counts: Record<EInvoiceStatus | "near_limit", number>;
  rows: EInvoiceRow[];
}

export interface EWayRow {
  id: string;
  documentType: "pos_bill" | "stock_document";
  documentId: string;
  documentNumber: string;
  documentKind: "Transfer" | "Bill";
  documentDate: string;
  fromState: string | null;
  toState: string | null;
  to: string | null;
  value: string;
  distanceKm: number | null;
  validityDays: number | null;
  transporterId: string | null;
  transporterName: string | null;
  vehicleNo: string | null;
  status: EWayStatus;
  number: string | null;
  generatedAt: string | null;
  validUntil: string | null;
  expiring: boolean;
  canCancel: boolean;
  error: string | null;
}

export interface EWayList {
  counts: Partial<Record<EWayStatus | "expiring", number>>;
  rows: EWayRow[];
}

export interface EWayNeeded {
  documentType: "pos_bill" | "stock_document";
  documentId: string;
  number: string;
  date: string;
  value: string;
  fromState: string;
  toState: string;
  limit: string;
}

export interface ExportResult {
  fileName: string | null;
  content: string | null;
  count: number;
  skipped: { id: string; documentNumber: string; problems: string[] }[];
}

export const EINVOICE_STATUS: Record<EInvoiceStatus, { label: string; kind: "warn" | "ok" | "off" | "neutral" }> = {
  waiting: { label: "Waiting", kind: "warn" },
  registered: { label: "Registered", kind: "ok" },
  failed: { label: "Failed", kind: "off" },
  cancelled: { label: "Cancelled", kind: "neutral" },
};

export const EWAY_STATUS: Record<EWayStatus, { label: string; kind: "warn" | "ok" | "off" | "neutral" }> = {
  draft: { label: "Draft", kind: "warn" },
  generated: { label: "Made", kind: "ok" },
  expired: { label: "Expired", kind: "off" },
  cancelled: { label: "Cancelled", kind: "neutral" },
};

/** "Tamil Nadu (33)". */
export function stateName(code: string | null | undefined): string {
  if (!code) return "—";
  return `${INDIAN_STATES[code] ?? code} (${code})`;
}

/** The print page of the document behind an e-invoice or e-way bill. */
export function documentPrintHref(documentType: string, documentId: string): string {
  return documentType === "stock_document" ? `/print/transfer/${documentId}` : `/print/pos_bill/${documentId}`;
}

/** Hands an exported JSON file to the browser to save. */
export function saveTextFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "datetime-local" input value (Indian time) → an ISO instant with the +05:30 offset. */
export function indianDateTime(local: string): string | undefined {
  if (!local) return undefined;
  return `${local.length === 16 ? `${local}:00` : local}+05:30`;
}
