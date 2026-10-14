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

// ---- Module 2: catalogue, items, prices ----

export interface UnitDto {
  id: string;
  code: string;
  name: string;
  kind: "count" | "weight" | "length" | "volume" | "other";
  allowsFractions: boolean;
  active: boolean;
}

export interface UnitConversionDto {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  fromUnit: UnitDto;
  toUnit: UnitDto;
}

/** One node of the item group tree (GET /catalogue/item-groups returns the roots). */
export interface ItemGroupNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  hsnCode: string | null;
  active: boolean;
  isLeaf: boolean;
  children: ItemGroupNode[];
}

export interface BrandDto {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface HsnCodeDto {
  id: string;
  code: string;
  description: string;
  isService: boolean;
  active: boolean;
}

export interface AttributeValueDto {
  id: string;
  attributeId: string;
  value: string;
  shortCode: string;
  sortOrder: number;
}

export interface AttributeDto {
  id: string;
  code: string;
  name: string;
  kind: "list" | "numeric";
  rangeStart: string | null;
  rangeEnd: string | null;
  rangeStep: string | null;
  active: boolean;
  values: AttributeValueDto[];
}

export interface CatalogueSettingsDto {
  companyId: string;
  autoItemCodes: boolean;
  defaultItemGroupId: string | null;
  defaultUnitId: string | null;
  defaultSellingPriceListId: string | null;
  defaultBuyingPriceListId: string | null;
  fallbackToDefaultSellingList: boolean;
  allowPriceChangeOnBill: boolean;
  blockSellingBelowCost: boolean;
  saveTypedPrices: boolean;
  updatedAt: string;
}

export interface ItemUnitDto {
  unitId: string;
  code: string;
  name: string;
  allowsFractions: boolean;
  /** Basic units per this unit, as a decimal string. */
  factor: string;
  mrp: string | null;
}

export interface BarcodeDto {
  id: string;
  code: string;
  type: "EAN13" | "EAN8" | "UPCA" | "CODE39" | "other";
  unit: { id: string; code: string } | null;
  active: boolean;
}

export interface ItemRef {
  id: string;
  code: string;
  name: string;
}

export interface ItemDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  hasImage: boolean;
  itemGroup: ItemRef;
  brand: ItemRef | null;
  baseUnit: { id: string; code: string; name: string; allowsFractions: boolean };
  hsnCode: string | null;
  mrp: string | null;
  maxDiscountPercent: string;
  isStockItem: boolean;
  canBuy: boolean;
  canSell: boolean;
  endDate: string | null;
  active: boolean;
  isParentStyle: boolean;
  parent: ItemRef | null;
  variantCount: number;
  trackBatches: boolean;
  autoNumberBatches: boolean;
  shelfLifeDays: number | null;
  trackSerials: boolean;
  warrantyDays: number | null;
  /** Present only for users with cost_price.view. */
  lastPurchasePrice?: string | null;
  units: ItemUnitDto[];
  barcodes: BarcodeDto[];
  variantAttributes: ItemRef[];
  variantValues: { attribute: ItemRef; value: string; shortCode: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ItemPage {
  rows: ItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScanResult {
  item: ItemDto;
  unit: { id: string; code: string; name: string; factor: string };
  matchedBy: "barcode" | "code";
  usable: boolean;
  reason: string | null;
}

export interface CreatedVariants {
  created: ItemDto[];
  skippedExisting: number;
}

export interface PriceListDto {
  id: string;
  code: string;
  name: string;
  forSelling: boolean;
  forBuying: boolean;
  currency: string;
  pricesPerUnit: boolean;
  active: boolean;
}

export interface PriceDto {
  id: string;
  priceList: ItemRef;
  item: ItemRef;
  unit: { id: string; code: string };
  price: string;
  startDate: string | null;
  endDate: string | null;
  packSize: string | null;
  customerId: string | null;
  supplierId: string | null;
  batchId: string | null;
  updatedAt: string;
}

export interface PriceLookupResult {
  found: boolean;
  priceId: string | null;
  priceListId: string | null;
  price: string | null;
  priceUnitId: string | null;
  rate: string | null;
  source: "list" | "default_list" | null;
}
