// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 part 2 on the till: collecting a customer order at the agreed prices
// with its advance (scenario 11.20), using kept credit (11.21), an alteration
// charge line (11.22), and the warning for stock set aside for an order.
import { describe, expect, it } from "vitest";
import { ORDER_OFFLINE, TillEngine } from "./engine";
import { ASHA, CASH, fakeApi, PREFIX, sampleSnapshot, TILL_ID, UPI } from "./fixtures";
import { buildTransaction, checkPayments, type DraftBill, type DraftLine, emptyDraft, priceBill, setAsideWarnings } from "./pricing";
import { MemoryStore } from "./storage";
import type { SnapItem, StoredSnapshot } from "./types";

const DATE = "2026-10-15";
const PCS = "d0000000-0000-4000-8000-000000000001";
const LIST = "f0000000-0000-4000-8000-000000000002";
const KURTA = "40000000-0000-4000-8000-000000000101";
const DUPATTA = "40000000-0000-4000-8000-000000000102";
const ALTERATION = "40000000-0000-4000-8000-000000000103";
const ORDER = "50000000-0000-4000-8000-000000000001";
const ORDER_LINE = "50000000-0000-4000-8000-000000000002";
const JOB = "50000000-0000-4000-8000-000000000003";

function item(id: string, name: string, hsn: string, over: Partial<SnapItem> = {}): SnapItem {
  return { ...sampleSnapshot().items[0], id, code: `ITM-${id.slice(-4)}`, name, hsnCode: hsn, mrp: null, barcodes: [], ...over };
}
const price = (itemId: string, p: string) => ({ id: `price-${itemId}`, priceListId: LIST, itemId, unitId: PCS, price: p, startDate: "2026-04-01", endDate: null, customerId: null, batchId: null, packSize: null });

function snapshot(over: Partial<StoredSnapshot> = {}): StoredSnapshot {
  const s = sampleSnapshot();
  return {
    ...s,
    till: { ...s.till, alterationItemId: ALTERATION },
    items: [item(KURTA, "Silk kurta, XL", "6205"), item(DUPATTA, "Cotton dupatta", "6205"), item(ALTERATION, "Alteration charge", "9988", { isStockItem: false })],
    // The list price is ₹2,699; the order agreed ₹2,499.
    prices: [price(KURTA, "2699"), price(DUPATTA, "1200")],
    gstRates: [
      { hsnCode: "6205", rate: "5", effectiveFrom: "2026-04-01" },
      { hsnCode: "9988", rate: "18", effectiveFrom: "2026-04-01" },
    ],
    // A 10% bill offer must not touch a bill that collects an order.
    offers: [{ id: "60000000-0000-4000-8000-000000000001", code: "BILL10", name: "10% off the bill", kind: "percent", appliesTo: "bill", targetIds: [], value: "10", buyQuantity: null, freeQuantity: null, minQuantity: null, minAmount: null, storeIds: [], customerGroupId: null, startDate: "2026-04-01", endDate: null, priority: 0, couponOnly: false, active: true }],
    stock: [{ itemId: KURTA, quantity: "1" }],
    reserved: [{ itemId: KURTA, quantity: "1" }],
    ...over,
  };
}

const asha = { id: ASHA, name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null };
let k = 0;
const line = (itemId: string, over: Partial<DraftLine> = {}): DraftLine => ({ key: `k${++k}`, itemId, unitId: PCS, quantity: "1", barcode: null, priceOverride: null, discountPercent: "0", ...over });
const draft = (lines: DraftLine[], over: Partial<DraftBill> = {}): DraftBill => ({ ...emptyDraft("d1", new Date("2026-10-15T05:00:00.000Z")), lines, ...over });
const options = { clientId: "00000000-0000-4000-8000-000000000099", tillId: TILL_ID, shiftClientId: "00000000-0000-4000-8000-000000000098", soldAt: "2026-10-15T05:00:00.000Z", offline: false, numbers: { sale: `${PREFIX}000042` } };
const order = { id: ORDER, number: "CO-2026-27-00001", advance: "1000.00", lines: [{ itemId: KURTA, quantity: "1" }] };

