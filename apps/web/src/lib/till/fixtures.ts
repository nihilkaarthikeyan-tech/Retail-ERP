// Copyright (c) 2026, Rademics. All rights reserved.
// Sample till data for tests: the acceptance sample of plan 06 §9 (store MAIN,
// till T1, Basmati ₹120 at 5%, Surf ₹132 at 18%, Ariel ₹150 at 18%) plus
// Parle-G for the offers scenario.
import type { CurrentUser } from "shared";
import { ApiError } from "../api";
import type { TillApi } from "./till-api";
import type { StoredSnapshot, TillSnapshot } from "./types";

export const TILL_ID = "a0000000-0000-4000-8000-000000000001";
export const CASH = "c0000000-0000-4000-8000-000000000001";
export const CARD = "c0000000-0000-4000-8000-000000000002";
export const UPI = "c0000000-0000-4000-8000-000000000003";
export const ACCOUNT = "c0000000-0000-4000-8000-000000000004";
export const PCS = "d0000000-0000-4000-8000-000000000001";
export const WALK_IN = "e0000000-0000-4000-8000-000000000001";
export const ASHA = "e0000000-0000-4000-8000-000000000002";
export const BASMATI = "10000000-0000-4000-8000-000000000001";
export const SURF = "10000000-0000-4000-8000-000000000002";
export const ARIEL = "10000000-0000-4000-8000-000000000003";
export const PARLE = "10000000-0000-4000-8000-000000000004";
export const BISCUITS_GROUP = "20000000-0000-4000-8000-000000000001";
export const B2G1 = "30000000-0000-4000-8000-000000000001";
export const TEN_OFF = "30000000-0000-4000-8000-000000000002";
export const PREFIX = "MAIN-T1-2026-27-";

function item(id: string, code: string, name: string, hsn: string, mrp: string, group = "20000000-0000-4000-8000-0000000000ff") {
  return {
    id,
    code,
    name,
    active: true,
    isStockItem: true,
    trackBatches: false,
    trackSerials: false,
    hsnCode: hsn,
    mrp,
    maxDiscountPercent: "15",
    baseUnitId: PCS,
    parentItemId: null,
    brandId: null,
    itemGroup: { id: group, path: `/${group}/` },
    units: [{ unitId: PCS, code: "PCS", factor: "1", allowsFractions: false, mrp: null }],
    barcodes: [{ code: `890${code.slice(-4)}`, unitId: PCS }],
  };
}

const price = (itemId: string, p: string) => ({ id: `price-${itemId}`, priceListId: "f0000000-0000-4000-8000-000000000002", itemId, unitId: PCS, price: p, startDate: "2026-04-01", endDate: null, customerId: null, batchId: null, packSize: null });

