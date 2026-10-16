// Copyright (c) 2026, Rademics. All rights reserved.
// The till's calls to the API. Every call carries the registered computer's
// token (x-till-token, pos-offline plan §9). A 401 never jumps to the login
// page from here: the till shows "sign in again" and keeps billing offline.
import type { ApprovalAction, CloseShiftInput, CurrentUser, OpenShiftInput, PosTransactionInput } from "shared";
import { api, ApiError, query } from "../api";
import { TILL_TOKEN_HEADER, type TillDeviceInfo } from "../till-device";
import type { BillDto, Person, Receipt, ServerShift, TillSnapshot, TransactionResult } from "./types";

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
  cashMovement(shiftId: string, body: { clientId: string; direction: "in" | "out"; amount: string; reason: string; at?: string }): Promise<unknown>;
  closeShift(shiftId: string, body: CloseShiftInput): Promise<ServerShift>;
  postBill(body: PosTransactionInput): Promise<TransactionResult>;
  findBills(search: string): Promise<{ rows: BillDto[] }>;
  reprint(billId: string): Promise<Receipt>;
  people(): Promise<{ managers: Person[]; cashiers: Person[] }>;
  approve(body: { managerId: string; pin: string; action: ApprovalAction; details?: string }): Promise<{ token: string; manager: Person }>;
  switchCashier(body: { userId: string; pin: string }): Promise<{ token: string; cashier: Person }>;
  settings(): Promise<{ cashDifferenceApprovalAmount: string; printReceiptCopies: number; liveAllowed: boolean }>;
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
    findBills: (search) => t(api.get<{ rows: BillDto[] }>(`/pos/bills${query({ search, kind: "sale", pageSize: 20 })}`, opts), 10_000),
    reprint: (billId) => t(api.post<Receipt>(`/pos/bills/${billId}/reprint`, {}, opts)),
    people: () => t(api.get<{ managers: Person[]; cashiers: Person[] }>(`/pos/tills/${tillId}/people`, opts), 10_000),
    approve: (body) => t(api.post<{ token: string; manager: Person }>("/pos/approvals", { tillId, ...body }, opts)),
    switchCashier: (body) => t(api.post<{ token: string; cashier: Person }>("/pos/switch-cashier", { tillId, ...body }, opts)),
    settings: () => t(api.get<{ cashDifferenceApprovalAmount: string; printReceiptCopies: number; liveAllowed: boolean }>("/pos/settings", opts), 10_000),
  };
}

/** Could not reach the server, or the server is failing: work offline. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError ? err.statusCode === 0 || err.statusCode >= 500 : true;
}

/** The server total from a 409 "PRICE_CHANGED" answer on an online bill, or null. */
export function priceChangedTotal(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.statusCode !== 409 || !err.message.startsWith("PRICE_CHANGED")) return null;
  const m = /server total is ₹(-?[\d.]+)/.exec(err.message);
  return m ? m[1] : "";
}
