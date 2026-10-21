// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 at the till: buttons of switched-off optional modules are not shown
// (salesperson, home delivery, customer orders and customer credit, alterations,
// coupons, credit sales). The map comes with the till's saved copy, so this
// works offline; a copy without a map (saved before plan 12) keeps everything.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PosTransactionInput } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TillEngine } from "@/lib/till/engine";
import { fakeApi, snapshotWithOnAccount, TILL_ID } from "@/lib/till/fixtures";
import { MemoryStore } from "@/lib/till/storage";
import type { LocalShift, StoredSnapshot } from "@/lib/till/types";
import { TillApp } from "./till-app";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/till",
  useSearchParams: () => new URLSearchParams(""),
}));

const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");
const ARUN = "40000000-0000-4000-8000-000000000022";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const ALL_OFF = { salesperson: false, delivery: false, customer_orders: false, alterations: false, offers: false, credit_sales: false };

function snapshot(modules?: StoredSnapshot["modules"]): StoredSnapshot {
  const s = snapshotWithOnAccount();
  return { ...s, till: { ...s.till, delivery: { charge: "50.00", freeAbove: null, itemId: null } }, salesStaff: [{ id: ARUN, code: "A1", name: "Arun" }], ...(modules ? { modules } : {}) };
}

async function offlineTill(snap: StoredSnapshot) {
  const store = new MemoryStore();
  await store.set("snapshot", snap);
  const shift: LocalShift = { clientId: uuid(), id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] };
  await store.set("shift", shift);
  await store.set("shiftid:" + shift.clientId, "s1");
  const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at, uuid });
  render(<TillApp device={device} engine={engine} />);
  await screen.findByRole("search");
  return { engine, store };
}

function scan(code: string) {
  const box = screen.getByLabelText(/Scan a barcode/);
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest("form")!);
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });

beforeEach(() => {
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("optional modules at the till (plan 12)", () => {
  it("a saved copy without a module map keeps every button", async () => {
    await offlineTill(snapshot());
    scan("8900001");
    for (const name of ["Home delivery", "Customer orders", "Alterations", "Use customer credit", "Coupon / bill discount", /Salesperson \(F3\)/]) expect(button(name)).toBeTruthy();
    expect(screen.getByLabelText("Keyboard shortcuts").textContent).toContain("Salesperson");
    fireEvent.keyDown(window, { key: "F4" });
    const pay = await screen.findByRole("dialog", { name: "Payment" });
    expect(within(pay).getByRole("button", { name: /On account/ })).toBeTruthy();
  });

  it("switched-off modules: no salesperson, delivery, orders, alterations, customer credit, coupon or on account", async () => {
    await offlineTill(snapshot(ALL_OFF));
    scan("8900001");
    for (const name of ["Home delivery", "Customer orders", "Alterations", "Use customer credit", "Coupon / bill discount", /Salesperson/]) expect(button(name)).toBeNull();
    expect(screen.getByLabelText("Keyboard shortcuts").textContent).not.toContain("Salesperson");
    // F3 opens nothing.
    fireEvent.keyDown(window, { key: "F3" });
    expect(screen.queryByRole("dialog", { name: /Salesperson/ })).toBeNull();

    // The bill discount stays; the coupon field goes.
    fireEvent.click(screen.getByRole("button", { name: "Bill discount" }));
    const options = await screen.findByRole("dialog", { name: "Bill discount" });
    expect(within(options).queryByLabelText("Coupon code")).toBeNull();
    expect(within(options).getByLabelText("Bill discount")).toBeTruthy();
    fireEvent.click(within(options).getByRole("button", { name: /Close/ }));

    fireEvent.keyDown(window, { key: "F4" });
    const pay = await screen.findByRole("dialog", { name: "Payment" });
    expect(within(pay).queryByRole("button", { name: /On account/ })).toBeNull();
    expect(within(pay).getByRole("button", { name: "Cash" })).toBeTruthy();
  });

  it("only the switched-off ones go: with credit sales on and the rest off, on account is still offered", async () => {
    await offlineTill(snapshot({ ...ALL_OFF, credit_sales: true, alterations: true }));
    scan("8900001");
    expect(button("Alterations")).toBeTruthy();
    expect(button("Customer orders")).toBeNull();
    fireEvent.keyDown(window, { key: "F4" });
    const pay = await screen.findByRole("dialog", { name: "Payment" });
    expect(within(pay).getByRole("button", { name: /On account/ })).toBeTruthy();
  });

  it("a bill started before Salesperson was switched off is sent without its salesperson", { timeout: 20_000 }, async () => {
    const snap = snapshot(ALL_OFF);
    const { engine } = await offlineTill(snap);
    const draft = (await engine.loadDraft()).draft;
    await act(async () => {
      await engine.saveDraft({ ...draft, salesStaffId: ARUN });
    });
    cleanup();
    render(<TillApp device={device} engine={engine} />);
    await screen.findByRole("search");
    scan("8900001");
    await waitFor(async () => expect((await engine.loadDraft()).draft).toMatchObject({ salesStaffId: ARUN, lines: [expect.anything()] }));
    fireEvent.keyDown(window, { key: "F4" });
    fireEvent.click(await screen.findByRole("button", { name: "Exact cash" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
    });
    await screen.findByRole("dialog", { name: "Bill finished" });
    await waitFor(async () => expect((await engine.queue.items()).length).toBe(1));
    const tx = (await engine.queue.items())[0].payload as PosTransactionInput;
    expect(tx.salesStaffId).toBeUndefined();
  });
});
