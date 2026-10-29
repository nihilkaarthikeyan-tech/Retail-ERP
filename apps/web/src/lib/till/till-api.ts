// Copyright (c) 2026, Rademics. All rights reserved.
// The till's calls to the API. Every call carries the registered computer's
// token (x-till-token, pos-offline plan §9). A 401 never jumps to the login
// page from here: the till shows "sign in again" and keeps billing offline.
import type { ApprovalAction, CloseShiftInput, CurrentUser, OpenShiftInput, PosTransactionInput } from "shared";
import { api, ApiError, query } from "../api";
import { TILL_TOKEN_HEADER, type TillDeviceInfo } from "../till-device";
import type { BillDto, GiftCardSaleResult, Person, Receipt, ServerShift, TillAlteration, TillCustomerPoints, TillGiftCard, TillOrder, TillSnapshot, TransactionResult } from "./types";

/** Gives up on a request that hangs (the server is treated as unreachable). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(0, "The server did not answer in time")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface TillApi {
  me(): Promise<CurrentUser>;
  snapshot(since?: string): Promise<TillSnapshot>;
  currentShift(): Promise<ServerShift | null>;
  openShift(body: OpenShiftInput): Promise<ServerShift>;
  cashMovement(shiftId: string, body: { clientId: string; direction: "in" | "out"; amount: string; reason: string; at?: string; approvalToken?: string }): Promise<unknown>;
  closeShift(shiftId: string, body: CloseShiftInput): Promise<ServerShift>;
  postBill(body: PosTransactionInput): Promise<TransactionResult>;
  /** Audit 5: whether a bill sent with this clientId was saved (asked after an answer that never came). */
  billByClient(clientId: string): Promise<BillByClient>;
  /** Audit 5 (C4): every opening of the cash drawer is recorded; the same clientId twice is kept once. */
  drawerOpening(body: DrawerOpeningInput): Promise<unknown>;
  findBills(search: string): Promise<{ rows: BillDto[] }>;
  reprint(billId: string): Promise<Receipt>;
  people(): Promise<{ managers: Person[]; cashiers: Person[] }>;
  /** Audit 5: amount / percent is the figure approved (cash difference, cash out, bill discount); the server compares it. */
  approve(body: { managerId: string; pin: string; action: ApprovalAction; details?: string; amount?: string; percent?: string }): Promise<{ token: string; manager: Person }>;
  switchCashier(body: { userId: string; pin: string }): Promise<{ token: string; cashier: Person }>;
  settings(): Promise<{ cashDifferenceApprovalAmount: string; printReceiptCopies: number; liveAllowed: boolean }>;
  // Plan 11 part 2: customer orders and alteration jobs (online only).
  findOrders(search: string, storeId: string): Promise<{ rows: TillOrder[] }>;
  order(id: string): Promise<TillOrder>;
  orderAdvance(id: string, body: { clientId: string; paymentMethodId: string; amount: string; reference?: string | null }): Promise<TillOrder>;
  cancelOrder(id: string, body: { clientId: string; reason: string; outcome: "refund" | "keep_credit"; paymentMethodId?: string; reference?: string | null; approvalToken?: string }): Promise<TillOrder>;
  customerCredit(customerId: string): Promise<{ available: string }>;
  findAlterations(view: string, storeId: string, search?: string): Promise<{ rows: TillAlteration[] }>;
  createAlteration(body: Record<string, unknown>): Promise<TillAlteration>;
  alterationStatus(id: string, status: string): Promise<TillAlteration>;
  // Plan 13: points and gift cards (online only). The card number goes in the body, never the address.
  customerPoints(customerId: string): Promise<TillCustomerPoints>;
  checkGiftCard(number: string): Promise<TillGiftCard>;
  sellGiftCard(body: { clientId: string; amount: string; paymentMethodId: string; reference?: string | null; number?: string | null; holderName?: string | null; holderPhone?: string | null; customerId?: string | null }): Promise<GiftCardSaleResult>;
}

/** What GET /pos/bills/by-client/:clientId answers. */
export type BillByClient = { saved: true; transaction: TransactionResult } | { saved: false };

/** POST /pos/drawer-openings (audit 5, C4). */
export interface DrawerOpeningInput {
  clientId: string;
  tillId: string;
  kind: "sale" | "no_sale";
  at: string;
  billClientId?: string;
  approvalToken?: string;
}

