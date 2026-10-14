// Copyright (c) 2026, Rademics. All rights reserved.
// Response shapes of the API (see apps/api/src/**/*.service.ts `toDto`).

export interface CompanyDto {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  pan: string | null;
  stateCode: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  homeCurrency: string;
  fiscalYearStartMonth: number;
  lockDate: string | null;
  active: boolean;
  hasLogo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GstRegistrationDto {
  id: string;
  gstin: string;
  stateCode: string;
  legalNameOnCertificate: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  isDefault: boolean;
  active: boolean;
}

export interface StoreDto {
  id: string;
  code: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  gstRegistrationId: string | null;
  gstRegistration: { id: string; gstin: string } | null;
  active: boolean;
}

export interface FinancialYearDto {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isIrregular: boolean;
  status: "open" | "locked";
  createdAutomatically: boolean;
  createdAt: string;
}

export interface NumberSeriesDto {
  id: string;
  documentKind: string;
  pattern: string;
  counterLength: number;
  storeId: string | null;
  active: boolean;
  store: { id: string; code: string; name: string } | null;
  counters: { id: string; filledPrefix: string; nextNumber: number }[];
}

export interface NumberPreviewRow {
  store: { id: string; code: string } | null;
  filledPrefix: string;
  nextNumber: number;
  next: string;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  mobile: string | null;
  active: boolean;
  allStores: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  roles: { id: string; code: string; name: string; active: boolean }[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  createdAt: string;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  active: boolean;
  permissions: string[];
}

export interface PermissionDto {
  key: string;
  description: string;
}

export interface SessionDto {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface AuditUserRef {
  id: string;
  firstName?: string;
  lastName?: string | null;
  email?: string;
}

export interface AuditRow {
  id: string;
  at: string;
  user: AuditUserRef | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  reason: string | null;
  ipAddress: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  nextBefore: string | null;
}
