// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 on the till: the new offers worked out the same way as the server
// (scenario 11.12), home delivery (11.13) and the salesperson (11.14), online
// and offline.
import { describe, expect, it } from "vitest";
import { TillEngine } from "./engine";
import { CASH, fakeApi, PREFIX, sampleSnapshot, TILL_ID } from "./fixtures";
import { buildTransaction, type DraftBill, type DraftLine, emptyDraft, priceBill } from "./pricing";
import { MemoryStore } from "./storage";
import type { SnapItem, SnapOffer, StoredSnapshot } from "./types";

const DATE = "2026-10-15";
const PCS = "d0000000-0000-4000-8000-000000000001";
const LIST = "f0000000-0000-4000-8000-000000000002";
const TEES = "20000000-0000-4000-8000-0000000000a1";
const TOPS = "20000000-0000-4000-8000-0000000000a2";
const SHIRTS = "20000000-0000-4000-8000-0000000000a3";
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEE = [id(1), id(2), id(3)];
const TOP_A = id(4);
const TOP_B = id(5);
const SHIRT = id(6);
const BELT = id(7);
const DELIVERY = id(8);
const PRIYA = id(21);
const ARUN = id(22);

function item(itemId: string, name: string, group: string, hsn = "6109", over: Partial<SnapItem> = {}): SnapItem {
  return { ...sampleSnapshot().items[0], id: itemId, code: `ITM-${itemId.slice(-4)}`, name, hsnCode: hsn, mrp: null, itemGroup: { id: group, path: `/${group}/` }, barcodes: [], ...over };
}

const price = (itemId: string, p: string) => ({ id: `price-${itemId}`, priceListId: LIST, itemId, unitId: PCS, price: p, startDate: "2026-04-01", endDate: null, customerId: null, batchId: null, packSize: null });

function offer(o: Partial<SnapOffer> & Pick<SnapOffer, "id" | "code" | "name" | "kind">): SnapOffer {
  return { appliesTo: "groups", targetIds: [], value: null, buyQuantity: null, freeQuantity: null, minQuantity: null, minAmount: null, storeIds: [], customerGroupId: null, startDate: "2026-10-01", endDate: null, priority: 0, couponOnly: false, active: true, ...o };
}

const ANY3 = offer({ id: id(31), code: "TEES-ANY3", name: "Any 3 tees for ₹999", kind: "mix_match", targetIds: [TEES], setQuantity: 3, setPrice: "999.00" });
const CHEAPEST = offer({ id: id(32), code: "TOPS-B2CF", name: "Buy 2 tops, cheapest free", kind: "mix_match", targetIds: [TOPS], setQuantity: 2, cheapestFree: true });
const BELT_FREE = offer({ id: id(33), code: "SHIRT-BELT", name: "Buy a shirt, get a belt free", kind: "buy_get", appliesTo: "items", targetIds: [SHIRT], buyQuantity: "1", freeQuantity: "1", freeItemId: BELT });

function snapshot(over: Partial<StoredSnapshot> = {}): StoredSnapshot {
  const s = sampleSnapshot();
  return {
    ...s,
    till: { ...s.till, delivery: { charge: "50.00", freeAbove: "2000.00", itemId: DELIVERY } },
    items: [
      ...TEE.map((t, i) => item(t, `Tee ${i + 1}`, TEES)),
      item(TOP_A, "Rayon top", TOPS),
      item(TOP_B, "Cotton top", TOPS),
      item(SHIRT, "Formal shirt", SHIRTS, "6205"),
      item(BELT, "Leather belt", SHIRTS, "4203"),
      item(DELIVERY, "Home delivery", SHIRTS, "9965", { isStockItem: false }),
    ],
    prices: [...TEE.map((t) => price(t, "399")), price(TOP_A, "599"), price(TOP_B, "499"), price(SHIRT, "1299"), price(BELT, "299")],
    gstRates: [
      { hsnCode: "6109", rate: "5", effectiveFrom: "2026-04-01", approved: false },
      { hsnCode: "6205", rate: "5", effectiveFrom: "2026-04-01", approved: false },
      { hsnCode: "4203", rate: "12", effectiveFrom: "2026-04-01", approved: false },
      { hsnCode: "9965", rate: "18", effectiveFrom: "2026-04-01", approved: false },
    ],
    offers: [ANY3, CHEAPEST, BELT_FREE],
    salesStaff: [
      { id: ARUN, code: "A1", name: "Arun" },
      { id: PRIYA, code: "P1", name: "Priya" },
    ],
    ...over,
  };
}

let k = 0;
function line(itemId: string, quantity = "1", over: Partial<DraftLine> = {}): DraftLine {
  return { key: `k${++k}`, itemId, unitId: PCS, quantity, barcode: null, priceOverride: null, discountPercent: "0", ...over };
}

