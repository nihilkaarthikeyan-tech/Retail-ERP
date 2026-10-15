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
  // Module 2
  'catalogue.view': 'See items, groups, brands, units and barcodes',
  'catalogue.manage': 'Create and change items, groups, brands, units, barcodes and attributes',
  'prices.view': 'See selling prices',
  'prices.manage': 'Create and change price lists and prices',
  'buying_prices.view': 'See buying price lists and prices',
  'cost_price.view': 'See last purchase price, cost and margin',
  // Module 3
  'customers.view': 'See customers, their addresses and contacts',
  'customers.quick_add': 'Add a customer with name and mobile at the till',
  'customers.manage': 'Create and change customers, groups, addresses and contacts',
  'customers.credit': 'Set credit limits, block or switch off customers (credit controller)',
  'suppliers.view': 'See suppliers, their addresses and contacts',
  'suppliers.manage': 'Create and change suppliers, groups, addresses and contacts',
  'suppliers.hold': 'Hold, block or switch off suppliers',
  'payment_terms.manage': 'Create and change payment terms',
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
  accountant: [
    'company.view',
    'stores.view',
    'financial_years.manage',
    'audit.view',
    'catalogue.view',
    'prices.view',
    'buying_prices.view',
    'cost_price.view',
    'customers.view',
    'customers.credit',
    'suppliers.view',
    'suppliers.hold',
    'payment_terms.manage',
  ],
  store_manager: [
    'company.view',
    'stores.view',
    'users.view',
    'catalogue.view',
    'prices.view',
    'customers.view',
    'customers.quick_add',
    'customers.manage',
    'suppliers.view',
  ],
  // Decision 70: cashiers never see cost, margin or buying prices.
  cashier: ['catalogue.view', 'prices.view', 'customers.view', 'customers.quick_add'],
  stock_receiving: ['stores.view', 'catalogue.view', 'suppliers.view'],
  viewer_auditor: [
    'company.view',
    'stores.view',
    'users.view',
    'audit.view',
    'catalogue.view',
    'prices.view',
    'buying_prices.view',
    'cost_price.view',
    'customers.view',
    'suppliers.view',
  ],
};

export const SYSTEM_ROLE_NAMES: Record<SystemRoleCode, string> = {
  owner_admin: 'Owner / Admin',
  accountant: 'Accountant',
  store_manager: 'Store Manager',
  cashier: 'Cashier',
  stock_receiving: 'Stock / Receiving',
  viewer_auditor: 'Viewer / Auditor',
};
