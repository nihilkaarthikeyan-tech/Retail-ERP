// Copyright (c) 2026, Rademics. All rights reserved.
// The till engine (pos-offline plan §11, plan 06 §8 "Web"): pricing parity
// with the server for scenario 6.1, offers, the number counter, the send queue
// and crash recovery, on an in-memory store in place of IndexedDB.
import { Decimal, type PosTransactionInput } from "shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { TillEngine } from "./engine";
import { ASHA, BASMATI, CARD, CASH, fakeApi, PARLE, PREFIX, sampleOffers, sampleSnapshot, sampleUser, SURF, TILL_ID, UPI } from "./fixtures";
import { formatNumber, NumberCounter, prefixFor } from "./numbers";
import { buildTransaction, checkPayments, type DraftBill, type DraftLine, emptyDraft, gstRateFor, listPriceFor, priceBill } from "./pricing";
import { SendQueue } from "./queue";
import { mergeSnapshot } from "./snapshot";
import { MemoryStore } from "./storage";
import type { TransactionResult } from "./types";

const DATE = "2026-10-15";
const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z"); // 10:30 in India

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function line(itemId: string, quantity: string, over: Partial<DraftLine> = {}): DraftLine {
  return { key: `${itemId}-${quantity}-${Math.random()}`, itemId, unitId: "d0000000-0000-4000-8000-000000000001", quantity, barcode: null, priceOverride: null, discountPercent: "0", ...over };
}

function draft(lines: DraftLine[], over: Partial<DraftBill> = {}): DraftBill {
  return { ...emptyDraft("d1", at), lines, ...over };
}

