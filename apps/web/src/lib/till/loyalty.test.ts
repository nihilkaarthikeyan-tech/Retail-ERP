// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 at the till: points and gift cards paying part of a sale, returns of
// bills paid that way (decision 16, worked out as the server does), the online
// rule, selling gift cards, and the till's own receipt offline.
import type { PosTransactionInput } from "shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { GIFT_CARD_SALE_OFFLINE, POINTS_DROPPED, POINTS_LATER, POINTS_OFFLINE, TillEngine } from "./engine";
import { ARIEL, ASHA, BASMATI, CASH, fakeApi, PREFIX, sampleUser, snapshotWithLoyalty, TILL_ID } from "./fixtures";
import { buildTransaction, type DraftBill, type DraftLine, emptyDraft, priceBill } from "./pricing";
import { MemoryStore } from "./storage";
import type { GiftCardSaleResult, TransactionResult } from "./types";

const DATE = "2026-10-15";
const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");
const PCS = "d0000000-0000-4000-8000-000000000001";
const CARD_NO = "6123456789012347";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const asha = { id: ASHA, name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null };
const serverShift = { id: "s1", clientId: "sc", businessDate: DATE, openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] };

function line(itemId: string, quantity: string): DraftLine {
  return { key: `${itemId}-${quantity}`, itemId, unitId: PCS, quantity, barcode: null, priceOverride: null, discountPercent: "0" };
}

function draft(lines: DraftLine[], over: Partial<DraftBill> = {}): DraftBill {
  return { ...emptyDraft("d1", at), lines, ...over };
}

const price = (d: DraftBill) => priceBill(d, { snapshot: snapshotWithLoyalty(), date: DATE });

describe("points and gift cards on a sale", () => {
  it("100 points pay ₹100 of a ₹300 bill: ₹200 is left for cash, and the server is asked for the points", () => {
    const d = draft([line(ARIEL, "2")], { customer: asha, points: { points: 100, value: "100.00" }, payments: [{ methodId: CASH, amount: "200", reference: "" }] });
    const bill = price(d);
    expect(bill.problems).toEqual([]);
    expect([bill.net.toFixed(2), bill.pointsPaid.toFixed(2), bill.due.toFixed(2)]).toEqual(["300.00", "100.00", "200.00"]);
    const tx = buildTransaction(d, bill, snapshotWithLoyalty().till.paymentMethods, { clientId: "c", tillId: TILL_ID, shiftClientId: "s", soldAt: at.toISOString(), offline: false, numbers: { sale: `${PREFIX}000042` } });
    expect(tx.redeemPoints).toBe(100);
    expect(tx.payments).toEqual([{ paymentMethodId: CASH, amount: "200.00", reference: null }]);
  });

  it("a gift card pays the whole bill; the cash row is ₹0", () => {
    const d = draft([line(ARIEL, "2")], { giftCards: [{ number: CARD_NO, masked: "**** 2347", amount: "300.00", balance: "1000.00" }] });
    const bill = price(d);
    expect(bill.due.toFixed(2)).toBe("0.00");
    const tx = buildTransaction(d, bill, snapshotWithLoyalty().till.paymentMethods, { clientId: "c", tillId: TILL_ID, shiftClientId: "s", soldAt: at.toISOString(), offline: false, numbers: { sale: `${PREFIX}000042` } });
    expect(tx.giftCards).toEqual([{ number: CARD_NO, amount: "300.00" }]);
    expect(tx.payments).toEqual([{ paymentMethodId: CASH, amount: "0.00", reference: null }]);
  });

  it("more than half the bill in points, or points and cards above the bill, are shown as problems", () => {
    expect(price(draft([line(ARIEL, "2")], { customer: asha, points: { points: 200, value: "200.00" } })).problems).toEqual([expect.stringMatching(/At most 50% of the bill \(₹150.00\)/)]);
    expect(price(draft([line(BASMATI, "1")], { giftCards: [{ number: CARD_NO, masked: "**** 2347", amount: "500.00", balance: "1000.00" }] })).problems).toEqual(["Points and gift cards pay more than the bill; take some off in Pay"]);
  });
});

