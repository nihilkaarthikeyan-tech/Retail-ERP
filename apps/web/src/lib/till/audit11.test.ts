// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 11 (tests): the till's own checks that no earlier test reached: why a line cannot be
// billed, the bill discount, the buyer on a business invoice, refund payments, and how much of a
// bill line can still come back.
import { describe, expect, it } from "vitest";
import { Decimal } from "shared";
import { leftToReturn } from "@/components/till/return-dialog";
import { TillEngine } from "./engine";
import { BASMATI, CARD, CASH, fakeApi, PCS, sampleSnapshot, SURF, TILL_ID, UPI } from "./fixtures";
import { checkPayments, type DraftBill, type DraftLine, emptyDraft, priceBill } from "./pricing";
import { MemoryStore } from "./storage";
import type { BillDto } from "./types";

const DATE = "2026-10-15";
const at = new Date("2026-10-15T05:00:00.000Z");

function line(itemId: string, quantity: string, over: Partial<DraftLine> = {}): DraftLine {
  return { key: `${itemId}-${quantity}`, itemId, unitId: PCS, quantity, barcode: null, priceOverride: null, discountPercent: "0", ...over };
}

function bill(lines: DraftLine[], over: Partial<DraftBill> = {}, snapshot = sampleSnapshot()) {
  return priceBill({ ...emptyDraft("d", at), lines, ...over }, { snapshot, date: DATE });
}

describe("why a line cannot be billed", () => {
  it("an item gone from the till's list", () => {
    expect(bill([line("10000000-0000-4000-8000-0000000000aa", "1")]).problems).toContain("Line 1: the item is no longer in the till's list");
  });

  it("an item that can no longer be sold, a missing serial, no price, no GST rate", () => {
    const s = sampleSnapshot();
    const items = s.items.map((i) => (i.id === BASMATI ? { ...i, active: false } : i.id === SURF ? { ...i, trackSerials: true } : i));
    const lineProblem = (b: ReturnType<typeof bill>, i: number) => b.sale?.lines[i]?.problem;
    const one = bill([line(BASMATI, "1"), line(SURF, "2", { serials: "SN1" })], {}, { ...s, items });
    expect(lineProblem(one, 0)).toMatch(/can no longer be sold/);
    expect(lineProblem(one, 1)).toMatch(/scan the 2 serial number\(s\)/);

    const noPrice = bill([line(BASMATI, "1")], {}, { ...s, prices: s.prices.filter((p) => p.itemId !== BASMATI) });
    expect(lineProblem(noPrice, 0)).toMatch(/has no price in the till's price list/);

    const noRate = bill([line(BASMATI, "1")], {}, { ...s, gstRates: s.gstRates.filter((r) => r.hsnCode !== "1006") });
    expect(lineProblem(noRate, 0)).toMatch(/No GST rate is set for HSN 1006/);
  });
});

describe("the bill as a whole", () => {
  it("a bill discount bigger than the bill is refused", () => {
    const b = bill([line(BASMATI, "1")], { billDiscount: { amount: "500", approvalToken: "t" } });
    expect(b.problems).toContain("The bill discount is more than the bill");
  });

  it("a business invoice needs the buyer's name and address", () => {
    const buyer = { gstin: "33AAAAA0000A1Z5", name: "", address: "", stateCode: "33" };
    expect(bill([line(BASMATI, "1")], { buyer }).problems).toContain("A business tax invoice needs the buyer's name and address");
    expect(bill([line(BASMATI, "1")], { buyer: { ...buyer, name: "Ram Traders", address: "2 Main Road" } }).problems).not.toContain("A business tax invoice needs the buyer's name and address");
  });
});

describe("refund payments", () => {
  const methods = sampleSnapshot().till.paymentMethods;
  const pay = (methodId: string, amount: string) => [{ methodId, amount, reference: "R1" }];
  const net = new Decimal("-100");

  it("a method that does not allow refunds is refused", () => {
    expect(checkPayments(net, pay(UPI, "100"), methods).problem).toBe("UPI cannot be used for refunds");
  });

  it("the refund must be exactly the amount; less leaves a balance to refund", () => {
    expect(checkPayments(net, pay(CASH, "120"), methods).problem).toBe("The refund must be exactly ₹100.00");
    const short = checkPayments(net, pay(CARD, "90"), methods);
    expect(short.problem).toBeNull();
    expect(short.short.toFixed(2)).toBe("10.00");
    const exact = checkPayments(net, pay(CASH, "100"), methods);
    expect(exact.problem).toBeNull();
    expect(exact.short.toFixed(2)).toBe("0.00");
    expect(exact.change.toFixed(2)).toBe("0.00");
  });
});

describe("how much of a bill line can still come back", () => {
  const l = (quantity: string, basicQuantity: string, returnedQuantity: string) => ({ quantity, basicQuantity, returnedQuantity }) as unknown as BillDto["lines"][number];
  it("in the line's own unit, never below zero", () => {
    expect(leftToReturn(l("2", "24", "5")).toString()).toBe("1.583");
    expect(leftToReturn(l("2", "24", "0")).toString()).toBe("2");
    expect(leftToReturn(l("2", "24", "24")).toString()).toBe("0");
    expect(leftToReturn(l("2", "24", "30")).toString()).toBe("0");
    expect(leftToReturn(l("2", "0", "0")).toString()).toBe("0");
  });
});

describe("the till engine: parked bills and closing the shift", () => {
  const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  async function offlineTill() {
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
    const e = new TillEngine({ store, api: fakeApi(), device, now: () => at, uuid });
    await e.start();
    await e.openShift("0", "Ravi");
    return e;
  }

  it("a parked bill is kept on the till, comes back once, and is then gone from the list", async () => {
    const e = await offlineTill();
    const d1 = { ...emptyDraft("p1", at), lines: [line(BASMATI, "2")] };
    const d2 = { ...emptyDraft("p2", at), lines: [line(SURF, "1")] };
    await e.park(d1, "Lady in blue");
    await e.park(d2, "Mr Raju");
    expect((await e.parked()).map((p) => p.label).sort()).toEqual(["Lady in blue", "Mr Raju"]);
    const back = await e.recall("p1");
    expect(back?.lines.map((l) => [l.itemId, l.quantity])).toEqual([[BASMATI, "2"]]);
    expect((await e.loadDraft()).draft.id).toBe("p1");
    expect((await e.parked()).map((p) => p.label)).toEqual(["Mr Raju"]);
    expect(await e.recall("p1")).toBeNull();
  });

  it("the shift does not close while anything waits to be sent, saying how many", async () => {
    const e = await offlineTill();
    const { draft } = await e.loadDraft();
    await e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: [{ methodId: CASH, amount: "120", reference: "" }] });
    // Opened offline: the shift opening and the bill both wait.
    await expect(e.closeShift("s1", { denominations: {} } as never)).rejects.toThrow("2 still waiting to be sent");
  });
});
