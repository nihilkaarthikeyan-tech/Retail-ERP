// Copyright (c) 2026, Rademics. All rights reserved.
import { type CurrentUser, hasPermission, type PermissionKey } from "shared";
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
}

/** Colour family of each menu section (see the area-* classes in globals.css). */
export type MenuArea = "sales" | "stock" | "purchase" | "accounts" | "admin";

const SECTION_AREA: Record<string, MenuArea> = {
  Catalogue: "sales",
  Parties: "purchase",
  Inventory: "stock",
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
  { href: "/catalogue/attributes", label: "Attributes", permissions: ["catalogue.view"], section: "Catalogue", icon: "sliders" },
  { href: "/catalogue/hsn-codes", label: "HSN codes", permissions: ["catalogue.view"], section: "Catalogue", icon: "receipt" },
  { href: "/price-lists", label: "Price lists", permissions: ["prices.view"], section: "Catalogue", icon: "list" },
  { href: "/prices", label: "Prices", permissions: ["prices.view"], section: "Catalogue", icon: "rupee" },
  { href: "/catalogue/settings", label: "Catalogue settings", ownerAdminOnly: true, section: "Catalogue", icon: "settings" },
  // Module 3
  { href: "/customers", label: "Customers", permissions: ["customers.view"], section: "Parties", icon: "users" },
  { href: "/suppliers", label: "Suppliers", permissions: ["suppliers.view"], section: "Parties", icon: "truck" },
  { href: "/customer-groups", label: "Customer groups", permissions: ["customers.view"], section: "Parties", icon: "folder" },
  { href: "/supplier-groups", label: "Supplier groups", permissions: ["suppliers.view"], section: "Parties", icon: "folder" },
  { href: "/payment-terms", label: "Payment terms", permissions: ["customers.view"], section: "Parties", icon: "calendar" },
  { href: "/party-settings", label: "Party settings", ownerAdminOnly: true, section: "Parties", icon: "settings" },
  // Module 4
  { href: "/stock", label: "Stock on hand", permissions: ["stock.view"], section: "Inventory", exact: true, icon: "layers" },
  { href: "/stock/documents", label: "Stock documents", permissions: ["stock.view"], section: "Inventory", icon: "file" },
  { href: "/stock/transfers", label: "In transit", permissions: ["stock.view"], section: "Inventory", icon: "transfer" },
  { href: "/stock/ledger", label: "Stock history", permissions: ["stock.view"], section: "Inventory", icon: "history" },
  { href: "/stock/batches", label: "Batches", permissions: ["stock.view"], section: "Inventory", icon: "clock" },
  { href: "/stock/exceptions", label: "Negative stock", permissions: ["stock.view"], section: "Inventory", icon: "alert" },
  { href: "/stock/locations", label: "Locations", permissions: ["stock.view"], section: "Inventory", icon: "pin" },
  { href: "/stock/reorder-levels", label: "Reorder levels", permissions: ["stock.view"], section: "Inventory", icon: "refresh" },
  { href: "/stock/settings", label: "Inventory settings", permissions: ["stock.lock"], section: "Inventory", icon: "settings" },
  // Module 1 set-up pages, kept at the bottom of the menu
  { href: "/company", label: "Company", permissions: ["company.view"], section: "Administration", icon: "building" },
  { href: "/stores", label: "Stores", permissions: ["stores.view"], section: "Administration", icon: "store" },
  { href: "/financial-years", label: "Financial years", permissions: ["financial_years.manage"], section: "Administration", icon: "calendar" },
  { href: "/numbering", label: "Document numbering", permissions: ["numbering.manage"], section: "Administration", icon: "hash" },
  { href: "/users", label: "Users", permissions: ["users.view"], section: "Administration", icon: "user" },
  { href: "/roles", label: "Roles", permissions: ["roles.manage"], section: "Administration", icon: "shield" },
  { href: "/history", label: "Change history", permissions: ["audit.view"], section: "Administration", icon: "history" },
  { href: "/history/logins", label: "Login history", permissions: ["audit.view"], section: "Administration", icon: "login" },
  { href: "/sessions", label: "My sessions", section: "Administration", icon: "devices" },
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