describe("collecting a customer order (scenario 11.20)", () => {
  it("₹2,499.00 at the agreed price with no offer; the ₹1,000.00 advance leaves ₹1,499.00 to pay", () => {
    const d = draft([line(KURTA, { orderLineId: ORDER_LINE, agreedPrice: "2499" })], { customer: asha, order });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.problems).toEqual([]);
    expect(bill.approvals).toEqual([]);
    expect([bill.net.toFixed(2), bill.billDiscount.toFixed(2), bill.credit.toFixed(2), bill.due.toFixed(2)]).toEqual(["2499.00", "0.00", "1000.00", "1499.00"]);
    const methods = snapshot().till.paymentMethods;
    expect(checkPayments(bill.due, [{ methodId: UPI, amount: "1499", reference: "UPI-1" }], methods).short.toFixed(2)).toBe("0.00");
    const tx = buildTransaction({ ...d, payments: [{ methodId: UPI, amount: "1499", reference: "UPI-1" }] }, bill, methods, options);
    expect(tx).toMatchObject({ orderId: ORDER, customerId: ASHA, expectedTotal: "2499.00", payments: [{ paymentMethodId: UPI, amount: "1499.00", reference: "UPI-1" }] });
    expect(tx.sale!.lines).toEqual([{ lineNo: 1, itemId: KURTA, unitId: PCS, quantity: "1", orderLineId: ORDER_LINE }]);
  });

  it("the order's own unit set aside raises no warning; selling it to someone else does", () => {
    const own = draft([line(KURTA, { orderLineId: ORDER_LINE, agreedPrice: "2499" })], { customer: asha, order });
    expect(setAsideWarnings(own, priceBill(own, { snapshot: snapshot(), date: DATE }), snapshot())).toEqual([]);
    const other = draft([line(KURTA)]);
    expect(setAsideWarnings(other, priceBill(other, { snapshot: snapshot(), date: DATE }), snapshot())).toEqual([expect.stringMatching(/1 set aside for customer orders/)]);
  });

  it("an advance larger than the bill pays only the bill; the rest stays credit", () => {
    const d = draft([line(KURTA, { orderLineId: ORDER_LINE, agreedPrice: "2499" })], { customer: asha, order: { ...order, advance: "3000.00" } });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect([bill.credit.toFixed(2), bill.due.toFixed(2)]).toEqual(["2499.00", "0.00"]);
    const tx = buildTransaction(d, bill, snapshot().till.paymentMethods, options);
    expect(tx.payments).toEqual([{ paymentMethodId: CASH, amount: "0.00", reference: null }]);
  });

  it("is never kept offline", async () => {
    const store = new MemoryStore();
    await store.set("snapshot", snapshot());
    await store.set("shift", { clientId: options.shiftClientId, id: null, businessDate: DATE, openedAt: "2026-10-15T03:00:00.000Z", openedByName: "Ravi", openingCash: [] });
    const engine = new TillEngine({ store, api: fakeApi(), device: { tillId: TILL_ID, tillCode: "T1", deviceName: "PC", token: "t" }, now: () => new Date("2026-10-15T05:00:00.000Z") });
    await engine.start();
    const d = draft([line(KURTA, { orderLineId: ORDER_LINE, agreedPrice: "2499" })], { customer: asha, order, payments: [{ methodId: CASH, amount: "1499", reference: "" }] });
    await expect(engine.finish(d)).rejects.toThrow(ORDER_OFFLINE);
    expect(await engine.queue.items()).toHaveLength(0);
  });
});

describe("credit kept from a cancelled order (scenario 11.21)", () => {
  it("₹1,000.00 of credit on a ₹1,200.00 bill leaves ₹200.00; more credit than the bill is refused", () => {
    const d = draft([line(DUPATTA)], { customer: asha, credit: "1000.00" });
    const bill = priceBill(d, { snapshot: snapshot({ offers: [] }), date: DATE });
    expect([bill.net.toFixed(2), bill.due.toFixed(2)]).toEqual(["1200.00", "200.00"]);
    const tx = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "200", reference: "" }] }, bill, snapshot().till.paymentMethods, options);
    expect(tx).toMatchObject({ useCredit: "1000.00", payments: [{ paymentMethodId: CASH, amount: "200.00" }] });
    expect(priceBill({ ...d, credit: "1500" }, { snapshot: snapshot({ offers: [] }), date: DATE }).problems).toContain("More credit is used than the bill");
  });
});

describe("alteration charge (scenario 11.22)", () => {
  const alteration = { jobId: JOB, number: "ALT-2026-27-00001", charge: "150.00", deliver: false };

  it("added to the purchase bill as a ₹150.00 service line the server adds", () => {
    const d = draft([line(DUPATTA)], { alteration });
    const bill = priceBill(d, { snapshot: snapshot({ offers: [] }), date: DATE });
    expect(bill.net.toFixed(2)).toBe("1350.00");
    const charge = bill.sale!.lines.find((l) => l.isAlteration)!;
    expect([charge.lineNo, charge.amount.toFixed(2), charge.gstRate.toString()]).toEqual([2, "150.00", "18"]);
    const tx = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "1350", reference: "" }] }, bill, snapshot().till.paymentMethods, options);
    expect(tx.sale!.lines.map((l) => l.itemId)).toEqual([DUPATTA]);
    expect(tx.alteration).toEqual({ jobId: JOB });
  });

  it("or billed alone when the garment is collected, and handed back with it", () => {
    const d = draft([], { alteration: { ...alteration, deliver: true } });
    const bill = priceBill(d, { snapshot: snapshot(), date: DATE });
    expect(bill.net.toFixed(2)).toBe("150.00");
    const tx = buildTransaction({ ...d, payments: [{ methodId: CASH, amount: "150", reference: "" }] }, bill, snapshot().till.paymentMethods, options);
    expect(tx).toMatchObject({ sale: { lines: [] }, alteration: { jobId: JOB, deliver: true }, expectedTotal: "150.00" });
  });

  it("needs the charge item in the till settings", () => {
    const bill = priceBill(draft([], { alteration }), { snapshot: snapshot({ till: { ...snapshot().till, alterationItemId: null } }), date: DATE });
    expect(bill.problems[0]).toMatch(/alteration charge item is not set up/);
  });
});
