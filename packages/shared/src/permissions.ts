// Copyright (c) 2026, Rademics. All rights reserved.
// Permission keys are defined once here and shared by the API (guards) and
// the web app (menu and button visibility). Later modules append their own.

export const PERMISSIONS = {
  'company.view': 'See company details and GST registrations',
  'company.manage': 'Change company details and GST registrations',
  'stores.view': 'See the list of stores',
  'stores.manage': 'Add, change and switch off stores',
  'financial_years.manage': 'Create, open and lock financial years',
  'numbering.manage': 'Set up document numbering and change counters',
  'users.view': 'See the list of users',
  'users.manage': 'Create and change users, roles given and store access',
  'roles.manage': 'Create and change roles and their permissions',
  'audit.view': 'See the change history and login history',
  'sessions.manage_others': 'End other users’ sessions',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** The six starting roles (decision 71). Custom roles may be added too. */
export const SYSTEM_ROLES = {
  OWNER_ADMIN: 'owner_admin',
  ACCOUNTANT: 'accountant',
  STORE_MANAGER: 'store_manager',
  CASHIER: 'cashier',
  STOCK_RECEIVING: 'stock_receiving',
  VIEWER_AUDITOR: 'viewer_auditor',
} as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Rights of each system role within this module. Owner/Admin bypasses checks. */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleCode, PermissionKey[]> = {
  owner_admin: PERMISSION_KEYS,
  accountant: ['company.view', 'stores.view', 'financial_years.manage', 'audit.view'],
  store_manager: ['company.view', 'stores.view', 'users.view'],
  cashier: [],
  stock_receiving: ['stores.view'],
  viewer_auditor: ['company.view', 'stores.view', 'users.view', 'audit.view'],
};

export const SYSTEM_ROLE_NAMES: Record<SystemRoleCode, string> = {
  owner_admin: 'Owner / Admin',
  accountant: 'Accountant',
  store_manager: 'Store Manager',
  cashier: 'Cashier',
  stock_receiving: 'Stock / Receiving',
  viewer_auditor: 'Viewer / Auditor',
};
