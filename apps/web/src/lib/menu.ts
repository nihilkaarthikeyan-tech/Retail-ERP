// Copyright (c) 2026, Rademics. All rights reserved.
import { type CurrentUser, hasPermission, type PermissionKey } from "shared";

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
}

export const MENU: MenuEntry[] = [
  { href: "/", label: "Dashboard" },
  { href: "/company", label: "Company", permissions: ["company.view"] },
  { href: "/stores", label: "Stores", permissions: ["stores.view"] },
  { href: "/financial-years", label: "Financial years", permissions: ["financial_years.manage"] },
  { href: "/numbering", label: "Document numbering", permissions: ["numbering.manage"] },
  { href: "/users", label: "Users", permissions: ["users.view"] },
  { href: "/roles", label: "Roles", permissions: ["roles.manage"] },
  { href: "/history", label: "Change history", permissions: ["audit.view"] },
  { href: "/history/logins", label: "Login history", permissions: ["audit.view"] },
  { href: "/sessions", label: "My sessions" },
  // Module 2
  { href: "/items", label: "Items", permissions: ["catalogue.view"], section: "Catalogue" },
  { href: "/catalogue/item-groups", label: "Item groups", permissions: ["catalogue.view"], section: "Catalogue" },
  { href: "/catalogue/brands", label: "Brands", permissions: ["catalogue.view"], section: "Catalogue" },
  { href: "/catalogue/units", label: "Units", permissions: ["catalogue.view"], section: "Catalogue" },
  { href: "/catalogue/attributes", label: "Attributes", permissions: ["catalogue.view"], section: "Catalogue" },
  { href: "/catalogue/hsn-codes", label: "HSN codes", permissions: ["catalogue.view"], section: "Catalogue" },
  { href: "/price-lists", label: "Price lists", permissions: ["prices.view"], section: "Catalogue" },
  { href: "/prices", label: "Prices", permissions: ["prices.view"], section: "Catalogue" },
  { href: "/catalogue/settings", label: "Catalogue settings", ownerAdminOnly: true, section: "Catalogue" },
  // Module 3
  { href: "/customers", label: "Customers", permissions: ["customers.view"], section: "Parties" },
  { href: "/suppliers", label: "Suppliers", permissions: ["suppliers.view"], section: "Parties" },
  { href: "/customer-groups", label: "Customer groups", permissions: ["customers.view"], section: "Parties" },
  { href: "/supplier-groups", label: "Supplier groups", permissions: ["suppliers.view"], section: "Parties" },
  { href: "/payment-terms", label: "Payment terms", permissions: ["customers.view"], section: "Parties" },
  { href: "/party-settings", label: "Party settings", ownerAdminOnly: true, section: "Parties" },
  // Module 4
  { href: "/stock", label: "Stock on hand", permissions: ["stock.view"], section: "Inventory", exact: true },
  { href: "/stock/documents", label: "Stock documents", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/transfers", label: "In transit", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/ledger", label: "Stock history", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/batches", label: "Batches", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/exceptions", label: "Negative stock", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/locations", label: "Locations", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/reorder-levels", label: "Reorder levels", permissions: ["stock.view"], section: "Inventory" },
  { href: "/stock/settings", label: "Inventory settings", permissions: ["stock.lock"], section: "Inventory" },
];

export function visibleMenu(user: CurrentUser | null): MenuEntry[] {
  if (!user) return [];
  return MENU.filter((entry) => {
    if (entry.ownerAdminOnly) return user.isOwnerAdmin;
    return !entry.permissions || entry.permissions.some((key) => hasPermission(user, key));
  });
}

/** Entry is active for its own path and for sub-paths (except the dashboard). */
export function isActive(entry: MenuEntry, pathname: string): boolean {
  if (entry.href === "/") return pathname === "/";
  if (entry.href === "/history" || entry.exact) return pathname === entry.href;
  return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}
