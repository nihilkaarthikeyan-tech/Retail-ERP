// Copyright (c) 2026, Rademics. All rights reserved.
// Plain words for the change and login history (found in the launch check of
// 27 October 2026: the screens showed codes such as "login_failed", "number_series"
// and internal record numbers).

export const ACTION_NAMES: Record<string, string> = {
  create: "Added",
  update: "Changed",
  setup: "Set up the shop",
  export: "Downloaded a report",
  print: "Printed",
  login: "Logged in",
  logout: "Logged out",
  login_failed: "Login refused",
  login_locked: "Locked after wrong passwords",
  password_change: "Changed own password",
  password_reset: "Set a temporary password",
  password_reset_requested: "Asked for a password link",
  email_confirmed: "Confirmed email",
  sessions_ended: "Ended sessions",
  counter_change: "Changed a document counter",
};

export const RECORD_NAMES: Record<string, string> = {
  account: "Account",
  account_default: "Default account",
  accounting_settings: "Accounts settings",
  address: "Address",
  alteration_job: "Alteration",
  bank_account: "Bank account",
  barcode: "Barcode",
  brand: "Brand",
  cash_movement: "Cash in / out",
  company: "Company",
  company_module: "Module",
  consignment_statement: "Sale-or-return statement",
  contact: "Contact",
  coupon: "Coupon",
  customer: "Customer",
  customer_group: "Customer group",
  customer_order: "Customer order",
  e_invoice: "E-invoice",
  e_way_bill: "E-way bill",
  expense: "Expense",
  financial_year: "Financial year",
  gift_card: "Gift card",
  gift_card_entry: "Gift card entry",
  gift_card_expiry: "Gift card expiry",
  goods_receipt: "Goods receipt",
  gst_rate: "GST rate",
  gst_registration: "GST registration",
  gst_return_upload: "GST return file",
  gst_settings: "GST settings",
  hsn_code: "HSN code",
  import: "Import",
  item: "Item",
  item_group: "Item group",
  journal: "Journal",
  label_template: "Label template",
  labels: "Labels",
  landed_charge: "Freight and charges",
  list: "List",
  loyalty_expiry: "Points expiry",
  loyalty_tier: "Loyalty tier",
  markdown: "Markdown",
  number_series: "Document numbering",
  offer: "Offer",
  opening_bill: "Opening bill",
  payment: "Payment",
  payment_method: "Payment method",
  payment_terms: "Payment terms",
  pos_approval: "Manager approval",
  pos_bill: "Till bill",
  pos_delivery: "Home delivery",
  price: "Price",
  price_list: "Price list",
  print_settings: "Print settings",
  purchase_order: "Purchase order",
  purchase_tax_register: "Purchase tax register",
  reorder_level: "Reorder level",
  report: "Report",
  role: "Role",
  role_permissions: "Role rights",
  sales_staff: "Salesperson",
  season: "Season",
  settlement: "Card / UPI settlement",
  shift: "Till shift",
  standard_terms: "Standard terms",
  stock_document: "Stock document",
  stock_location: "Stock location",
  store: "Store",
  summary_email_settings: "Daily summary email",
  supplier: "Supplier",
  supplier_bill: "Supplier bill",
  supplier_group: "Supplier group",
  tally_ledger_map: "Tally ledger name",
  till: "Till",
  till_cashier: "Till cashier",
  till_device: "Till computer",
  trial_data: "Test data",
  unit: "Unit",
  unit_conversion: "Unit conversion",
  user: "User",
  user_pin: "Till PIN",
  variant_attribute: "Size / colour list",
  year_end_closing: "Year-end closing",
};

const REASONS: Record<string, string> = {
  wrong_password: "wrong password",
  inactive: "the login is switched off",
  shop_switched_off: "the shop is switched off",
  locked: "locked after wrong passwords",
  unknown_email: "no such email",
};

export const actionName = (action: string): string => ACTION_NAMES[action] ?? action;
export const recordName = (type: string): string => RECORD_NAMES[type] ?? type;
export const reasonName = (reason: string): string => REASONS[reason] ?? reason;

/** "failedLoginCount" → "Failed login count", "allStores" → "All stores", "gstin" stays upper-case. */
export function fieldName(field: string): string {
  if (/^(gstin|pan|hsn|ifsc|upi)$/i.test(field)) return field.toUpperCase();
  const words = field
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\bid$/, "")
    .replace(/\bids$/, "")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LOCAL = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1"]);

/** The address a change came from; the server's own address in plain words. */
export const addressName = (ip: string | null): string => (!ip ? "—" : LOCAL.has(ip) ? "This server" : ip.replace(/^::ffff:/, ""));

/** "Chrome on Windows" from a browser's technical identifier (the full text stays in a tooltip). */
export function browserName(userAgent: string | null): string {
  if (!userAgent) return "—";
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const system = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  return system ? `${browser} on ${system}` : browser;
}
