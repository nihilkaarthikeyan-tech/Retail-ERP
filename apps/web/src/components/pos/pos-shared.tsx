// Copyright (c) 2026, Rademics. All rights reserved.
// Shapes, labels and small helpers for the back-office till screens (module 6).
"use client";

import { type CurrentUser, hasPermission } from "shared";
import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import type { StoreRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export type PaymentKind = "cash" | "card" | "upi" | "other" | "on_account";

export interface PaymentMethodDto {
  id: string;
  code: string;
  name: string;
  kind: PaymentKind;
  allowRefund: boolean;
  needsReference: boolean;
  accountRole: string;
  /** Plan 13: what the method is used for ('points' and 'gift_card' have their own buttons at the till). */
  use?: string;
  active: boolean;
}

export interface TillDto {
  id: string;
  code: string;
  name: string;
  store: StoreRef;
  locationId: string;
  priceListId: string;
  numberPrefix: string;
  cashierDiscountPercent: string;
  allowPriceChange: boolean;
  autoPrint: boolean;
  receiptFooter: string | null;
  active: boolean;
  paymentMethods: { paymentMethodId: string; isDefault: boolean }[];
  devices: { id: string; deviceName: string; lastSeenAt: string | null }[];
}

export interface GstRateDto {
  id: string;
  hsnCode: string;
  rate: string;
  cessRate: string;
  /** Plan 08 G2: taxable, exempt or nil; a price band on the value per unit before GST (decision L7). */
  kind?: "taxable" | "exempt" | "nil";
  priceFrom?: string | null;
  priceUpTo?: string | null;
  effectiveFrom: string;
  note: string | null;
}

export interface PosSettingsDto {
  cashDifferenceApprovalAmount: string;
  printReceiptCopies: number;
  liveAllowed: boolean;
  /** Plan 11 B4: the service item the delivery charge is billed as. */
  deliveryItemId?: string | null;
  /** Plan 11 part 2: the service item an alteration charge is billed as. */
  alterationItemId?: string | null;
}

export type OfferKind = "percent" | "amount" | "special_price" | "free_goods" | "buy_get" | "mix_match";
export type OfferTarget = "items" | "groups" | "brands" | "bill";

export interface OfferDto {
  id: string;
  code: string;
  name: string;
  kind: OfferKind;
  appliesTo: OfferTarget;
  targetIds: string[];
  value: string | null;
  buyQuantity: string | null;
  freeQuantity: string | null;
  /** Plan 11 B3: buy_get gives this item free; mix_match sets of setQuantity for setPrice, or the cheapest free. */
  freeItemId?: string | null;
  setQuantity?: number | null;
  setPrice?: string | null;
  cheapestFree?: boolean;
  minQuantity: string | null;
  minAmount: string | null;
  storeIds: string[];
  customerGroupId: string | null;
  startDate: string;
  endDate: string | null;
  priority: number;
  couponOnly: boolean;
  active: boolean;
}

export interface CouponDto {
  id: string;
  code: string;
  offerId: string;
  startDate: string;
  endDate: string | null;
  maxUses: number | null;
  usedCount: number;
  customerId: string | null;
}

export interface PosBillLineDto {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string; hsnCode: string | null };
  quantity: string;
  returnedQuantity: string;
  serialNumbers: string[];
  mrp: string | null;
  listPrice: string;
  price: string;
  discountPercent: string;
  discountAmount: string;
  offerDiscount: string;
  offerId: string | null;
  /** Plan 11 B3, C1: the offer's name and the line's salesperson. */
  offerName?: string | null;
  salesStaff?: { code: string; name: string } | null;
  isFree: boolean;
  gstRate: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
  returnOfLineId: string | null;
  approvedById: string | null;
}

export interface PosBillDto {
  id: string;
  number: string;
  kind: "sale" | "return";
  /** Plan 08: invoice kind, title, buyer, place of supply and the credit-note deadline flag. */
  invoiceKind?: string;
  documentTitle?: string;
  buyerGstin?: string | null;
  buyerName?: string | null;
  placeOfSupply?: string | null;
  creditNoteLate?: boolean;
  status: "completed" | "cancelled";
  till: { id: string; code: string; name: string };
  shiftId: string;
  /** False once the shift is closed: then only a return can undo the bill. */
  shiftOpen?: boolean;
  returnOfId: string | null;
  exchangeId: string | null;
  customerId: string | null;
  cashierId: string;
  soldAt: string;
  businessDate: string;
  grossAmount: string;
  discountAmount: string;
  billDiscount: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundingAdjustment: string;
  total: string;
  changeAmount: string;
  offline: boolean;
  checkFlags: string[];
  gstProvisional: boolean;
  returnReason: string | null;
  cancelReason: string | null;
  reprints: number;
  /** Plan 11: the salesperson, the offers used and their saving, home delivery. */
  salesStaff?: { code: string; name: string } | null;
  offers?: { id: string; code: string | null; name: string; saving: string }[];
  delivery?: { id: string; name: string | null; address: string; phone: string | null; deliverOn: string | null; status: string; chargeAmount: string; deliveredAt: string | null } | null;
  lines: PosBillLineDto[];
  payments: { paymentMethod: { id: string; code: string; name: string; kind: PaymentKind }; amount: string; reference: string | null }[];
}