export function tillApi(device: TillDeviceInfo): TillApi {
  const opts = { headers: { [TILL_TOKEN_HEADER]: device.token }, redirectOnUnauthorized: false };
  const tillId = device.tillId;
  const t = <T>(p: Promise<T>, ms = 20_000) => withTimeout(p, ms);
  return {
    me: () => t(api.get<CurrentUser>("/auth/me", opts), 8_000),
    snapshot: (since) => t(api.get<TillSnapshot>(`/pos/till/${tillId}/snapshot${query({ since })}`, opts), 60_000),
    currentShift: () => t(api.get<ServerShift | null>(`/pos/till/${tillId}/shift`, opts), 10_000),
    openShift: (body) => t(api.post<ServerShift>("/pos/shifts", body, opts)),
    cashMovement: (shiftId, body) => t(api.post(`/pos/shifts/${shiftId}/cash-movements`, body, opts)),
    closeShift: (shiftId, body) => t(api.post<ServerShift>(`/pos/shifts/${shiftId}/close`, body, opts)),
    postBill: (body) => t(api.post<TransactionResult>("/pos/bills", body, opts), 25_000),
    billByClient: (clientId) => t(api.get<BillByClient>(`/pos/bills/by-client/${encodeURIComponent(clientId)}`, opts), 10_000),
    drawerOpening: (body) => t(api.post("/pos/drawer-openings", body, opts), 10_000),
    findBills: (search) => t(api.get<{ rows: BillDto[] }>(`/pos/bills${query({ search, kind: "sale", pageSize: 20 })}`, opts), 10_000),
    reprint: (billId) => t(api.post<Receipt>(`/pos/bills/${billId}/reprint`, {}, opts)),
    people: () => t(api.get<{ managers: Person[]; cashiers: Person[] }>(`/pos/tills/${tillId}/people`, opts), 10_000),
    approve: (body) => t(api.post<{ token: string; manager: Person }>("/pos/approvals", { tillId, ...body }, opts)),
    switchCashier: (body) => t(api.post<{ token: string; cashier: Person }>("/pos/switch-cashier", { tillId, ...body }, opts)),
    settings: () => t(api.get<{ cashDifferenceApprovalAmount: string; printReceiptCopies: number; liveAllowed: boolean }>("/pos/settings", opts), 10_000),
    findOrders: (search, storeId) => t(api.get<{ rows: TillOrder[] }>(`/orders${query({ search: search || undefined, storeId, pageSize: 20 })}`, opts), 10_000),
    order: (id) => t(api.get<TillOrder>(`/orders/${id}`, opts), 10_000),
    orderAdvance: (id, body) => t(api.post<TillOrder>(`/pos/orders/${id}/advances`, { tillId, ...body }, opts)),
    cancelOrder: (id, body) => t(api.post<TillOrder>(`/pos/orders/${id}/cancel`, { tillId, ...body }, opts)),
    customerCredit: (customerId) => t(api.get<{ available: string }>(`/orders/credit/${customerId}`, opts), 10_000),
    findAlterations: (view, storeId, search) => t(api.get<{ rows: TillAlteration[] }>(`/alterations${query({ view, search: search || undefined, storeId, pageSize: 30 })}`, opts), 10_000),
    createAlteration: (body) => t(api.post<TillAlteration>("/alterations", body, opts)),
    alterationStatus: (id, status) => t(api.post<TillAlteration>(`/alterations/${id}/status`, { status }, opts)),
    customerPoints: (customerId) => t(api.get<TillCustomerPoints>(`/pos/till/${tillId}/loyalty/${customerId}`, opts), 10_000),
    checkGiftCard: (number) => t(api.post<TillGiftCard>(`/pos/till/${tillId}/gift-cards/check`, { number }, opts), 10_000),
    sellGiftCard: (body) => t(api.post<GiftCardSaleResult>("/pos/gift-cards/sell", { tillId, ...body }, opts)),
  };
}

/** Could not reach the server, or the server is failing: work offline. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError ? err.statusCode === 0 || err.statusCode >= 500 : true;
}

/** Could not reach the server at all (no answer, or no answer in time). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError ? err.statusCode === 0 : true;
}

/** The server answered with a fault of its own (5xx): it is reached, but failing. */
export function isServerFault(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode >= 500;
}

/** Audit 5: the server says this computer is no longer registered as this till (403). */
export function isTillNotRegistered(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 403 && err.code === "TILL_NOT_REGISTERED";
}

/** Audit 5: a 409 "this clientId was already saved with other content", with the saved bill, or null. */
export function alreadySavedBill(err: unknown): TransactionResult | null {
  if (!(err instanceof ApiError) || err.statusCode !== 409 || err.code !== "BILL_ALREADY_SAVED") return null;
  const body = err.body as { transaction?: TransactionResult } | null | undefined;
  return body?.transaction ?? null;
}

/** The server total from a 409 "PRICE_CHANGED" answer on an online bill, or null. */
export function priceChangedTotal(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.statusCode !== 409 || !err.message.startsWith("PRICE_CHANGED")) return null;
  const m = /server total is ₹(-?[\d.]+)/.exec(err.message);
  return m ? m[1] : "";
}
