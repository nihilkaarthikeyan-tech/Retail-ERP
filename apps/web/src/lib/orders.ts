// Copyright (c) 2026, Rademics. All rights reserved.
// Shapes of the customer-order and alteration-job API (plan 11 part 2).
import type { AlterationStatus, CustomerOrderStatus } from "shared";

export interface OrderLineDto {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string };
  unitId: string;
  unitCode: string;
  quantity: string;
  price: string;
  amount: string;
  remarks: string | null;
  setAside: string;
}

export interface OrderDto {
  id: string;
  number: string;
  status: CustomerOrderStatus;
  store: { id: string; code: string; name: string } | null;
  storeId: string;
  customer: { id: string; code: string; name: string; mobile: string | null } | null;
  customerId: string;
  expectedOn: string | null;
  overdue: boolean;
  total: string;
  advanceReceived: string;
  advanceRefunded: string;
  advanceHeld: string;
  readyAt: string | null;
  collectedAt: string | null;
  collectedBill: { id: string; number: string | null } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  advanceOutcome: "refund" | "keep_credit" | null;
  remarks: string | null;
  createdAt: string;
  lines?: OrderLineDto[];
  payments?: { id: string; number: string | null; kind: string; date: string | null; amount: string; reference: string | null; unused: string | null; remark: string | null }[];
}

export interface AlterationDto {
  id: string;
  number: string;
  status: AlterationStatus;
  store: { id: string; code: string; name: string } | null;
  storeId: string;
  customerId: string | null;
  name: string | null;
  phone: string | null;
  bill: { id: string; number: string | null } | null;
  tailorStaffId: string | null;
  tailorName: string | null;
  tailor: string | null;
  promisedOn: string | null;
  dueToday: boolean;
  overdue: boolean;
  charge: string;
  chargePaidWith: "bill" | "collection";
  chargeBill: { id: string; number: string | null } | null;
  deliveredAt: string | null;
  remarks: string | null;
  createdAt: string;
  lines: { id: string; lineNo: number; itemId: string | null; item: { id: string; code: string; name: string } | null; garment: string; work: string }[];
  history: { status: AlterationStatus; at: string; byId: string | null; by: string | null; remarks: string | null }[];
}

export const ORDER_STATUS_TONE: Record<CustomerOrderStatus, "warn" | "ok" | "off" | "neutral"> = { open: "neutral", ready: "warn", collected: "ok", cancelled: "off" };
export const JOB_STATUS_TONE: Record<AlterationStatus, "warn" | "ok" | "off" | "neutral"> = { received: "neutral", with_tailor: "neutral", ready: "warn", delivered: "ok", cancelled: "off" };