describe("pricing on the till matches the server (scenario 6.1)", () => {
  it("2 × ₹120 at 5% + 1 × ₹132 at 18% = ₹372.00 with the server's GST split", () => {
    const bill = priceBill(draft([line(BASMATI, "2"), line(SURF, "1")]), { snapshot: sampleSnapshot(), date: DATE });
    expect(bill.problems).toEqual([]);
    expect(bill.net.toFixed(2)).toBe("372.00");
    const [rice, surf] = bill.sale!.lines;
    expect([rice.tax.taxable.toFixed(2), rice.tax.cgst.toFixed(2), rice.tax.sgst.toFixed(2)]).toEqual(["228.57", "5.72", "5.71"]);
    expect([surf.tax.taxable.toFixed(2), surf.tax.cgst.toFixed(2), surf.tax.sgst.toFixed(2)]).toEqual(["111.86", "10.07", "10.07"]);
    expect(bill.sale!.taxable.toFixed(2)).toBe("340.43");
    expect(bill.sale!.rounding.toFixed(2)).toBe("0.00");
    expect(bill.provisional).toBe(true);
    const pay = checkPayments(bill.net, [{ methodId: CASH, amount: "500", reference: "" }], sampleSnapshot().till.paymentMethods);
    expect(pay.change.toFixed(2)).toBe("128.00");
    expect(pay.problem).toBeNull();
  });

  it("a return from 6.1 gives back ₹120.00 with taxable ₹114.29, CGST ₹2.86, SGST ₹2.85 (scenario 6.2)", () => {
    const d = draft([], {
      ret: {
        originalBillId: "b1",
        originalNumber: `${PREFIX}000042`,
        customerId: "w",
        reason: null,
        lines: [{ key: "r1", originalLineId: "l1", itemId: BASMATI, unitId: "d0000000-0000-4000-8000-000000000001", code: "ITM-000001", name: "Basmati", quantity: "1", maxQuantity: "2", originalQuantity: "2", originalPrice: "120.00", originalDiscount: "0.00", originalLineTotal: "240.00", gstRate: "5", isFree: false }],
      },
    });
    const bill = priceBill(d, { snapshot: sampleSnapshot(), date: DATE });
    expect(bill.net.toFixed(2)).toBe("-120.00");
    const l = bill.ret!.lines[0];
    expect([l.tax.taxable.toFixed(2), l.tax.cgst.toFixed(2), l.tax.sgst.toFixed(2)]).toEqual(["-114.29", "-2.86", "-2.85"]);
    // Refunds only by refund methods, exactly the amount.
    expect(checkPayments(bill.net, [{ methodId: UPI, amount: "120", reference: "x" }], sampleSnapshot().till.paymentMethods).problem).toMatch(/cannot be used for refunds/);
    expect(checkPayments(bill.net, [{ methodId: CASH, amount: "120", reference: "" }], sampleSnapshot().till.paymentMethods).problem).toBeNull();
    // Returning more than is left is refused.
    const over = priceBill({ ...d, ret: { ...d.ret!, lines: [{ ...d.ret!.lines[0], quantity: "3" }] } }, { snapshot: sampleSnapshot(), date: DATE });
    expect(over.problems[0]).toMatch(/only 2 left to return/);
  });

  it("an exchange nets the return against the new goods: Surf back, Ariel out, pays ₹18.00 (scenario 6.3)", () => {
    const d = draft([line("10000000-0000-4000-8000-000000000003", "1")], {
      ret: {
        originalBillId: "b1",
        originalNumber: `${PREFIX}000042`,
        customerId: "w",
        reason: null,
        lines: [{ key: "r1", originalLineId: "l2", itemId: SURF, unitId: "d0000000-0000-4000-8000-000000000001", code: "ITM-000002", name: "Surf", quantity: "1", maxQuantity: "1", originalQuantity: "1", originalPrice: "132.00", originalDiscount: "0.00", originalLineTotal: "132.00", gstRate: "18", isFree: false }],
      },
    });
    const bill = priceBill(d, { snapshot: sampleSnapshot(), date: DATE });
    expect(bill.net.toFixed(2)).toBe("18.00");
  });

  it("card and UPI need their reference; card over the total without cash is refused (scenario 6.6)", () => {
    const methods = sampleSnapshot().till.paymentMethods;
    expect(checkPayments(new Decimal("899"), [{ methodId: CARD, amount: "500", reference: "" }, { methodId: UPI, amount: "399", reference: "UPI1" }], methods).problem).toMatch(/Card needs the approval code/);
    expect(checkPayments(new Decimal("899"), [{ methodId: CARD, amount: "500", reference: "482913" }, { methodId: UPI, amount: "399", reference: "UPI1" }], methods)).toMatchObject({ problem: null });
    expect(checkPayments(new Decimal("899"), [{ methodId: CARD, amount: "900", reference: "1" }], methods).problem).toMatch(/only cash can give change/);
  });

  it("the cashier may give 5%; 12% needs a manager; above the item's maximum or MRP is refused (scenario 6.8)", () => {
    const s = sampleSnapshot();
    expect(priceBill(draft([line(BASMATI, "1", { discountPercent: "5" })]), { snapshot: s, date: DATE }).approvals).toEqual([]);
    const twelve = priceBill(draft([line(BASMATI, "1", { discountPercent: "12" })]), { snapshot: s, date: DATE });
    expect(twelve.approvals[0]).toMatchObject({ kind: "discount" });
    expect(priceBill(draft([line(BASMATI, "1", { discountPercent: "12", approvalToken: "t" })]), { snapshot: s, date: DATE }).approvals).toEqual([]);
    expect(priceBill(draft([line(BASMATI, "1", { discountPercent: "20", approvalToken: "t" })]), { snapshot: s, date: DATE }).problems[0]).toMatch(/maximum/);
    expect(priceBill(draft([line(BASMATI, "1", { priceOverride: "131", approvalToken: "t" })]), { snapshot: s, date: DATE }).problems[0]).toMatch(/above the MRP/);
  });

  it("chooses buy-2-get-1 over 10% off when it saves more, with a free line (scenario 6.9)", () => {
    const s = sampleSnapshot({ offers: sampleOffers });
    const bill = priceBill(draft([line(PARLE, "2")]), { snapshot: s, date: DATE });
    expect(bill.sale!.lines).toHaveLength(2);
    const [paid, free] = bill.sale!.lines;
    expect(paid.offer?.code).toBe("PARLE-B2G1");
    expect(paid.amount.toFixed(2)).toBe("20.00");
    expect(free).toMatchObject({ isFree: true, freeOfLineNo: 1, lineNo: 1001 });
    expect(free.quantity.toString()).toBe("1");
    expect(bill.net.toFixed(2)).toBe("20.00");
    // With only 10% eligible (quantity 1), the percentage applies.
    const one = priceBill(draft([line(PARLE, "1")]), { snapshot: s, date: DATE });
    expect(one.sale!.lines[0].offer?.code).toBe("BISCUITS10");
    expect(one.net.toFixed(2)).toBe("9.00");
  });

  it("finds the GST rate by the longest HSN prefix and the latest start date", () => {
    const rates = [
      { hsnCode: "3402", rate: "18", effectiveFrom: "2026-04-01", approved: true },
      { hsnCode: "340220", rate: "12", effectiveFrom: "2026-04-01", approved: true },
      { hsnCode: "340220", rate: "5", effectiveFrom: "2026-11-01", approved: true },
    ];
    expect(gstRateFor(rates, "34022010", DATE)?.rate).toBe("12");
    expect(gstRateFor(rates, "34022010", "2026-11-02")?.rate).toBe("5");
    expect(gstRateFor(rates, "34029000", DATE)?.rate).toBe("18");
    expect(gstRateFor(rates, "9999", DATE)).toBeNull();
  });

  it("offline bills carry charged figures that add up; online bills carry the expected total", () => {
    const s = sampleSnapshot({ offers: sampleOffers });
    const d = draft([line(PARLE, "2"), line(BASMATI, "1", { discountPercent: "5" })], { billDiscount: { amount: "1" }, payments: [{ methodId: CASH, amount: "200", reference: "" }] });
    const bill = priceBill(d, { snapshot: s, date: DATE });
    const opts = { clientId: uuid(), tillId: TILL_ID, shiftClientId: uuid(), soldAt: at.toISOString(), numbers: { sale: `${PREFIX}000042` } };
    const offline = buildTransaction(d, bill, s.till.paymentMethods, { ...opts, offline: true });
    expect(offline.expectedTotal).toBeUndefined();
    expect(offline.sale!.lines.some((l) => l.freeOfLineNo === 1)).toBe(true);
    for (const l of offline.sale!.lines.filter((x) => x.charged)) {
      const c = l.charged!;
      const recomputed = new Decimal(c.price).mul(l.quantity).toDecimalPlaces(2).sub(c.discountAmount).sub(c.offerDiscount ?? "0");
      expect(recomputed.toFixed(2)).toBe(new Decimal(c.lineTotal).toFixed(2));
    }
    const sum = offline.sale!.lines.reduce((a, l) => a.add(l.charged?.lineTotal ?? "0"), new Decimal(0));
    expect(sum.toFixed(2)).toBe(bill.sale!.exact.toFixed(2));
    const online = buildTransaction(d, bill, s.till.paymentMethods, { ...opts, offline: false });
    expect(online.expectedTotal).toBe(bill.net.toFixed(2));
    expect(online.sale!.lines.every((l) => !l.charged && !l.freeOfLineNo)).toBe(true);
  });
});