describe("a return of a bill paid with points or a gift card (decision 16)", () => {
  const ret = (quantity: string, over: Partial<NonNullable<DraftBill["ret"]>> = {}): DraftBill["ret"] => ({
    originalBillId: "b1",
    originalNumber: `${PREFIX}000042`,
    customerId: ASHA,
    reason: null,
    lines: [{ key: "r1", originalLineId: "l1", itemId: ARIEL, unitId: PCS, code: "ITM-000003", name: "Ariel", quantity, maxQuantity: "2", originalQuantity: "2", originalPrice: "250.00", originalDiscount: "0.00", originalLineTotal: "500.00", gstRate: "18", isFree: false }],
    originalTotal: "500.00",
    refundParts: { returnedTotal: "0.00", pointValue: "1", points: { spent: 100, restoredBefore: 0 }, giftCards: [] },
    allReturned: false,
    ...over,
  });

  it("returning half gives back 50 points (₹50) and the till refunds ₹200", () => {
    const bill = price(draft([], { ret: ret("1") }));
    expect(bill.net.toFixed(2)).toBe("-250.00");
    expect(bill.back).toMatchObject({ points: 50 });
    expect(bill.back!.pointsValue.toFixed(2)).toBe("50.00");
    expect(bill.due.toFixed(2)).toBe("-200.00");
  });

  it("returning the rest gives back exactly what is left; a card's share goes back on the card", () => {
    const rest = price(draft([], { ret: ret("1", { allReturned: true, refundParts: { returnedTotal: "250.00", pointValue: "1", points: { spent: 100, restoredBefore: 50 }, giftCards: [] } }) }));
    expect(rest.back).toMatchObject({ points: 50 });
    const card = price(draft([], { ret: ret("1", { refundParts: { returnedTotal: "0.00", pointValue: "1", points: null, giftCards: [{ key: "g1", number: "**** 2347", paid: "500.00", refundedBefore: "0.00", usable: true }] } }) }));
    expect(card.back!.giftCards.map((g) => [g.number, g.amount.toFixed(2)])).toEqual([["**** 2347", "250.00"]]);
    expect(card.due.toFixed(2)).toBe("0.00");
  });
});

