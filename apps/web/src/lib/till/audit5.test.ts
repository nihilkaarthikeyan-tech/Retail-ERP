// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 5 of the billing counter (29 October 2026, owner decisions C1–C9): the
// send queue never jams (sign-in, an unregistered till, a bill the server keeps
// failing), an answer that never came is checked with the server, a shift does
// not close over bills that could not be sent, long offline spells, offline
// past midnight, coupons and returns offline, stale bill-discount approvals,
// drawer openings, and pricing speed on a large catalogue.
import { Decimal, type PosTransactionInput } from "shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { ALREADY_SAVED, NO_DISK, offlineStopMessage, ON_ACCOUNT_DROPPED, SEND_UNCERTAIN, TILL_NOT_REGISTERED_MESSAGE, TillEngine } from "./engine";
import { ASHA, BASMATI, CASH, fakeApi, PARLE, PCS, PREFIX, sampleOffers, sampleSnapshot, sampleUser, snapshotWithOnAccount, SURF, TEN_OFF, TILL_ID, ACCOUNT } from "./fixtures";
import { billDiscountStamp, buildTransaction, type DraftBill, type DraftLine, emptyDraft, priceBill, scan, searchItems } from "./pricing";
import { MAX_STRIKES, SendQueue } from "./queue";
import { MemoryStore, VolatileStore } from "./storage";
import type { TillApi } from "./till-api";
import type { BillDto, ServerShift, SnapItem, SnapPrice, StoredSnapshot, TransactionResult } from "./types";

const DATE = "2026-10-15";
const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z"); // 10:30 in India
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const cash = (amount: string) => [{ methodId: CASH, amount, reference: "" }];
const serverShift: ServerShift = { id: "s1", clientId: "sc", businessDate: DATE, openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] };
const ok: TransactionResult = { repeated: false, sale: null, return: null, net: "120.00", change: "0.00", receipts: [] };

function line(itemId: string, quantity: string, over: Partial<DraftLine> = {}): DraftLine {
  return { key: `${itemId}-${quantity}-${Math.random()}`, itemId, unitId: PCS, quantity, barcode: null, priceOverride: null, discountPercent: "0", ...over };
}

function onlineApi(over: Partial<TillApi> = {}, snapshot: () => StoredSnapshot = () => sampleSnapshot()): TillApi {
  return fakeApi({ me: async () => sampleUser, snapshot: async () => snapshot(), currentShift: async () => serverShift, openShift: async (b) => ({ ...serverShift, clientId: b.clientId }), settings: async () => ({ cashDifferenceApprovalAmount: "100.00", printReceiptCopies: 1, liveAllowed: true }), ...over });
}

function engine(api: TillApi = fakeApi(), store: MemoryStore = new MemoryStore(), now: () => Date = () => at, session: Storage | null = null) {
  return new TillEngine({ store, api, device, now, uuid, session });
}

/** An offline till with the sample copy and an open shift. */
async function offlineTill(store = new MemoryStore(), now: () => Date = () => at, snapshot = sampleSnapshot()) {
  const e = engine(fakeApi(), store, now);
  await store.set("snapshot", snapshot);
  await e.start();
  await e.openShift("0", "Ravi");
  return e;
}

/** A finished offline bill waiting in the queue of `store`. */
async function queuedBill(store: MemoryStore): Promise<string> {
  const e = await offlineTill(store);
  const { draft } = await e.loadDraft();
  const res = await e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") });
  return res.clientId!;
}