export function sampleSnapshot(over: Partial<TillSnapshot> = {}): StoredSnapshot {
  return {
    serverTime: "2026-10-15T04:30:00.000Z",
    full: true,
    fetchedAt: "2026-10-15T04:30:00.000Z",
    till: {
      id: TILL_ID,
      code: "T1",
      name: "Till 1",
      numberPrefix: "MAIN-T1",
      locationId: "f0000000-0000-4000-8000-000000000001",
      priceListId: "f0000000-0000-4000-8000-000000000002",
      pricesPerUnit: false,
      fallbackPriceList: null,
      cashierDiscountPercent: "5",
      allowPriceChange: false,
      autoPrint: true,
      receiptFooter: "Thank you",
      store: { id: "f0000000-0000-4000-8000-000000000003", code: "MAIN", name: "Main Store", address: "1 Market Road, Chennai", phone: null, stateCode: "33" },
      company: { legalName: "Sample Retail Pvt Ltd", stateCode: "33", gstin: "33AAAAA0000A1Z5" },
      paymentMethods: [
        { id: CASH, code: "CASH", name: "Cash", kind: "cash", allowRefund: true, needsReference: false, isDefault: true, active: true },
        { id: CARD, code: "CARD", name: "Card", kind: "card", allowRefund: true, needsReference: true, isDefault: false, active: true },
        { id: UPI, code: "UPI", name: "UPI", kind: "upi", allowRefund: false, needsReference: true, isDefault: false, active: true },
      ],
      liveAllowed: false,
      walkInCustomerId: WALK_IN,
    },
    financialYears: [{ name: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" }],
    lastNumbers: [{ financialYear: "2026-27", prefix: PREFIX, lastNumber: `${PREFIX}000041` }],
    items: [
      item(BASMATI, "ITM-000001", "Basmati Rice 1 kg", "1006", "130.00"),
      item(SURF, "ITM-000002", "Surf Excel 1 kg", "3402", "140.00"),
      item(ARIEL, "ITM-000003", "Ariel 1 kg", "3402", "160.00"),
      item(PARLE, "ITM-000004", "Parle-G", "1905", "10.00", BISCUITS_GROUP),
    ],
    prices: [price(BASMATI, "120"), price(SURF, "132"), price(ARIEL, "150"), price(PARLE, "10")],
    gstRates: [
      { hsnCode: "1006", rate: "5", effectiveFrom: "2026-04-01", approved: false },
      { hsnCode: "3402", rate: "18", effectiveFrom: "2026-04-01", approved: false },
      { hsnCode: "1905", rate: "18", effectiveFrom: "2026-04-01", approved: false },
    ],
    offers: [],
    coupons: [],
    customers: [
      { id: WALK_IN, code: "CUS-000001", name: "Walk-in customer", mobile: null, gstin: null, stateCode: null, customerGroupId: null, status: "active" },
      { id: ASHA, code: "CUS-000002", name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null, status: "active" },
    ],
    stock: [],
    ...over,
  };
}

/** The sample till with On account ticked (plan 07 §1a). */
export function snapshotWithOnAccount(over: Partial<TillSnapshot> = {}): StoredSnapshot {
  const s = sampleSnapshot(over);
  return { ...s, till: { ...s.till, paymentMethods: [...s.till.paymentMethods, { id: ACCOUNT, code: "ACCOUNT", name: "On account", kind: "on_account", allowRefund: true, needsReference: false, isDefault: false, active: true }] } };
}

export const sampleOffers = [
  { id: B2G1, code: "PARLE-B2G1", name: "Parle-G buy 2 get 1", kind: "free_goods" as const, appliesTo: "items" as const, targetIds: [PARLE], value: null, buyQuantity: "2", freeQuantity: "1", minQuantity: null, minAmount: null, storeIds: [], customerGroupId: null, startDate: "2026-10-01", endDate: null, priority: 0, couponOnly: false, active: true },
  { id: TEN_OFF, code: "BISCUITS10", name: "10% off biscuits", kind: "percent" as const, appliesTo: "groups" as const, targetIds: [BISCUITS_GROUP], value: "10", buyQuantity: null, freeQuantity: null, minQuantity: null, minAmount: null, storeIds: [], customerGroupId: null, startDate: "2026-10-01", endDate: null, priority: 5, couponOnly: false, active: true },
];

export const sampleUser: CurrentUser = {
  id: "90000000-0000-4000-8000-000000000001",
  firstName: "Ravi",
  lastName: null,
  email: "ravi@example.com",
  isOwnerAdmin: false,
  permissions: ["pos.sell", "pos.return", "pos.close"],
  allStores: true,
  stores: [],
  mustChangePassword: false,
  roles: [],
};

/** A fake API: every call rejects unless the test gives it an answer. */
export function fakeApi(over: Partial<TillApi> = {}): TillApi {
  const no = () => Promise.reject(new ApiError(0, "Cannot reach the server"));
  return {
    me: no,
    snapshot: no,
    currentShift: no,
    openShift: no,
    cashMovement: no,
    closeShift: no,
    postBill: no,
    findBills: no,
    reprint: no,
    people: no,
    approve: no,
    switchCashier: no,
    settings: no,
    findOrders: no,
    order: no,
    orderAdvance: no,
    cancelOrder: no,
    customerCredit: no,
    findAlterations: no,
    createAlteration: no,
    alterationStatus: no,
    ...over,
  };
}
