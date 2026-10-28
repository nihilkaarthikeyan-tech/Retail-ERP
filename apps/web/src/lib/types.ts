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
  newItemMaxDiscountPercent: string;
  newItemAutoNumberBatches: boolean;
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
  /** Plan 11 C4: the season or collection. */
  seasonId?: string | null;
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

// ---- Module 3: customers, suppliers, groups, payment terms ----

export type PartyStatus = "active" | "blocked" | "off";
export type HoldType = "none" | "bills" | "payments" | "all";
export type DueBasis = "days_after_date" | "days_after_month_end" | "months_then_month_end";
export type PartyType = "customer" | "supplier";

/** A party, group, list or terms referred to from another record. */
export interface PartyRef {
  id: string;
  code: string;
  name: string;
}

export interface AddressDto {
  id: string;
  partyType: PartyType;
  partyId: string;
  label: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateCode: string;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  isBilling: boolean;
  isDelivery: boolean;
  isMain: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  partyType: PartyType;
  partyId: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  mobile: string | null;
  isMain: boolean;
  noPromotions: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDto {
  id: string;
  code: string;
  name: string;
  isBusiness: boolean;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  /** Plan 11 C10: "MM-DD", with the year when known. */
  birthday: string | null;
  birthYear: number | null;
  anniversary: string | null;
  anniversaryYear: number | null;
  customerGroup: PartyRef;
  gstin: string | null;
  /** Plan 15: what the GST network said, when last checked. */
  gstinCheck?: SavedGstinCheck | null;
  /** Audit 4: regular, sez or reverse_charge for a business buyer; null = from the GSTIN. */
  taxSituation?: string | null;
  stateCode: string | null;
  priceList: PartyRef | null;
  paymentTerms: PartyRef | null;
  creditLimit: string;
  overdueLimit: string;
  creditCheckAtDelivery: boolean;
  status: PartyStatus;
  isWalkIn: boolean;
  linkedSupplier: PartyRef | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /customers/:id also carries the addresses and contact people. */
export interface CustomerDetailDto extends CustomerDto {
  addresses: AddressDto[];
  contacts: ContactDto[];
}

export interface CustomerPage {
  rows: CustomerDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Body of the 409 DUPLICATE_MOBILE answer (decision 20). */
export interface DuplicateMobileBody {
  message: string;
  code: "DUPLICATE_MOBILE";
  matches: { id: string; code: string; name: string; mobile: string | null }[];
}

export interface SupplierDto {
  id: string;
  code: string;
  name: string;
  isBusiness: boolean;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  supplierGroup: PartyRef;
  isTransporter: boolean;
  gstin: string | null;
  /** Plan 15: what the GST network said, when last checked. */
  gstinCheck?: SavedGstinCheck | null;
  pan: string | null;
  stateCode: string | null;
  priceList: PartyRef | null;
  paymentTerms: PartyRef | null;
  bankAccountNote: string | null;
  status: PartyStatus;
  holdType: HoldType;
  holdUntil: string | null;
  holdReason: string | null;
  allowBillWithoutOrder: boolean;
  allowBillWithoutReceipt: boolean;
  linkedCustomers: PartyRef[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDetailDto extends SupplierDto {
  addresses: AddressDto[];
  contacts: ContactDto[];
}

export interface SupplierPage {
  rows: SupplierDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** One node of a customer or supplier group tree (GET /customer-groups, /supplier-groups). */
export interface PartyGroupNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  active: boolean;
  isLeaf: boolean;
  priceListId: string | null;
  paymentTermsId: string | null;
  /** Customer groups only. */
  creditLimit?: string;
  overdueLimit?: string;
  skipCreditCheck?: boolean;
  children: PartyGroupNode[];
}

export interface PaymentTermsPartDto {
  share: string;
  dueBasis: DueBasis;
  days: number;
  months: number;
  earlyDiscountPercent: string | null;
  earlyDiscountDays: number | null;
}

export interface PaymentTermsDto {
  id: string;
  code: string;
  name: string;
  active: boolean;
  parts: PaymentTermsPartDto[];
}

export interface DueDateResult {
  parts: { share: string; dueDate: string }[];
  dueDate: string;
}

export interface PartySettingsDto {
  companyId: string;
  defaultCustomerGroupId: string | null;
  defaultSupplierGroupId: string | null;
  defaultPaymentTermsId: string | null;
  defaultCreditLimit: string;
  walkInCustomerId: string | null;
  gstTreatmentFrom: "billing" | "delivery";
  updatedAt: string;
}

// ---- Module 4: inventory ----

export type LocationKindDto = "folder" | "shelf" | "transit" | "rejected";
export type StockDocKindDto = "stock_in" | "stock_out" | "move" | "transfer_send" | "transfer_receive" | "count";
export type StockDocStatus = "draft" | "finalised" | "cancelled";

/** A store as carried on a stock location. */
export interface StoreRef {
  id: string;
  code: string;
  name: string;
}

/** GET /stock/locations. The transit location has no store. */
export interface StockLocationDto {
  id: string;
  code: string;
  name: string;
  kind: LocationKindDto;
  parentId: string | null;
  store: StoreRef | null;
  active: boolean;
}

/** List row of GET /stock/documents (values only with stock.cost.view). */
export interface StockDocHeaderDto {
  id: string;
  number: string;
  kind: StockDocKindDto;
  reason: string | null;
  countType: "opening" | "normal" | null;
  status: StockDocStatus;
  postingDate: string;
  postingAt: string;
  storeId: string;
  toStoreId: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  sendDocumentId: string | null;
  remarks: string | null;
  isBackDated: boolean;
  totalValueIn?: string;
  totalValueOut?: string;
  cancelReason: string | null;
  createdAt: string;
  finalisedAt: string | null;
}

export interface StockDocLineDto {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string; trackBatches: boolean; trackSerials: boolean };
  unitId: string;
  /** In the line's unit. */
  quantity: string;
  factor: string;
  basicQuantity: string;
  batch: { id: string; batchNumber: string; expiryDate: string | null } | null;
  newBatchNumber: string | null;
  newExpiryOn: string | null;
  serialNumbers: string[];
  /** Cost per basic unit; only with stock.cost.view. */
  unitCost?: string | null;
  valueChange?: string;
  /** Null on a blind draft count for users without stock.adjust_finalise. */
  expectedQuantity: string | null;
  countedQuantity: string | null;
  /** Transfer sends: basic units received so far. */
  receivedQuantity: string;
  sendLineId: string | null;
}

/** GET /stock/documents/:id and every write answer. */
export interface StockDocumentDto extends StockDocHeaderDto {
  blind: boolean;
  lines: StockDocLineDto[];
}

export interface StockDocPage {
  rows: StockDocHeaderDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockBalanceRow {
  item: { id: string; code: string; name: string; unit: string };
  location: { id: string; code: string; name: string; kind: LocationKindDto; store: StoreRef | null };
  quantity: string;
  unitCost?: string;
  value?: string;
}

export interface StockBalanceResult {
  rows: StockBalanceRow[];
  totals: { value?: string };
}

/** A location as named in reports: store is the store code (null for transit). */
export interface ReportLocationRef {
  id: string;
  name?: string;
  store: string | null;
}

export interface StockLedgerRow {
  id: string;
  postingDate: string;
  postingAt: string;
  document: { id: string; number: string; kind: StockDocKindDto; reason: string | null } | null;
  item: { id: string; code: string; name: string } | null;
  location: ReportLocationRef;
  batchId: string | null;
  quantityChange: string;
  quantityAfter: string;
  isCancellation: boolean;
  wentNegative: boolean;
  unitCost?: string;
  valueChange?: string;
  unitCostAfter?: string;
  valueAfter?: string;
  accountRole?: string;
}

export interface StockLookupResult {
  item: { id: string; code: string; name: string; unit: string };
  usable: boolean;
  reason: string | null;
  locations: { location: ReportLocationRef; quantity: string; value?: string }[];
}

export interface BatchStockRow {
  batch: { id: string; batchNumber: string; expiryDate: string | null; manufactureDate: string | null };
  item: { id: string; code: string; name: string };
  location: ReportLocationRef;
  quantity: string;
  daysLeft: number | null;
  expired: boolean;
}

export interface NegativeStockRow {
  item: { id: string; code: string; name: string } | undefined;
  location: ReportLocationRef;
  quantity: string;
  since: string;
}

export interface ReorderLevelDto {
  id: string;
  itemId: string;
  storeId: string;
  level: string;
  quantity: string;
  requestType: "buy" | "move";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySettingsDto {
  companyId: string;
  stockLockDate: string | null;
  allowNegativeAtTill: boolean;
  batchPickOrder: "earliest_expiry" | "oldest_first";
  transitLocationId?: string | null;
  updatedAt: string;
}

/** Plan 15: what a saved customer or supplier record says about its GSTIN (the GST network's last answer). */
export interface SavedGstinCheck {
  status: string;
  legalName: string | null;
  tradeName: string | null;
  cancelledOn: string | null;
  checkedAt: string | null;
}