function sessionStore(values: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(values));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe("the queue never jams (audit 5, item 1)", () => {
  it("a 401 waits for the next sign-in, then the queue goes on", async () => {
    const store = new MemoryStore();
    await queuedBill(store);
    let signedIn = false;
    const e = engine(
      onlineApi({
        postBill: async () => {
          if (!signedIn) throw new ApiError(401, "Your session has ended");
          return ok;
        },
      }),
      store,
    );
    await e.start();
    expect(e.getState()).toMatchObject({ signedOut: true, waiting: 1 });
    signedIn = true;
    await e.tick();
    expect(e.getState()).toMatchObject({ signedOut: false, waiting: 0 });
  });

  it("a cashier's expired switch is dropped and the bill is sent as the signed-in user", async () => {
    const store = new MemoryStore();
    const off = await offlineTill(store);
    const session = sessionStore({ "retail-erp:till-cashier:tokens": JSON.stringify({ c1: "old-switch" }), "retail-erp:till-cashier": JSON.stringify({ id: "c1", name: "Meena", token: "old-switch" }) });
    const { draft } = await off.loadDraft();
    const queued = engine(fakeApi(), store, () => at, session);
    await queued.start();
    await queued.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") });
    expect((await queued.queue.items()).find((i) => i.kind === "bill")?.cashierId).toBe("c1");

    const bodies: PosTransactionInput[] = [];
    const e = engine(
      onlineApi({
        postBill: async (b) => {
          bodies.push({ ...b });
          if (b.cashierToken) throw new ApiError(401, "The cashier switch has expired");
          return ok;
        },
      }),
      store,
      () => at,
      session,
    );
    await e.start();
    expect(e.getState()).toMatchObject({ signedOut: false, waiting: 0 });
    expect(bodies.map((b) => b.cashierToken)).toEqual(["old-switch", undefined]);
    expect(session.getItem("retail-erp:till-cashier:tokens")).toBe("{}");
    expect(e.getState().cashier).toBeNull();
  });

  it("a till no longer registered stops sending, keeps every bill and refuses new ones", async () => {
    const store = new MemoryStore();
    await queuedBill(store);
    const notRegistered = () => Promise.reject(new ApiError(403, "This computer is not registered as a till", [], "TILL_NOT_REGISTERED"));
    const e = engine(onlineApi({ postBill: notRegistered, openShift: notRegistered }), store);
    await e.start();
    expect(e.getState()).toMatchObject({ tillNotRegistered: true, waiting: 2, problems: 0 });
    const { draft } = await e.loadDraft();
    await expect(e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") })).rejects.toThrow(TILL_NOT_REGISTERED_MESSAGE);
  });
});

describe("a bill the server keeps failing (audit 5, item 2)", () => {
  it("goes on the problem list after 10 tries while the server answers, and the next one is sent", async () => {
    let clock = at;
    const sent: string[] = [];
    const q = new SendQueue(
      new MemoryStore(),
      async (item) => {
        if (item.clientId === "bad") throw new ApiError(500, "Internal server error");
        sent.push(item.clientId);
        return {};
      },
      () => clock,
      () => {},
      async () => true,
    );
    await q.enqueue({ clientId: "bad", kind: "bill", label: "bad", payload: {} });
    await q.enqueue({ clientId: "good", kind: "bill", label: "good", payload: {} });
    for (let i = 1; i < MAX_STRIKES; i++) {
      expect(await q.process({ force: true })).toMatchObject({ sent: 0, serverTrouble: true, offline: false });
    }
    clock = new Date(clock.getTime() + 60_000);
    expect(await q.process({ force: true })).toMatchObject({ sent: 1, problems: 1 });
    expect(sent).toEqual(["good"]);
    expect((await q.items())[0]).toMatchObject({ clientId: "bad", status: "problem" });
  });

  it("gives up after an hour of failures too, but never while the till is simply offline", async () => {
    let clock = at;
    let reachable = false;
    const q = new SendQueue(
      new MemoryStore(),
      async () => {
        throw new ApiError(0, "The server did not answer in time");
      },
      () => clock,
      () => {},
      async () => reachable,
    );
    await q.enqueue({ clientId: "x", kind: "bill", label: "x", payload: {} });
    for (let i = 0; i < 15; i++) {
      clock = new Date(clock.getTime() + 10 * 60_000);
      expect(await q.process({ force: true })).toMatchObject({ offline: true, problems: 0 });
    }
    // Now the server answers, but this one bill never gets an answer.
    reachable = true;
    await q.process({ force: true });
    clock = new Date(clock.getTime() + 61 * 60_000);
    expect(await q.process({ force: true })).toMatchObject({ problems: 1 });
  });

  it("a server fault while the internet works does not show the till offline", async () => {
    const store = new MemoryStore();
    await queuedBill(store);
    const e = engine(onlineApi({ postBill: () => Promise.reject(new ApiError(503, "Service unavailable")), openShift: async (b) => ({ ...serverShift, clientId: b.clientId }) }), store);
    await e.start();
    expect(e.getState()).toMatchObject({ online: true, serverTrouble: true, waiting: 1 });
  });
});

describe("an answer that never came (audit 5, item 3)", () => {
  const asha = { id: ASHA, name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null };
  const saved = (net = "120.00"): TransactionResult => ({ ...ok, net, receipts: [{ billId: "b9", number: `${PREFIX}000042`, kind: "sale", duplicate: false, provisional: false, soldAt: at.toISOString(), till: "T1", footer: null, lines: [], gstTable: [], totals: { gross: net, discount: "0.00", taxable: net, rounding: "0.00", total: net }, payments: [], change: "0.00" }] });

  it("a plain bill that was saved after all is shown finished with the server's receipt, not queued", async () => {
    const e = engine(onlineApi({ postBill: () => Promise.reject(new ApiError(0, "The server did not answer in time")), billByClient: async () => ({ saved: true, transaction: saved() }) }));
    await e.start();
    const { draft } = await e.loadDraft();
    const res = await e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") });
    expect(res).toMatchObject({ offline: false, notice: ALREADY_SAVED });
    expect(res.receipts[0].billId).toBe("b9");
    expect(await e.queue.items()).toEqual([]);
  });

  it("a bill that needs the server stays marked until the server says whether it was saved", async () => {
    let answer: "none" | "saved" = "none";
    const e = engine(
      onlineApi(
        {
          postBill: () => Promise.reject(new ApiError(0, "Cannot reach the server")),
          billByClient: async () => {
            if (answer === "none") throw new ApiError(0, "Cannot reach the server");
            return { saved: true, transaction: saved() };
          },
        },
        () => snapshotWithOnAccount(),
      ),
    );
    await e.start();
    const { draft } = await e.loadDraft();
    await expect(e.finish({ ...draft, customer: asha, lines: [line(BASMATI, "1")], payments: [{ methodId: ACCOUNT, amount: "120", reference: "" }] })).rejects.toThrow(ON_ACCOUNT_DROPPED);
    const kept = (await e.loadDraft()).draft;
    expect(kept.sendUncertain).toBe(true);
    // The cashier switches to cash: refused until the server can be asked.
    await expect(e.finish({ ...kept, payments: cash("120") })).rejects.toThrow(SEND_UNCERTAIN);
    expect(await e.resolveUncertain()).toBeNull();
    // It was saved (on account): that bill is shown, the changed one is not sent.
    answer = "saved";
    const done = await e.resolveUncertain();
    expect(done).toMatchObject({ offline: false, notice: ALREADY_SAVED });
    expect((await e.loadDraft()).restored).toBe(false);
  });

  it("not saved: the mark comes off and the cashier may change the bill", async () => {
    const e = engine(onlineApi({ billByClient: async () => ({ saved: false }) }));
    await e.start();
    await e.saveDraft({ ...emptyDraft("d1", at), lines: [line(BASMATI, "1")], clientId: "c-1", sendUncertain: true });
    expect(await e.resolveUncertain()).toBe("not_saved");
    expect((await e.loadDraft()).draft.sendUncertain).toBeUndefined();
  });

  it("409 BILL_ALREADY_SAVED shows the saved bill, live or from the queue", async () => {
    const already = () => Promise.reject(new ApiError(409, "This bill was already saved", [], "BILL_ALREADY_SAVED", { code: "BILL_ALREADY_SAVED", transaction: saved() }));
    const live = engine(onlineApi({ postBill: already }));
    await live.start();
    const { draft } = await live.loadDraft();
    expect(await live.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") })).toMatchObject({ offline: false, notice: ALREADY_SAVED });

    const store = new MemoryStore();
    await queuedBill(store);
    const e = engine(onlineApi({ postBill: already, openShift: async (b) => ({ ...serverShift, clientId: b.clientId }) }), store);
    await e.start();
    expect(e.getState()).toMatchObject({ waiting: 0, problems: 0 });
  });
});

describe("closing over bills that could not be sent (audit 5, C3)", () => {
  it("refuses while a bill is on the problem list, after taking off those the office already posted", async () => {
    const store = new MemoryStore();
    const off = await offlineTill(store);
    for (const amount of ["120", "240"]) {
      const { draft } = await off.loadDraft();
      await off.finish({ ...draft, lines: [line(BASMATI, amount === "120" ? "1" : "2")], payments: cash(amount) });
    }
    const bills = (await off.queue.items()).filter((i) => i.kind === "bill");
    const posted = bills[0].clientId;
    const e = engine(
      onlineApi({
        openShift: async (b) => ({ ...serverShift, clientId: b.clientId }),
        postBill: () => Promise.reject(new ApiError(400, "Bill number is not in this till's series")),
        billByClient: async (id) => (id === posted ? { saved: true, transaction: ok } : { saved: false }),
      }),
      store,
    );
    await e.start();
    expect(e.getState().problems).toBe(2);
    await expect(e.closingInfo()).rejects.toThrow("1 bill could not be sent: the office must post it first (Offline bills to check → Post into shift)");
    expect((await e.queue.items()).map((i) => i.clientId)).toEqual([bills[1].clientId]);
  });
});

describe("long offline spells (audit 5, C1)", () => {
  it("warns after 24 hours and refuses new bills after 48 hours", async () => {
    let clock = at;
    const e = await offlineTill(new MemoryStore(), () => clock);
    clock = new Date(at.getTime() + 25 * 3_600_000);
    expect(e.offlineLevel().level).toBe("warn");
    clock = new Date(at.getTime() + 49 * 3_600_000);
    expect(e.offlineLevel().level).toBe("stop");
    const { draft } = await e.loadDraft();
    await expect(e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") })).rejects.toThrow(offlineStopMessage(48));
  });

  it("counts from the last answer of the server, kept across restarts", async () => {
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
    const online = engine(onlineApi(), store);
    await online.start();
    expect(await store.get("meta:last-contact")).toBe(at.toISOString());
    const later = engine(fakeApi(), store, () => new Date(at.getTime() + 30 * 3_600_000));
    await later.start();
    expect(later.offlineLevel()).toMatchObject({ level: "warn", warnHours: 24, stopHours: 48 });
  });
});

describe("offline past midnight (audit 5, C2)", () => {
  it("bills go on yesterday's open shift while offline; online the shift is closed first", async () => {
    let clock = at;
    const store = new MemoryStore();
    const e = await offlineTill(store, () => clock);
    clock = new Date("2026-10-15T18:35:00.000Z"); // 00:05 on 16 October in India
    expect(e.shiftNeedsClosing()).toBe(false);
    const { draft } = await e.loadDraft();
    const res = await e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") });
    expect(res.offline).toBe(true);
    const tx = (await e.queue.items()).find((i) => i.kind === "bill")!.payload as PosTransactionInput;
    expect(tx.soldAt).toBe("2026-10-15T18:35:00.000Z");

    const live = engine(onlineApi({ currentShift: async () => serverShift, postBill: async () => ok }), new MemoryStore(), () => clock);
    await live.store.set("snapshot", sampleSnapshot());
    await live.start();
    expect(live.shiftNeedsClosing()).toBe(true);
    const next = await live.loadDraft();
    await expect(live.finish({ ...next.draft, lines: [line(BASMATI, "1")], payments: cash("120") })).rejects.toThrow(/shift is from 15 Oct 2026; close it/);
  });
});

describe("coupons and returns offline (audit 5, items 7 and 8)", () => {
  const coupon = { code: "SAVE10", offerId: TEN_OFF, startDate: "2026-10-01", endDate: null, maxUses: 1, usedCount: 0, customerId: null };
  const couponSnapshot = () => sampleSnapshot({ offers: [{ ...sampleOffers[1], couponOnly: true }], coupons: [coupon] });

  it("a single-use coupon is not given twice by this till offline", async () => {
    const e = await offlineTill(new MemoryStore(), () => at, couponSnapshot());
    const first = await e.loadDraft();
    const res = await e.finish({ ...first.draft, couponCode: "SAVE10", lines: [line(PARLE, "1")], payments: cash("9") });
    expect(res.receipts[0].totals.total).toBe("9.00");
    expect(e.getState().couponUses).toEqual({ SAVE10: 1 });
    const second = await e.loadDraft();
    await expect(e.finish({ ...second.draft, couponCode: "SAVE10", lines: [line(PARLE, "1")], payments: cash("9") })).rejects.toThrow("Coupon SAVE10 has been used up");
    expect(e.price({ ...second.draft, couponCode: "SAVE10", lines: [line(PARLE, "1")] })!.problems).toContain("Coupon SAVE10 has been used up");
  });

  const sale: BillDto = {
    id: "b1",
    number: `${PREFIX}000040`,
    kind: "sale",
    status: "completed",
    till: { id: TILL_ID, code: "T1", name: "Till 1" },
    clientId: "sale-1",
    customerId: "w",
    soldAt: at.toISOString(),
    businessDate: DATE,
    total: "240.00",
    offline: false,
    lines: [{ id: "l1", lineNo: 1, item: { id: BASMATI, code: "ITM-000001", name: "Basmati", hsnCode: "1006" }, unitId: PCS, quantity: "2", basicQuantity: "2", returnedQuantity: "0", mrp: null, listPrice: "120.00", price: "120.00", discountAmount: "0.00", isFree: false, gstRate: "5", lineTotal: "240.00" }],
    payments: [{ paymentMethod: { id: CASH, code: "CASH", name: "Cash", kind: "cash" }, amount: "240.00", reference: null }],
  };
  const ret = (): DraftBill["ret"] => ({
    originalBillId: "b1",
    originalNumber: sale.number,
    customerId: "w",
    reason: null,
    lines: [{ key: "r1", originalLineId: "l1", itemId: BASMATI, unitId: PCS, code: "ITM-000001", name: "Basmati", quantity: "1", maxQuantity: "2", originalQuantity: "2", originalPrice: "120.00", originalDiscount: "0.00", originalLineTotal: "240.00", gstRate: "5", isFree: false }],
  });

  it("an offline return is counted on the till's copy of the bill", async () => {
    const store = new MemoryStore();
    await store.set(`recent:${sale.number}`, { number: sale.number, savedAt: at.toISOString(), bill: sale, receipts: [] });
    const e = await offlineTill(store);
    const { draft } = await e.loadDraft();
    await e.finish({ ...draft, buyer: { gstin: "", name: "Lakshmi", address: "", stateCode: "" }, ret: ret(), payments: cash("120") });
    const found = await e.findBillForReturn(sale.number);
    expect(found.lines[0].returnedQuantity).toBe("1");
  });

  it("online, returns still waiting in the queue are taken off what the server says is left", async () => {
    const store = new MemoryStore();
    const off = await offlineTill(store);
    const { draft } = await off.loadDraft();
    await off.finish({ ...draft, buyer: { gstin: "", name: "Lakshmi", address: "", stateCode: "" }, ret: ret(), payments: cash("120") });
    // The server is failing on bills, so the return still waits in the queue.
    const e = engine(onlineApi({ findBills: async () => ({ rows: [sale] }), postBill: () => Promise.reject(new ApiError(503, "Service unavailable")) }), store);
    await e.start();
    expect((await e.findBillForReturn(sale.number)).lines[0].returnedQuantity).toBe("1");
  });
});

describe("manager approvals and the drawer (audit 5, items 11, 12, 14)", () => {
  it("a bill-discount approval is only for the bill the manager saw", () => {
    const s = sampleSnapshot();
    const base: DraftBill = { ...emptyDraft("d", at), lines: [line(BASMATI, "2")], billDiscount: { amount: "50" }, payments: cash("190") };
    expect(priceBill(base, { snapshot: s, date: DATE }).approvals[0]).toMatchObject({ kind: "bill_discount" });
    const approved: DraftBill = { ...base, billDiscount: { amount: "50", approvalToken: "t1", approvedBy: "Manager", approvedFor: billDiscountStamp(base) } };
    const bill = priceBill(approved, { snapshot: s, date: DATE });
    expect(bill.approvals).toEqual([]);
    const opts = { clientId: "c", tillId: TILL_ID, shiftClientId: "s", soldAt: at.toISOString(), offline: false, numbers: { sale: `${PREFIX}000042` } };
    expect(buildTransaction(approved, bill, s.till.paymentMethods, opts).billDiscount).toEqual({ amount: "50.00", approvalToken: "t1" });
    // A line changed: the approval no longer counts and is not sent.
    const changed: DraftBill = { ...approved, lines: [{ ...approved.lines[0], quantity: "3" }] };
    const again = priceBill(changed, { snapshot: s, date: DATE });
    expect(again.approvals[0]).toMatchObject({ kind: "bill_discount" });
    expect(buildTransaction(changed, again, s.till.paymentMethods, opts).billDiscount).toEqual({ amount: "50.00" });
    // So does another discount.
    expect(priceBill({ ...approved, billDiscount: { ...approved.billDiscount!, amount: "60" } }, { snapshot: s, date: DATE }).approvals[0]).toMatchObject({ kind: "bill_discount" });
  });

  it("records drawer openings through the queue, gives the receipt copies and the suggested float", async () => {
    const drawer = vi.fn(async () => ({}));
    const snapshot = () => {
      const s = sampleSnapshot();
      return { ...s, till: { ...s.till, receiptCopies: 2, lastCloseCash: [{ paymentMethodId: CASH, amount: "1850.00" }], cashOutApprovalAbove: "2000.00" } };
    };
    const e = engine(onlineApi({ drawerOpening: drawer }, snapshot));
    await e.start();
    expect(e.receiptCopies()).toBe(2);
    expect(e.suggestedFloat()).toBe("1850.00");
    expect(e.cashOutApprovalAbove()).toBe("2000.00");
    await e.recordDrawerOpening("no_sale", { approvalToken: "a1" });
    await e.sync(true);
    expect(drawer).toHaveBeenCalledWith(expect.objectContaining({ tillId: TILL_ID, kind: "no_sale", approvalToken: "a1", at: at.toISOString() }));
    expect(e.getState().waiting).toBe(0);
  });

  it("a cash out above the limit needs the manager's approval token", async () => {
    const store = new MemoryStore();
    const s = sampleSnapshot();
    const e = await offlineTill(store, () => at, { ...s, till: { ...s.till, cashOutApprovalAbove: "2000.00" } });
    await expect(e.cashMovement("out", "2500", "Supplier")).rejects.toThrow(/needs a manager's PIN/);
    await e.cashMovement("out", "2500", "Supplier", "ok-1");
    await e.cashMovement("out", "500", "Tea");
    const moves = (await e.queue.items()).filter((i) => i.kind === "cash_movement").map((i) => i.payload as { approvalToken?: string });
    expect(moves.map((m) => m.approvalToken)).toEqual(["ok-1", undefined]);
  });

  it("refuses to keep an offline bill when the browser has no lasting storage", async () => {
    const e = await offlineTill(new VolatileStore());
    const { draft } = await e.loadDraft();
    await expect(e.finish({ ...draft, lines: [line(BASMATI, "1")], payments: cash("120") })).rejects.toThrow(NO_DISK);
  });
});

describe("speed on a large catalogue (audit 5, item 13)", () => {
  function bigSnapshot(): StoredSnapshot {
    const s = sampleSnapshot();
    const items: SnapItem[] = [];
    const prices: SnapPrice[] = [];
    for (let i = 0; i < 30_000; i++) {
      const id = `11000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      items.push({ ...s.items[0], id, code: `ITM-${String(i).padStart(6, "0")}`, name: `Item number ${i}`, mrp: "200.00", barcodes: [{ code: `8901${String(i).padStart(8, "0")}`, unitId: PCS }] });
      prices.push({ ...s.prices[0], id: `p-${i}`, itemId: id, price: String(100 + (i % 50)) });
      if (i % 3 === 0) prices.push({ ...s.prices[0], id: `q-${i}`, itemId: id, price: String(90 + (i % 50)), startDate: "2026-11-01" });
    }
    return { ...s, items: [...s.items, ...items], prices: [...s.prices, ...prices] };
  }

  it("prices a 40-line bill on 30,000 items and 40,000 prices quickly, with the same results", () => {
    const s = bigSnapshot();
    expect(s.prices.length).toBeGreaterThanOrEqual(40_000);
    const lines = Array.from({ length: 40 }, (_, i) => line(`11000000-0000-4000-8000-${String(29_000 + i * 17).padStart(12, "0")}`, "1"));
    const started = performance.now();
    const bill = priceBill({ ...emptyDraft("d", at), lines }, { snapshot: s, date: DATE });
    for (let i = 0; i < 20; i++) priceBill({ ...emptyDraft("d", at), lines }, { snapshot: s, date: DATE });
    const took = performance.now() - started;
    expect(bill.problems).toEqual([]);
    expect(bill.sale!.lines).toHaveLength(40);
    // Item 29,000 costs 100 + (29000 % 50) = ₹100 (the 1 November price is not yet in force).
    expect(bill.sale!.lines[0].price.toFixed(2)).toBe("100.00");
    expect(took).toBeLessThan(3_000);
    // Look-ups give what a plain search of the lists gives.
    expect(scan(s, "890100029999")?.item.code).toBe("ITM-029999");
    expect(scan(s, "itm-000002")?.item.id).toBe(s.items.find((i) => i.code === "ITM-000002")!.id);
    expect(scan(s, "890" + "0001")?.item.id).toBe(BASMATI);
    expect(searchItems(s, "basmati")).toEqual([s.items[0]]);
    expect(searchItems(s, "number 2999", 5).map((i) => i.code)).toEqual(["ITM-002999", "ITM-012999", "ITM-022999", "ITM-029990", "ITM-029991"]);
    // Digits only: codes are searched, not names ("Item number 12345" is not matched by its name).
    expect(searchItems(s, "012345").map((i) => i.code)).toEqual(["ITM-012345"]);
    expect(new Decimal(bill.net).gt(0)).toBe(true);
  });

  it("a snapshot replaced on refresh gets its own look-ups", () => {
    const a = sampleSnapshot();
    expect(scan(a, "8900002")?.item.id).toBe(SURF);
    const b = { ...a, items: a.items.map((i) => (i.id === SURF ? { ...i, barcodes: [{ code: "777", unitId: PCS }] } : i)) };
    expect(scan(b, "8900002")).toBeNull();
    expect(scan(b, "777")?.item.id).toBe(SURF);
  });
});