export interface BillPage {
  rows: PosBillDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /pos/bills/:id/reprint: what the receipt shows. */
export interface ReceiptDto {
  billId: string;
  number: string;
  kind: "sale" | "return";
  duplicate: boolean;
  provisional: boolean;
  soldAt: string;
  till: string;
  footer: string | null;
  lines: { name: string; code: string; hsn: string | null; quantity: string; price: string; discount: string; amount: string; free: boolean; serials: string[] }[];
  gstTable: { rate: string; taxable: string; cgst: string; sgst: string; igst: string }[];
  totals: { gross: string; discount: string; taxable: string; rounding: string; total: string };
  payments: { method: string; amount: string; reference: string | null }[];
  change: string;
}

/** Who may approve or sell at a till (GET /pos/tills/:id/people). Only people with a PIN are listed. */
export interface TillPeople {
  managers: { id: string; name: string }[];
  cashiers: { id: string; name: string }[];
}

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
  on_account: "On account",
};

export const OFFER_KIND_LABELS: Record<OfferKind, string> = {
  percent: "Percentage off",
  amount: "Rupees off",
  special_price: "Special price",
  free_goods: "Buy some, get some free",
  buy_get: "Buy some, get another item free",
  mix_match: "Mix and match (any N)",
};

export const OFFER_TARGET_LABELS: Record<OfferTarget, string> = {
  items: "Chosen items",
  groups: "Item groups",
  brands: "Brands",
  bill: "The whole bill",
};

/** Check flags on a bill, in plain words. */
export const FLAG_LABELS: Record<string, string> = {
  price_changed: "Price changed while the till was offline",
  offer_changed: "Offer changed while the till was offline",
  gst_changed: "GST rate changed while the till was offline",
  price_missing: "Item had no price on the server; the till's price was kept",
  stock_negative: "Stock went below zero",
  gst_provisional: "GST provisional (an older bill, saved before GST rates applied as soon as saved)",
  credit_note_late: "Credit note after the GST time limit (30 November): tax not reduced in the return",
  buyer_details_missing: "Buyer details a GST invoice needs were missing (made offline)",
  expired_batch: "An expired batch was sold while offline",
  serial_not_in_stock: "A serial number was not in stock at this till",
  shift_date: "Sold offline on a shift from another day",
  customer_matched_by_mobile: "New customer matched an existing one by mobile number",
  customer_dates_left_out: "The new customer's birthday or anniversary was not a real date and was left out",
  before_lock: "Stock posted on the next open day (month was locked)",
  sales_staff_changed: "Salesperson was switched off or moved to another store while the till was offline",
  delivery_charge_changed: "Delivery charge changed while the till was offline; the till's charge was kept",
  module_off: "Used a module that was switched off in Settings → My modules while the till was offline",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag.replace(/_/g, " ");
}

export function FlagBadges({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="muted">—</span>;
  return (
    <span className="row-actions">
      {flags.map((f) => (
        <Badge key={f} kind={f === "gst_provisional" ? "neutral" : "warn"}>
          {flagLabel(f)}
        </Badge>
      ))}
    </span>
  );
}

/** Rights in plain names, matching the API checks. */
export function posRights(user: CurrentUser | null) {
  return {
    setup: hasPermission(user, "pos.setup"),
    sell: hasPermission(user, "pos.sell"),
    approve: hasPermission(user, "pos.approve"),
    reports: hasPermission(user, "pos.reports"),
    shiftManage: hasPermission(user, "pos.shift.manage"),
    offers: hasPermission(user, "offers.manage"),
    gstManage: hasPermission(user, "gst_rates.manage"),
    owner: !!user?.isOwnerAdmin,
  };
}

export function useTills() {
  return useLoad(() => api.get<TillDto[]>("/pos/tills"));
}

export function usePaymentMethods() {
  return useLoad(() => api.get<PaymentMethodDto[]>("/pos/payment-methods"));
}

/** localStorage key holding the Till Helper pairing code typed on this computer. */
export const TILL_HELPER_TOKEN_KEY = "retail-erp:till-helper-token";