describe("points and gift cards need the connection", () => {
  function engine(api = fakeApi()) {
    return new TillEngine({ store: new MemoryStore(), api, device, now: () => at, uuid });
  }

  it("a bill paid with points is refused offline and never queued", async () => {
    const e = engine();
    await e.store.set("snapshot", snapshotWithLoyalty());
    await e.start();
    await e.openShift("0", "Ravi");
    const { draft: d } = await e.loadDraft();
    await expect(e.finish({ ...d, customer: asha, lines: [line(ARIEL, "2")], points: { points: 100, value: "100.00" }, payments: [{ methodId: CASH, amount: "200", reference: "" }] })).rejects.toThrow(POINTS_OFFLINE);
    await expect(e.finish({ ...d, lines: [line(ARIEL, "2")], giftCards: [{ number: CARD_NO, masked: "**** 2347", amount: "300.00", balance: "300.00" }], payments: [] })).rejects.toThrow(POINTS_OFFLINE);
    expect((await e.queue.items()).map((i) => i.kind)).toEqual(["shift_open"]);
  });

  it("online it is sent with the points; when the connection drops it is not queued", async () => {
    const bodies: PosTransactionInput[] = [];
    let fail = false;
    const ok = { repeated: false, sale: null, return: null, net: "300.00", change: "0.00", receipts: [] } satisfies TransactionResult;
    const e = engine(
      fakeApi({
        me: async () => sampleUser,
        snapshot: async () => snapshotWithLoyalty(),
        currentShift: async () => serverShift,
        postBill: vi.fn(async (b: PosTransactionInput) => {
          bodies.push(b);
          if (fail) throw new ApiError(0, "Cannot reach the server");
          return ok;
        }),
      }),
    );
    await e.start();
    const { draft: d } = await e.loadDraft();
    const bill = { ...d, customer: asha, lines: [line(ARIEL, "2")], points: { points: 100, value: "100.00" }, payments: [{ methodId: CASH, amount: "200", reference: "" }] };
    await e.finish(bill);
    expect(bodies[0]).toMatchObject({ redeemPoints: 100, offline: false, payments: [{ paymentMethodId: CASH, amount: "200.00" }] });
    fail = true;
    const next = (await e.loadDraft()).draft;
    await expect(e.finish({ ...next, ...bill, id: next.id, clientId: null, numbers: {} })).rejects.toThrow(POINTS_DROPPED);
    expect(await e.queue.items()).toEqual([]);
  });

  it("selling a gift card needs the connection; online the receipt is kept for printing again", async () => {
    const offline = engine();
    await offline.store.set("snapshot", snapshotWithLoyalty());
    await offline.start();
    await offline.openShift("0", "Ravi");
    await expect(offline.sellGiftCard({ clientId: "g1", amount: "1000", paymentMethodId: CASH })).rejects.toThrow(GIFT_CARD_SALE_OFFLINE);

    const sold: GiftCardSaleResult = {
      repeated: false,
      card: { id: "c1", number: CARD_NO, holderName: null, holderPhone: null, customerId: null, issuedStoreId: "s", issuedOn: DATE, loadedTotal: "1000.00", balance: "1000.00", expiresOn: "2027-10-15", status: "active", blockedReason: null },
      receipt: { billId: null, number: "GC-2026-27-00001", kind: "sale", title: "GIFT CARD RECEIPT", duplicate: false, provisional: false, soldAt: at.toISOString(), till: "T1", footer: null, lines: [], gstTable: [], totals: { gross: "1000.00", discount: "0.00", taxable: "0.00", rounding: "0.00", total: "1000.00" }, payments: [], change: "0.00", giftCards: [{ action: "sold", number: "6123 4567 8901 2347", barcode: true, amount: "1000.00", balance: "1000.00", expiresOn: "2027-10-15" }] },
    };
    const sell = vi.fn(async () => sold);
    const e = engine(fakeApi({ me: async () => sampleUser, snapshot: async () => snapshotWithLoyalty(), currentShift: async () => serverShift, sellGiftCard: sell }));
    await e.start();
    const res = await e.sellGiftCard({ clientId: "g2", amount: "1000.00", paymentMethodId: CASH });
    expect(sell).toHaveBeenCalledWith({ clientId: "g2", amount: "1000.00", paymentMethodId: CASH });
    expect(res.card.number).toBe(CARD_NO);
    expect(await e.lastReceipts()).toEqual([sold.receipt]);
  });

  it("offline, a named customer's receipt says the points are added later; a walk-in's says nothing", async () => {
    const e = engine();
    await e.store.set("snapshot", snapshotWithLoyalty());
    await e.start();
    await e.openShift("0", "Ravi");
    let d = (await e.loadDraft()).draft;
    const named = await e.finish({ ...d, customer: asha, lines: [line(BASMATI, "1")], payments: [{ methodId: CASH, amount: "120", reference: "" }] });
    expect(named.receipts[0].loyalty).toMatchObject({ scheme: "Loyalty points", balance: null, note: POINTS_LATER });
    d = (await e.loadDraft()).draft;
    const walkIn = await e.finish({ ...d, lines: [line(BASMATI, "1")], payments: [{ methodId: CASH, amount: "120", reference: "" }] });
    expect(walkIn.receipts[0].loyalty).toBeNull();
  });
});
