// Copyright (c) 2026, Rademics. All rights reserved.
import { type CurrentUser, hasPermission, type ModuleKey, type PermissionKey } from "shared";
import type { IconName } from "@/components/icons";

export interface MenuEntry {
  href: string;
  label: string;
  /** Any of these rights shows the entry; none means everyone logged in. */
  permissions?: PermissionKey[];
  /** Only Owner/Admin sees the entry (matches the API's OwnerAdminOnly guard). */
  ownerAdminOnly?: boolean;
  /** Heading the entry sits under; entries without one come first. */
  section?: string;
  /** Active only on its own path, not on sub-paths (e.g. /stock vs /stock/documents). */
  exact?: boolean;
  /** Small picture shown before the label. */
  icon: IconName;
  /** Plan 12: the optional module the page belongs to; hidden while that module is switched off. */
  module?: ModuleKey;
}

/** Colour family of each menu section (see the area-* classes in globals.css). */
export type MenuArea = "sales" | "stock" | "purchase" | "accounts" | "admin";

const SECTION_AREA: Record<string, MenuArea> = {
  Catalogue: "sales",
  Parties: "accounts",
  Purchases: "purchase",
  "Billing counter": "sales",
  Inventory: "stock",
  Accounts: "accounts",
  Reports: "sales",
  "Printing and data": "admin",
  Administration: "admin",
};

/** Colour family for a section; entries without a section use the sales colour. */
export function areaOf(section: string | undefined): MenuArea {
  return (section && SECTION_AREA[section]) || "sales";
}

