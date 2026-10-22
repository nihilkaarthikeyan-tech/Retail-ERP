// Copyright (c) 2026, Rademics. All rights reserved.
// Till screen tests for plan 11: the salesperson picker (C1), home-delivery
// details (B4) and the new offers shown on the bill (B3). Runs offline on the
// in-memory till store, so the bills wait in the queue for checking.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PosTransactionInput } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TillEngine } from "@/lib/till/engine";
import { fakeApi, sampleSnapshot, TILL_ID } from "@/lib/till/fixtures";
import { MemoryStore } from "@/lib/till/storage";
import type { LocalShift, SnapItem, StoredSnapshot } from "@/lib/till/types";
import { TillApp } from "./till-app";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/till",
  useSearchParams: () => new URLSearchParams(""),
}));

const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");
const PCS = "d0000000-0000-4000-8000-000000000001";
const LIST = "f0000000-0000-4000-8000-000000000002";
const TEES = "20000000-0000-4000-8000-0000000000a1";
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRIYA = id(21);
const ARUN = id(22);
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function item(itemId: string, code: string, name: string, hsn: string, over: Partial<SnapItem> = {}): SnapItem {
  return { ...sampleSnapshot().items[0], id: itemId, code, name, hsnCode: hsn, mrp: null, itemGroup: { id: TEES, path: `/${TEES}/` }, barcodes: [], ...over };
}
const price = (itemId: string, p: string) => ({ id: `price-${itemId}`, priceListId: LIST, itemId, unitId: PCS, price: p, startDate: "2026-04-01", endDate: null, customerId: null, batchId: null, packSize: null });

function snapshot(): StoredSnapshot {
  const s = sampleSnapshot();
  return {
    ...s,
    till: { ...s.till, delivery: { charge: "50.00", freeAbove: "2000.00", itemId: id(9) } },
    items: [...s.items, item(id(1), "TEE-RED", "Tee red", "6109"), item(id(2), "TEE-BLUE", "Tee blue", "6109"), item(id(3), "TEE-BLACK", "Tee black", "6109"), item(id(9), "DELIVERY", "Home delivery", "9965", { isStockItem: false, itemGroup: { id: "x", path: "/x/" } })],
    prices: [...s.prices, price(id(1), "399"), price(id(2), "399"), price(id(3), "399")],
    gstRates: [...s.gstRates, { hsnCode: "6109", rate: "5", effectiveFrom: "2026-04-01" }, { hsnCode: "9965", rate: "18", effectiveFrom: "2026-04-01" }],
    offers: [
      { id: id(31), code: "TEES-ANY3", name: "Any 3 tees for ₹999", kind: "mix_match", appliesTo: "groups", targetIds: [TEES], value: null, buyQuantity: null, freeQuantity: null, setQuantity: 3, setPrice: "999.00", cheapestFree: false, minQuantity: null, minAmount: null, storeIds: [], customerGroupId: null, startDate: "2026-10-01", endDate: null, priority: 0, couponOnly: false, active: true },
    ],
    salesStaff: [
      { id: ARUN, code: "A1", name: "Arun" },
      { id: PRIYA, code: "P1", name: "Priya" },
    ],
  };
}

async function offlineTill() {
  const store = new MemoryStore();
  await store.set("snapshot", snapshot());
  const shift: LocalShift = { clientId: uuid(), id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] };
  await store.set("shift", shift);
  await store.set("shiftid:" + shift.clientId, "s1");
  const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at, uuid });
  render(<TillApp device={device} engine={engine} />);
  await screen.findByRole("search");
  return engine;
}

function scan(code: string) {
  const box = screen.getByLabelText(/Scan a barcode/);
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest("form")!);
}

