// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13: what the loyalty and gift card report APIs answer, and plain words
// for their codes. The settings, customer and card shapes come from "shared".
import type { GiftCardDto, LoyaltyEntryDto } from "shared";

export interface PointsLiability {
  points: number;
  pointValue: string;
  value: string;
  pastExpiry: number;
  ledger: string;
  pending: string;
  difference: string;
  ok: boolean;
  topMembers: { customerId: string; code: string; name: string; points: number; value: string }[];
}

export interface PointsAmount {
  points: number;
  value: string;
}

export interface PointsMonth {
  month: string;
  earned: PointsAmount;
  spent: PointsAmount;
  expired: PointsAmount;
  takenBack: PointsAmount;
  givenBack: PointsAmount;
}

export interface PointsExpiring {
  from: string;
  to: string;
  points: number;
  value: string;
  rows: { customerId: string; code: string; name: string; mobile: string | null; points: number; firstExpiry: string; value: string }[];
}

export interface GiftCardPage {
  rows: GiftCardDto[];
  total: number;
  page: number;
  pageSize: number;
  balanceTotal: string;
}

export interface GiftCardLiability {
  cards: number;
  balance: string;
  byStatus: { status: string; cards: number; balance: string }[];
  ledger: string;
  pending: string;
  difference: string;
  ok: boolean;
}

export interface GiftCardMonth {
  month: string;
  loaded: string;
  spent: string;
  refunded: string;
  expired: string;
}

export interface GiftCardsExpiring {
  from: string;
  to: string;
  balance: string;
  rows: GiftCardDto[];
}

export const POINT_KIND_LABELS: Record<LoyaltyEntryDto["kind"], string> = {
  earn: "Earned",
  spend: "Spent",
  expire: "Expired",
  reverse_earn: "Taken back (return)",
  restore_spend: "Given back (return)",
};

export const CARD_STATUS_LABELS: Record<GiftCardDto["status"], string> = { active: "Active", blocked: "Blocked", expired: "Expired" };
export const CARD_STATUS_TONE: Record<GiftCardDto["status"], "ok" | "warn" | "off"> = { active: "ok", blocked: "warn", expired: "off" };

export const CARD_ENTRY_LABELS: Record<string, string> = { load: "Loaded", spend: "Spent", refund: "Refund from a return", expire: "Expired (written back)" };

/** "2026-10" → "October 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