export const MENU: MenuEntry[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  // Module 2
  { href: "/items", label: "Items", permissions: ["catalogue.view"], section: "Catalogue", icon: "box" },
  { href: "/catalogue/item-groups", label: "Item groups", permissions: ["catalogue.view"], section: "Catalogue", icon: "folder" },
  { href: "/catalogue/brands", label: "Brands", permissions: ["catalogue.view"], section: "Catalogue", icon: "tag" },
  { href: "/catalogue/units", label: "Units", permissions: ["catalogue.view"], section: "Catalogue", icon: "ruler" },
  { href: "/catalogue/attributes", label: "Attributes", permissions: ["catalogue.view"], section: "Catalogue", icon: "sliders", module: "variants" },
  { href: "/catalogue/hsn-codes", label: "HSN codes", permissions: ["catalogue.view"], section: "Catalogue", icon: "receipt" },
  // Plan 11 C4, C5
  { href: "/catalogue/seasons", label: "Seasons", permissions: ["catalogue.view"], section: "Catalogue", icon: "calendar", module: "seasons" },
  { href: "/price-lists", label: "Price lists", permissions: ["prices.view"], section: "Catalogue", icon: "list" },
  { href: "/prices", label: "Prices", permissions: ["prices.view"], section: "Catalogue", icon: "rupee" },
  { href: "/markdowns", label: "Markdowns", permissions: ["prices.view"], section: "Catalogue", icon: "percent", module: "seasons" },
  // Module 3
  { href: "/customers", label: "Customers", permissions: ["customers.view"], section: "Parties", icon: "users" },
  { href: "/customers/birthdays", label: "Birthdays this week", permissions: ["customers.view"], section: "Parties", icon: "calendar" },
  { href: "/suppliers", label: "Suppliers", permissions: ["suppliers.view"], section: "Parties", icon: "truck" },
  { href: "/customer-groups", label: "Customer groups", permissions: ["customers.view"], section: "Parties", icon: "folder" },
  { href: "/supplier-groups", label: "Supplier groups", permissions: ["suppliers.view"], section: "Parties", icon: "folder" },
  { href: "/payment-terms", label: "Payment terms", permissions: ["customers.view"], section: "Parties", icon: "calendar" },
  // Module 4
  { href: "/stock", label: "Stock on hand", permissions: ["stock.view"], section: "Inventory", exact: true, icon: "layers" },
  { href: "/stock/documents", label: "Stock documents", permissions: ["stock.view"], section: "Inventory", icon: "file" },
  { href: "/stock/transfers", label: "In transit", permissions: ["stock.view"], section: "Inventory", icon: "transfer", module: "transfers" },
  { href: "/stock/ledger", label: "Stock history", permissions: ["stock.view"], section: "Inventory", icon: "history" },
  { href: "/stock/batches", label: "Batches", permissions: ["stock.view"], section: "Inventory", icon: "clock", module: "batches" },
  { href: "/stock/exceptions", label: "Negative stock", permissions: ["stock.view"], section: "Inventory", icon: "alert" },
  { href: "/stock/locations", label: "Locations", permissions: ["stock.view"], section: "Inventory", icon: "pin" },
  { href: "/stock/reorder-levels", label: "Reorder levels", permissions: ["stock.view"], section: "Inventory", icon: "refresh" },
  // Module 5
  { href: "/purchases/orders", label: "Purchase orders", permissions: ["purchase.view"], section: "Purchases", icon: "file", module: "purchase_orders" },
  { href: "/purchases/receipts", label: "Goods receipts", permissions: ["purchase.view"], section: "Purchases", icon: "truck" },
  { href: "/purchases/bills", label: "Supplier bills", permissions: ["purchase.view"], section: "Purchases", icon: "receipt" },
  { href: "/purchases/charges", label: "Freight and charges", permissions: ["purchase.view"], section: "Purchases", icon: "rupee" },
  // Plan 11 part 2: supplier sale-or-return
  { href: "/purchases/consignment", label: "Sale or return", permissions: ["purchase.view"], section: "Purchases", icon: "layers", module: "consignment" },
  { href: "/purchases/reorder", label: "Reorder suggestions", permissions: ["purchase.view"], section: "Purchases", icon: "refresh" },
  { href: "/purchases/reports", label: "Purchase reports", permissions: ["purchase.view"], section: "Purchases", icon: "list" },
  // Plan 08 §3: GST on purchases.
  { href: "/purchases/tax-register", label: "Purchase tax register", permissions: ["gst.input_credit"], section: "Purchases", icon: "receipt" },
  { href: "/purchases/input-credit", label: "Input credit matching", permissions: ["gst.input_credit"], section: "Purchases", icon: "upload" },
  // Module 6
  { href: "/till", label: "Open the till", permissions: ["pos.sell"], section: "Billing counter", icon: "receipt" },
  { href: "/pos/bills", label: "Till bills", permissions: ["pos.sell", "pos.reports"], section: "Billing counter", icon: "list" },
  { href: "/pos/reports", label: "Till reports", permissions: ["pos.reports"], section: "Billing counter", icon: "history" },
  { href: "/pos/offers", label: "Offers and coupons", permissions: ["offers.manage"], section: "Billing counter", icon: "tag", module: "offers" },
  { href: "/pos/sales-staff", label: "Sales staff", permissions: ["sales_staff.manage"], section: "Billing counter", icon: "users", module: "salesperson" },
  { href: "/pos/deliveries", label: "Home deliveries", permissions: ["deliveries.manage"], section: "Billing counter", icon: "truck", module: "delivery" },
  // Plan 11 part 2
  { href: "/orders", label: "Customer orders", permissions: ["orders.manage"], section: "Billing counter", icon: "file", module: "customer_orders" },
  { href: "/alterations", label: "Alterations", permissions: ["alterations.manage"], section: "Billing counter", icon: "ruler", module: "alterations" },
  { href: "/pos/tills", label: "Tills", permissions: ["pos.setup"], section: "Billing counter", icon: "devices" },
  { href: "/pos/payment-methods", label: "Payment methods", permissions: ["pos.setup"], section: "Billing counter", icon: "rupee" },
  { href: "/pos/gst-rates", label: "GST rates", permissions: ["gst_rates.manage", "gst_rates.approve"], section: "Billing counter", icon: "percent" },
  { href: "/pos/my-pin", label: "My till PIN", permissions: ["pos.sell", "pos.approve"], section: "Billing counter", icon: "key" },
  // Module 7
  { href: "/accounts", label: "Chart of accounts", permissions: ["accounts.view", "accounts.manage"], section: "Accounts", exact: true, icon: "book" },
  { href: "/accounts/journals", label: "Journals", permissions: ["accounts.view", "journals.post", "cash.deposit"], section: "Accounts", icon: "file" },
  { href: "/accounts/expenses", label: "Expenses", permissions: ["expenses.post", "accounts.view"], section: "Accounts", icon: "rupee", module: "expenses" },
  { href: "/accounts/payments", label: "Receipts and payments", permissions: ["accounts.view", "payments.post", "cash.deposit"], section: "Accounts", icon: "rupee" },
  { href: "/accounts/banks", label: "Bank accounts", permissions: ["accounts.view", "accounts.manage"], section: "Accounts", icon: "bank" },
  { href: "/accounts/opening", label: "Opening balances", permissions: ["accounts.view", "journals.post"], section: "Accounts", icon: "calendar" },
  { href: "/accounts/reports", label: "Accounts reports", permissions: ["accounts.view", "payments.post"], section: "Accounts", icon: "list" },
  { href: "/accounts/closing", label: "Closing the books", permissions: ["accounts.view", "books.lock"], section: "Accounts", icon: "lock" },
  { href: "/accounts/defaults", label: "Default accounts", permissions: ["accounts.view", "accounts.manage"], section: "Accounts", icon: "settings" },
  // Module 8: GST returns (plan 08 §3)
  { href: "/reports/gst", label: "GST returns", permissions: ["gst.returns"], section: "Accounts", icon: "percent" },
  { href: "/accounts/tally", label: "Export to Tally", permissions: ["tally.export", "accounts.manage"], section: "Accounts", icon: "file", module: "tally" },
  // Plan 08 §4: e-invoice and e-way bill files.
  { href: "/gst/e-invoices", label: "E-invoices", permissions: ["einvoice.manage"], section: "Accounts", icon: "receipt", module: "einvoice" },
  { href: "/gst/e-way-bills", label: "E-way bills", permissions: ["eway.manage"], section: "Accounts", icon: "truck", module: "eway" },
  // Module 9
  { href: "/reports", label: "All reports", permissions: ["pos.reports", "stock.view", "purchase.view", "accounts.view", "payments.post", "cost_price.view", "stock.cost.view", "gst.returns"], section: "Reports", icon: "chart" },
  { href: "/reports/summary-email", label: "Daily summary email", permissions: ["reports.summary_email"], section: "Reports", icon: "mail" },
  // Module 10
  { href: "/labels", label: "Labels", permissions: ["labels.print"], section: "Printing and data", icon: "barcode" },
  { href: "/imports", label: "Import from Excel", permissions: ["import.masters", "import.opening"], section: "Printing and data", icon: "upload" },
  { href: "/labels/templates", label: "Label templates", permissions: ["print.settings"], section: "Printing and data", icon: "tag" },
  // Module 1 set-up pages, kept at the bottom of the menu
  { href: "/company", label: "Company", permissions: ["company.view"], section: "Administration", icon: "building" },
  { href: "/stores", label: "Stores", permissions: ["stores.view"], section: "Administration", icon: "store" },
  { href: "/financial-years", label: "Financial years", permissions: ["financial_years.manage"], section: "Administration", icon: "calendar" },
  { href: "/numbering", label: "Document numbering", permissions: ["numbering.manage"], section: "Administration", icon: "hash" },
  { href: "/users", label: "Users", permissions: ["users.view"], section: "Administration", icon: "user" },
  { href: "/roles", label: "Roles", permissions: ["roles.manage"], section: "Administration", icon: "shield" },
  { href: "/history", label: "Change history", permissions: ["audit.view"], section: "Administration", icon: "history" },
  { href: "/history/logins", label: "Login history", permissions: ["audit.view"], section: "Administration", icon: "login" },
  { href: "/go-live", label: "Going live", ownerAdminOnly: true, section: "Administration", icon: "flag" },
  // Plan 12 §5: one Settings page; the older settings screens (catalogue, parties, inventory,
  // purchases, till, GST, printing) are reached from it.
  { href: "/settings", label: "Settings", permissions: ["stock.lock", "purchase.settings", "pos.setup", "gst_rates.manage", "gst_rates.approve", "print.settings", "reports.summary_email"], section: "Administration", exact: true, icon: "settings" },
  // Plan 12: optional modules on and off, and the shop type
  { href: "/settings/modules", label: "My modules", ownerAdminOnly: true, section: "Administration", icon: "sliders" },
  { href: "/sessions", label: "My sessions", section: "Administration", icon: "devices" },
];

/**
 * The entries this user may open. `modules` is the company's on/off map (plan 12):
 * an entry of a switched-off module is hidden; without a map (or a key) it shows.
 */
export function visibleMenu(user: CurrentUser | null, modules?: Partial<Record<ModuleKey, boolean>>): MenuEntry[] {
  if (!user) return [];
  return MENU.filter((entry) => {
    if (entry.module && modules?.[entry.module] === false) return false;
    if (entry.ownerAdminOnly) return user.isOwnerAdmin;
    return !entry.permissions || entry.permissions.some((key) => hasPermission(user, key));
  });
}

/** Entry is active for its own path and for sub-paths (except the dashboard). */
export function isActive(entry: MenuEntry, pathname: string): boolean {
  if (entry.href === "/") return pathname === "/";
  if (entry.href === "/history" || entry.exact) return pathname === entry.href;
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (!under(entry.href)) return false;
  // A more specific entry wins (e.g. /reports/summary-email over /reports).
  return !MENU.some((other) => other.href.startsWith(`${entry.href}/`) && under(other.href));
}