async function payExactCash() {
  fireEvent.keyDown(window, { key: "F4" });
  fireEvent.click(screen.getByRole("button", { name: "Exact cash" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
  });
  return screen.findByRole("dialog", { name: "Bill finished" });
}

async function queuedBill(engine: TillEngine): Promise<PosTransactionInput> {
  await waitFor(async () => expect((await engine.queue.items()).length).toBe(1));
  return (await engine.queue.items())[0].payload as PosTransactionInput;
}

beforeEach(() => {
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("salesperson at the till (plan 11 C1)", () => {
  it("F3 and a typed code set the bill's salesperson; one line can name another; both go with the bill", { timeout: 20_000 }, async () => {
    const engine = await offlineTill();
    fireEvent.keyDown(window, { key: "F3" });
    const dialog = await screen.findByRole("dialog", { name: "Salesperson for the bill" });
    const code = within(dialog).getByLabelText("Type or scan the code");
    fireEvent.change(code, { target: { value: "x9" } });
    fireEvent.submit(code.closest("form")!);
    expect(within(dialog).getByText(/No salesperson with code X9/)).toBeTruthy();
    fireEvent.change(code, { target: { value: "p1" } });
    fireEvent.submit(code.closest("form")!);
    expect(screen.getByTestId("bill-salesperson").textContent).toBe("Priya");

    scan("8900001");
    scan("8900002");
    fireEvent.click(screen.getByRole("button", { name: "Salesperson of Surf Excel 1 kg" }));
    const forLine = await screen.findByRole("dialog", { name: "Salesperson for Surf Excel 1 kg" });
    fireEvent.click(within(forLine).getByRole("button", { name: /Arun/ }));
    expect(screen.getByRole("button", { name: "Salesperson of Surf Excel 1 kg" }).textContent).toContain("by A1 (this line)");
    expect(screen.getByRole("button", { name: "Salesperson of Basmati Rice 1 kg" }).textContent).toContain("by P1");

    const done = await payExactCash();
    expect(within(done).getAllByText("Salesperson: Priya").length).toBeGreaterThan(0);
    const tx = await queuedBill(engine);
    expect(tx.salesStaffId).toBe(PRIYA);
    expect(tx.sale!.lines.map((l) => l.salesStaffId)).toEqual([undefined, ARUN]);
  });
});

describe("home delivery at the till (plan 11 B4)", () => {
  it("delivery details add the store's ₹50.00 charge below ₹2,000 and go with the bill", async () => {
    const engine = await offlineTill();
    scan("8900002");
    fireEvent.click(screen.getByRole("button", { name: "Home delivery" }));
    const dialog = await screen.findByRole("dialog", { name: "Home delivery" });
    expect(within(dialog).getByText(/Delivery charge ₹50.00, free for bills of ₹2,000.00 or more/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save delivery" }));
    expect(within(dialog).getByText("Enter the address to deliver to")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Address"), { target: { value: "12 Gandhi Street, Chennai" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "9840012345" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save delivery" }));

    expect(screen.getByTestId("delivery-note").textContent).toContain("12 Gandhi Street, Chennai");
    expect(screen.getByTestId("delivery-note").textContent).toContain("charge ₹50.00");
    expect(screen.getByTestId("bill-total").textContent).toContain("₹182.00");

    const done = await payExactCash();
    expect(within(done).getAllByText("12 Gandhi Street, Chennai").length).toBeGreaterThan(0);
    const tx = await queuedBill(engine);
    expect(tx.delivery).toMatchObject({ address: "12 Gandhi Street, Chennai", phone: "9840012345", deliverOn: "2026-10-15", charge: "50.00" });
    // The charge line is added by the server from the store's settings, not sent as a line.
    expect(tx.sale!.lines).toHaveLength(1);
  });
});

describe("new offers on the bill (plan 11 B3)", () => {
  it("any 3 tees for ₹999: the total and the saving are shown", async () => {
    await offlineTill();
    scan("TEE-RED");
    scan("TEE-BLUE");
    expect(screen.getByTestId("bill-total").textContent).toContain("₹798.00");
    scan("TEE-BLACK");
    expect(screen.getByTestId("bill-total").textContent).toContain("₹999.00");
    const totals = screen.getByRole("complementary", { name: /totals/ });
    expect(within(totals).getByText("Any 3 tees for ₹999")).toBeTruthy();
    expect(within(totals).getByText("saves ₹198.00")).toBeTruthy();
  });
});