describe("list price from the till's saved copy (module 2 lookup rules)", () => {
  const BOX = "c0000000-0000-4000-8000-0000000000b0";
  const DEFAULT_LIST = "f0000000-0000-4000-8000-0000000000d0";
  function withBox(perUnit: boolean, fallback: boolean) {
    const s = sampleSnapshot();
    const parle = s.items.find((i) => i.id === PARLE)!;
    parle.units = [...parle.units, { unitId: BOX, code: "BOX", factor: "12", allowsFractions: false, mrp: null }];
    s.till.pricesPerUnit = perUnit;
    if (fallback) {
      s.till.fallbackPriceList = { id: DEFAULT_LIST, pricesPerUnit: false };
      s.prices = s.prices.filter((p) => p.itemId !== PARLE);
      s.prices.push({ id: "p-default", priceListId: DEFAULT_LIST, itemId: PARLE, unitId: s.items[0].baseUnitId, price: "11", startDate: "2026-04-01", endDate: null, customerId: null, batchId: null, packSize: null });
    }
    return { s, parle };
  }
  it("scales a basic-unit price to a box on a per-basic-unit list", () => {
    const { s, parle } = withBox(false, false);
    expect(listPriceFor(s, parle, BOX, "1", null, "2026-10-15")?.toFixed(2)).toBe("120.00");
  });
  it("uses the price as written on a per-unit list", () => {
    const { s, parle } = withBox(true, false);
    expect(listPriceFor(s, parle, BOX, "1", null, "2026-10-15")?.toFixed(2)).toBe("10.00");
  });
  it("falls back to the default selling list when the till's list has no price", () => {
    const { s, parle } = withBox(false, true);
    expect(listPriceFor(s, parle, parle.baseUnitId, "1", null, "2026-10-15")?.toFixed(2)).toBe("11.00");
  });
});

