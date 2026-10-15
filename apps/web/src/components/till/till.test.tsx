// Copyright (c) 2026, Rademics. All rights reserved.
// Till screen tests (plan 06 §8 "Web"): the pay screen's change, the status
// and offline billing, the keyboard flow, and refusing to close the shift
// while bills wait to be sent. Runs on the in-memory till store.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { Decimal } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TillEngine } from "@/lib/till/engine";
import { fakeApi, sampleSnapshot, TILL_ID } from "@/lib/till/fixtures";
import { type DraftPayment, emptyDraft } from "@/lib/till/pricing";
import { MemoryStore } from "@/lib/till/storage";
import type { LocalShift } from "@/lib/till/types";
import { PayDialog } from "./pay-dialog";
import { NotATill, TillApp } from "./till-app";
import { statusText } from "./till-status";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/till",
  useSearchParams: () => new URLSearchParams(""),
}));

const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

beforeEach(() => {
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("pay screen", () => {
  function Harness() {
    const [payments, setPayments] = useState<DraftPayment[]>([]);
    const draft = { ...emptyDraft("d", at), payments };
    return <PayDialog open net={new Decimal("372")} draft={draft} methods={sampleSnapshot().till.paymentMethods} busy={false} error={null} onChange={setPayments} onFinish={() => {}} onClose={() => {}} />;
  }

  it("shows the change in big figures when more cash is given", () => {
    render(<Harness />);
    expect(screen.getByTestId("pay-due").textContent).toContain("₹372.00");
    fireEvent.click(screen.getByRole("button", { name: "₹500" }));
    expect(screen.getByTestId("pay-change").textContent).toContain("₹128.00");
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks for the card's approval code before finishing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Card" }));
    expect(screen.getByRole("alert").textContent).toContain("Card needs the approval code or reference");
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Card reference"), { target: { value: "482913" } });
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("status", () => {
  const base = { online: true, signedOut: false, waiting: 0, problems: 0, fetchedAt: null, stale: false };
  it("is green online, amber offline with the count waiting, red when bills could not be sent", () => {
    expect(statusText(base)).toEqual({ tone: "ok", text: "Online" });
    expect(statusText({ ...base, online: false, waiting: 12 })).toEqual({ tone: "warn", text: "Offline, 12 waiting" });
    expect(statusText({ ...base, problems: 3 })).toEqual({ tone: "danger", text: "3 bills could not be sent" });
  });

  it("tells a computer that is not a till how to set it up", () => {
    render(<NotATill />);
    expect(screen.getByText(/This computer is not set up as a till\. A manager can set it up on Billing counter → Tills\./)).toBeTruthy();
  });
});

describe("the till offline", () => {
  async function offlineTill() {
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
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

  it("bills from the saved copy: scan, pay with the keyboard, change shown, bill waits to be sent", async () => {
    const engine = await offlineTill();
    expect(screen.getByRole("button", { name: /Sync status: Offline, 0 waiting/ })).toBeTruthy();
    expect(screen.getByText("GST rates not approved yet — test bills")).toBeTruthy();

    scan("8900001");
    scan("8900001");
    scan("8900002");
    expect(screen.getByTestId("bill-total").textContent).toContain("₹372.00");

    fireEvent.keyDown(window, { key: "F4" });
    fireEvent.click(screen.getByRole("button", { name: "₹500" }));
    expect(screen.getByTestId("pay-change").textContent).toContain("₹128.00");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
    });

    const done = await screen.findByRole("dialog", { name: "Bill finished" });
    expect(within(done).getByTestId("done-change").textContent).toContain("₹128.00");
    expect(within(done).getByText(/Saved on the till/)).toBeTruthy();
    expect(within(done).getAllByText(/MAIN-T1-2026-27-000042/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sync status: Offline, 1 waiting/ })).toBeTruthy());
    expect(window.print).toHaveBeenCalled();

    const [item] = await engine.queue.items();
    expect(item).toMatchObject({ kind: "bill", status: "waiting" });
    expect((item.payload as { offline: boolean }).offline).toBe(true);
  });

  it("refuses to close the shift while a bill waits to be sent, saying how many", async () => {
    const engine = await offlineTill();
    await engine.cashMovement("out", "200", "Tea and snacks");
    fireEvent.click(screen.getByRole("button", { name: "Close shift" }));
    expect(await screen.findByText(/1 entry is still waiting to be sent/)).toBeTruthy();
  });

  it("brings back the bill being made after the page is reopened", async () => {
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
    await store.set("shift", { clientId: "sc", id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] } satisfies LocalShift);
    await store.set("draft", { ...emptyDraft("d1", at), lines: [{ key: "k1", itemId: sampleSnapshot().items[1].id, unitId: sampleSnapshot().items[1].baseUnitId, quantity: "1", barcode: null, priceOverride: null, discountPercent: "0" }] });
    const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at, uuid });
    render(<TillApp device={device} engine={engine} />);
    expect(await screen.findByText("Bill restored.")).toBeTruthy();
    expect(screen.getByTestId("bill-total").textContent).toContain("₹132.00");
  });
});