function draft(lines: DraftLine[], over: Partial<DraftBill> = {}): DraftBill {
  return { ...emptyDraft("d1", new Date("2026-10-15T05:00:00.000Z")), lines, ...over };
}

const options = (offline: boolean) => ({ clientId: "00000000-0000-4000-8000-000000000099", tillId: TILL_ID, shiftClientId: "00000000-0000-4000-8000-000000000098", soldAt: "2026-10-15T05:00:00.000Z", offline, numbers: { sale: `${PREFIX}000042` } });

describe("new offers on the till (plan 11 B3, scenario 11.12)", () => {
  it("any 3 for ₹999: ₹999.00 with ₹66.00 off each line; four tees ₹1,398.00", () => {
    const three = priceBill(draft(TEE.map((t) => line(t))), { snapshot: snapshot(), date: DATE });
    expect(three.problems).toEqual([]);
    expect(three.net.toFixed(2)).toBe("999.00");
    expect(three.sale!.lines.map((l) => [l.offerDiscount.toFixed(2), l.amount.toFixed(2), l.offer?.code])).toEqual([
      ["66.00", "333.00", "TEES-ANY3"],
      ["66.00", "333.00", "TEES-ANY3"],
      ["66.00", "333.00", "TEES-ANY3"],
    ]);
    expect(three.offers.map((o) => [o.offer.name, o.saving.toFixed(2)])).toEqual([["Any 3 tees for ₹999", "198.00"]]);
    const four = priceBill(draft([line(TEE[0], "2"), line(TEE[1], "2")]), { snapshot: snapshot(), date: DATE });
    expect(four.net.toFixed(2)).toBe("1398.00");
  });

  it("buy 2, cheapest free: the ₹499 top is free and the bill is ₹599.00", () => {
    const bill = priceBill(draft([line(TOP_A), line(TOP_B)]), { snapshot: snapshot(), date: DATE });
    expect(bill.net.toFixed(2)).toBe("599.00");
    expect(bill.sale!.lines.map((l) => l.amount.toFixed(2))).toEqual(["599.00", "0.00"]);
  });

  it("buy a shirt, get a belt: a free belt line at ₹0, sent offline with the line it belongs to", () => {
    const d = draft([line(SHIRT)]);
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.net.toFixed(2)).toBe("1299.00");
    const free = bill.sale!.lines.find((l) => l.isFree)!;
    expect([free.item.id, free.quantity.toString(), free.amount.toFixed(2), free.lineNo, free.freeOfLineNo, free.gstRate.toString()]).toEqual([BELT, "1", "0.00", 1001, 1, "12"]);
    expect(bill.offers.map((o) => [o.offer.code, o.saving.toFixed(2)])).toEqual([["SHIRT-BELT", "299.00"]]);
    const methods = snapshot().till.paymentMethods;
    const online = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "1299", reference: "" }] }, bill, methods, options(false));
    expect(online.sale!.lines).toHaveLength(1);
    const offline = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "1299", reference: "" }] }, bill, methods, options(true));
    expect(offline.sale!.lines[1]).toMatchObject({ lineNo: 1001, itemId: BELT, quantity: "1", offerId: BELT_FREE.id, freeOfLineNo: 1 });
    // A belt without a price is not given (the server does the same).
    const noBelt = priceBill(d, { snapshot: snapshot({ prices: snapshot().prices.filter((p) => p.itemId !== BELT) }), date: DATE });
    expect(noBelt.sale!.lines.some((l) => l.isFree)).toBe(false);
  });

  it("offline bills carry the set-price discount the server checks", () => {
    const d = draft(TEE.map((t) => line(t)));
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    const tx = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "999", reference: "" }] }, bill, snapshot().till.paymentMethods, options(true));
    expect(tx.sale!.lines.map((l) => l.charged)).toEqual(TEE.map(() => ({ listPrice: "399.00", price: "399.00", discountAmount: "0.00", offerDiscount: "66.00", gstRate: "5", lineTotal: "333.00" })));
  });
});