describe("bill numbers never clash (pos-offline §3)", () => {
  it("never reuses a number, not even across a restart, and never goes below the server's last number", async () => {
    const store = new MemoryStore();
    const counter = new NumberCounter(store);
    const [a, b, c] = await Promise.all([counter.next(PREFIX, `${PREFIX}000041`), counter.next(PREFIX, `${PREFIX}000041`), counter.next(PREFIX, `${PREFIX}000041`)]);
    expect(new Set([a, b, c]).size).toBe(3);
    expect([a, b, c].sort()).toEqual([formatNumber(PREFIX, 42), formatNumber(PREFIX, 43), formatNumber(PREFIX, 44)]);
    // The counter was saved before the number was handed out: a "restarted" till carries on.
    const again = new NumberCounter(store);
    expect(await again.next(PREFIX, `${PREFIX}000041`)).toBe(`${PREFIX}000045`);
    // The server has seen a higher number (e.g. the browser data was restored): jump above it.
    expect(await again.next(PREFIX, `${PREFIX}000100`)).toBe(`${PREFIX}000101`);
  });

  it("uses the financial year of the business date", () => {
    expect(prefixFor(sampleSnapshot(), DATE).prefix).toBe(PREFIX);
    expect(() => prefixFor(sampleSnapshot(), "2027-04-01")).toThrow(/No open financial year/);
  });
});

describe("the send queue (pos-offline §4)", () => {
  it("keeps one item per clientId, retries network failures and sends in order", async () => {
    const store = new MemoryStore();
    let clock = new Date("2026-10-15T05:00:00Z");
    const sent: string[] = [];
    let fail = true;
    const q = new SendQueue(store, async (item) => {
      if (fail) throw new ApiError(0, "offline");
      sent.push(item.clientId);
      return {};
    }, () => clock);
    await q.enqueue({ clientId: "A", kind: "shift_open", label: "shift", payload: {} });
    await q.enqueue({ clientId: "B", kind: "bill", label: "bill", payload: {} });
    await q.enqueue({ clientId: "B", kind: "bill", label: "bill again", payload: {} });
    expect((await q.items()).map((i) => i.clientId)).toEqual(["A", "B"]);

    const r1 = await q.process();
    expect(r1).toMatchObject({ sent: 0, offline: true });
    const [first] = await q.items();
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt).not.toBeNull();

    fail = false;
    expect(await q.process()).toMatchObject({ sent: 0, deferred: true }); // still waiting out the retry delay
    clock = new Date(clock.getTime() + 60_000);
    expect(await q.process()).toMatchObject({ sent: 2 });
    expect(sent).toEqual(["A", "B"]);
    expect(await q.items()).toEqual([]);
  });

  it("puts a refused item on the problem list and carries on with the rest", async () => {
    const store = new MemoryStore();
    const q = new SendQueue(store, async (item) => {
      if (item.clientId === "bad") throw new ApiError(400, "Bill number is not in this till's series");
      return {};
    });
    await q.enqueue({ clientId: "bad", kind: "bill", label: "bad", payload: {} });
    await q.enqueue({ clientId: "good", kind: "bill", label: "good", payload: {} });
    expect(await q.process()).toMatchObject({ sent: 1, problems: 1 });
    expect(await q.counts()).toEqual({ waiting: 0, problems: 1 });
    expect((await q.items())[0]).toMatchObject({ clientId: "bad", status: "problem", error: "Bill number is not in this till's series" });
  });

  it("stops on a 401 without losing anything", async () => {
    const q = new SendQueue(new MemoryStore(), async () => {
      throw new ApiError(401, "Signed out");
    });
    await q.enqueue({ clientId: "x", kind: "bill", label: "x", payload: {} });
    expect(await q.process()).toMatchObject({ signedOut: true, sent: 0 });
    expect(await q.counts()).toEqual({ waiting: 1, problems: 0 });
  });
});

describe("snapshot refresh", () => {
  it("merges changed items and customers into the saved copy", () => {
    const old = sampleSnapshot();
    const changed = { ...old.items[0], name: "Basmati Rice 1 kg (new pack)" };
    const merged = mergeSnapshot(old, { ...sampleSnapshot(), full: false, items: [changed], customers: [] });
    expect(merged.items).toHaveLength(old.items.length);
    expect(merged.items.find((i) => i.id === BASMATI)?.name).toBe("Basmati Rice 1 kg (new pack)");
    expect(merged.customers).toHaveLength(old.customers.length);
  });
});

