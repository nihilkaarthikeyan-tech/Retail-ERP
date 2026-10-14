// Copyright (c) 2026, Rademics. All rights reserved.
import { type CurrentUser, hasPermission, type PermissionKey } from "shared";

export interface MenuEntry {
  href: string;
  label: string;
  /** Any of these rights shows the entry; none means everyone logged in. */
  permissions?: PermissionKey[];
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
];

export function visibleMenu(user: CurrentUser | null): MenuEntry[] {
  if (!user) return [];
  return MENU.filter((entry) => !entry.permissions || entry.permissions.some((key) => hasPermission(user, key)));
}

/** Entry is active for its own path and for sub-paths (except the dashboard). */
export function isActive(entry: MenuEntry, pathname: string): boolean {
  if (entry.href === "/") return pathname === "/";
  if (entry.href === "/history") return pathname === "/history";
  return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}