describe("home delivery on the till (plan 11 B4, scenario 11.13)", () => {
  const delivery = { name: "Lakshmi", address: "12 Gandhi Street", phone: "9840012345", deliverOn: DATE, remarks: "" };

  it("₹50.00 below ₹2,000 as a delivery line the server adds; none above it", () => {
    const d = draft([line(SHIRT)], { delivery });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.net.toFixed(2)).toBe("1349.00");
    const charge = bill.sale!.lines.find((l) => l.isDelivery)!;
    expect([charge.lineNo, charge.amount.toFixed(2), charge.gstRate.toString()]).toEqual([2, "50.00", "18"]);
    const online = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "1349", reference: "" }] }, bill, snapshot().till.paymentMethods, options(false));
    expect(online.sale!.lines.map((l) => l.itemId)).toEqual([SHIRT]);
    expect(online.delivery).toEqual({ name: "Lakshmi", address: "12 Gandhi Street", phone: "9840012345", deliverOn: DATE });
    expect(online.expectedTotal).toBe("1349.00");
    const offline = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "1349", reference: "" }] }, bill, snapshot().till.paymentMethods, options(true));
    expect(offline.delivery).toMatchObject({ charge: "50.00" });

    const big = priceBill(draft([line(SHIRT, "2")], { delivery }), { snapshot: snapshot(), date: DATE });
    expect(big.net.toFixed(2)).toBe("2598.00");
    expect(big.sale!.lines.some((l) => l.isDelivery)).toBe(false);
    expect(big.delivery?.charge.toFixed(2)).toBe("0.00");
  });

  it("says so when the delivery charge item is not set up", () => {
    const s = snapshot();
    const bill = priceBill(draft([line(SHIRT)], { delivery }), { snapshot: { ...s, till: { ...s.till, delivery: { charge: "50.00", freeAbove: null, itemId: null } } }, date: DATE });
    expect(bill.problems[0]).toMatch(/delivery charge item is not set up/);
  });
});

describe("salesperson on the till (plan 11 C1, scenario 11.14)", () => {
  it("the bill's salesperson goes on every line unless a line names its own; both are sent", () => {
    const d = draft([line(TOP_A), line(TEE[0], "1", { salesStaffId: ARUN })], { salesStaffId: PRIYA });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.sale!.lines.map((l) => l.salesStaffId)).toEqual([PRIYA, ARUN]);
    const tx = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "2000", reference: "" }] }, bill, snapshot().till.paymentMethods, options(false));
    expect(tx.salesStaffId).toBe(PRIYA);
    expect(tx.sale!.lines.map((l) => l.salesStaffId)).toEqual([undefined, ARUN]);
  });

  it("an offline bill keeps the salesperson, and the till's own receipt names them", async () => {
    const store = new MemoryStore();
    await store.set("snapshot", snapshot());
    const sent: unknown[] = [];
    const engine = new TillEngine({ store, api: fakeApi({ postBill: (b) => (sent.push(b), Promise.reject(new Error("offline"))) }), device: { tillId: TILL_ID, tillCode: "T1", deviceName: "PC", token: "t" }, now: () => new Date("2026-10-15T05:00:00.000Z") });
    await store.set("shift", { clientId: "00000000-0000-4000-8000-000000000098", id: null, businessDate: DATE, openedAt: "2026-10-15T03:00:00.000Z", openedByName: "Ravi", openingCash: [] });
    await engine.start();
    const d = draft([line(TOP_A, "1", { salesStaffId: ARUN })], { salesStaffId: PRIYA, payments: [{ methodId: CASH, amount: "599", reference: "" }] });
    const res = await engine.finish(d);
    expect(res.offline).toBe(true);
    expect(res.receipts[0]).toMatchObject({ salesStaff: "Priya" });
    expect(res.receipts[0].lines[0]).toMatchObject({ salesStaff: "A1" });
    const queued = (await engine.queue.items()).find((i) => i.kind === "bill")!;
    expect(queued.payload).toMatchObject({ offline: true, salesStaffId: PRIYA, sale: { lines: [expect.objectContaining({ salesStaffId: ARUN })] } });
  });
});

describe("birthday and anniversary at the till's quick add (plan 11 C10, scenario 11.19)", () => {
  const added = { id: null, name: "Meena R", mobile: "9840099881", gstin: null, stateCode: null, customerGroupId: null, newClientId: "00000000-0000-4000-8000-000000000077" };

  it("sends the dates with the new customer, online and offline, and nothing when none were given", () => {
    const methods = snapshot().till.paymentMethods;
    for (const offline of [false, true]) {
      const d = draft([line(SHIRT)], { customer: { ...added, birthday: "08-15", birthYear: 1990, anniversary: "11-20", anniversaryYear: null }, payments: [{ methodId: CASH, amount: "1299", reference: "" }] });
      const tx = buildTransaction(d, priceBill(d, { snapshot: snapshot(), date: DATE }), methods, options(offline));
      expect(tx.newCustomer).toEqual({ clientId: added.newClientId, name: "Meena R", mobile: "9840099881", birthday: "08-15", birthYear: 1990, anniversary: "11-20", anniversaryYear: null });
    }
    const plain = draft([line(SHIRT)], { customer: added, payments: [{ methodId: CASH, amount: "1299", reference: "" }] });
    expect(buildTransaction(plain, priceBill(plain, { snapshot: snapshot(), date: DATE }), methods, options(true)).newCustomer).toEqual({ clientId: added.newClientId, name: "Meena R", mobile: "9840099881" });
  });
});