describe("the till engine", () => {
  function engine(store = new MemoryStore(), api = fakeApi()) {
    return new TillEngine({ store, api, device, now: () => at, uuid });
  }

  async function ready(e: TillEngine) {
    await e.store.set("snapshot", sampleSnapshot());
    await e.start();
  }

  it("restores the bill being made after a crash ('Bill restored')", async () => {
    const store = new MemoryStore();
    const e1 = engine(store);
    await ready(e1);
    const d = (await e1.loadDraft()).draft;
    await e1.saveDraft({ ...d, lines: [line(BASMATI, "2")], customer: { id: ASHA, name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null } });
    // The browser closes; a new page opens on the same till database.
    const e2 = engine(store);
    await e2.start();
    const { draft: restored, restored: flag } = await e2.loadDraft();
    expect(flag).toBe(true);
    expect(restored.lines).toHaveLength(1);
    expect(restored.customer?.name).toBe("Asha");
  });

  it("bills offline: queued with offline: true and charged figures, own receipt, number from the counter", async () => {
    const e = engine();
    await ready(e);
    await e.openShift("2000", "Ravi");
    const { draft: d } = await e.loadDraft();
    const res = await e.finish({ ...d, lines: [line(BASMATI, "2"), line(SURF, "1")], payments: [{ methodId: CASH, amount: "500", reference: "" }] });
    expect(res.offline).toBe(true);
    expect(res.change).toBe("128.00");
    expect(res.receipts[0]).toMatchObject({ number: `${PREFIX}000042`, totals: { total: "372.00" } });
    const items = await e.queue.items();
    expect(items.map((i) => i.kind)).toEqual(["shift_open", "bill"]);
    const tx = items[1].payload as PosTransactionInput;
    expect(tx.offline).toBe(true);
    expect(tx.sale!.lines[0].charged).toMatchObject({ lineTotal: "240.00", gstRate: "5" });
    expect(e.getState().waiting).toBe(2);
    // The bill being made is cleared once the bill is finished.
    expect((await e.loadDraft()).restored).toBe(false);
  });

  it("a finished bill in the queue is resent and marked sent once the server confirms it", async () => {
    const store = new MemoryStore();
    const e1 = engine(store);
    await ready(e1);
    await e1.openShift("2000", "Ravi");
    const { draft: d } = await e1.loadDraft();
    await e1.finish({ ...d, lines: [line(BASMATI, "1")], payments: [{ methodId: CASH, amount: "120", reference: "" }] });

    const posted: string[] = [];
    const api = fakeApi({
      me: async () => sampleUser,
      snapshot: async () => sampleSnapshot(),
      currentShift: async () => null,
      openShift: async (b) => ({ id: "s1", clientId: b.clientId, businessDate: DATE, openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: b.cash, cashMovements: [] }),
      postBill: async (b) => {
        posted.push(b.clientId);
        return { repeated: posted.length > 1, sale: null, return: null, net: "120.00", change: "0.00", receipts: [] } satisfies TransactionResult;
      },
    });
    const e2 = engine(store, api);
    await e2.start();
    expect(posted).toHaveLength(1);
    expect(await e2.queue.items()).toEqual([]);
    expect(e2.getState()).toMatchObject({ online: true, waiting: 0, problems: 0 });
    expect(e2.getState().shift?.id).toBe("s1");
  });

  it("an online bill whose total changed on the server is not finished; the cashier sees the server total", async () => {
    const api = fakeApi({
      me: async () => sampleUser,
      snapshot: async () => sampleSnapshot(),
      currentShift: async () => ({ id: "s1", clientId: "sc", businessDate: DATE, openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] }),
      postBill: vi.fn(async () => {
        throw new ApiError(409, "PRICE_CHANGED: the server total is ₹125.00, the till showed ₹120.00; check the bill again");
      }),
    });
    const e = engine(new MemoryStore(), api);
    await e.start();
    const { draft: d } = await e.loadDraft();
    await expect(e.finish({ ...d, lines: [line(BASMATI, "1")], payments: [{ methodId: CASH, amount: "120", reference: "" }] })).rejects.toMatchObject({ name: "PriceChangedError", serverTotal: "125.00", tillTotal: "120.00" });
    expect(await e.queue.items()).toEqual([]);
    // The identity and number stay with the bill for the next try.
    const kept = (await e.loadDraft()).draft;
    expect(kept.clientId).not.toBeNull();
    expect(kept.numbers.sale).toBe(`${PREFIX}000042`);
  });

  it("refuses to close the shift while entries wait to be sent, saying how many", async () => {
    const e = engine();
    await ready(e);
    await e.openShift("2000", "Ravi");
    await e.cashMovement("out", "200", "Tea");
    await expect(e.closingInfo()).rejects.toThrow(/2 entries are still waiting to be sent/);
  });
});
