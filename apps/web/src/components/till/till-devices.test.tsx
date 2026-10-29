// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 5 (29 October 2026): the till with its Till Helper. Receipt copies
// (C6), which receipts printed and why the rest went to the browser (C9), the
// cash drawer and "No sale" (C4), the "Bill finished" panel and a scan, the
// pay box and a scanner, and pairing from the back office.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { Decimal } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelperPairingBox } from "@/components/pos/till-device-box";
import { TILL_HELPER_TOKEN_KEY } from "@/components/pos/pos-shared";
import { TillEngine } from "@/lib/till/engine";
import { fakeApi, sampleSnapshot, sampleUser, TILL_ID } from "@/lib/till/fixtures";
import { type DraftPayment, emptyDraft } from "@/lib/till/pricing";
import { HELPER_TOKEN_KEY, pairHelper, type PrintableReceipt, printWithHelper } from "@/lib/till/receipt";
import { MemoryStore } from "@/lib/till/storage";
import type { LocalShift, SnapTill } from "@/lib/till/types";
import { autoCopies, DRAWER_FAILED } from "./billing-screen";
import { cleanAmount, PayDialog, SCANNED_INTO_AMOUNT } from "./pay-dialog";
import { TillApp } from "./till-app";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/till",
  useSearchParams: () => new URLSearchParams(""),
}));

const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

type Reply = { status: number; body: unknown } | "down";
/** A fake Till Helper on 127.0.0.1: the answer for each path, in turn. */
function fakeHelper(answers: Record<string, Reply[]>) {
  const calls: { path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const list = answers[path] ?? [];
    const reply = list.length > 1 ? list.shift()! : (list[0] ?? { status: 200, body: { ok: true } });
    if (reply === "down") throw new TypeError("Failed to fetch");
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const recorded = vi.fn<(kind: "sale" | "no_sale", opts?: { billClientId?: string; approvalToken?: string }) => Promise<void>>(async () => undefined);

async function offlineTill(till: Partial<SnapTill> = {}) {
  const store = new MemoryStore();
  const snap = sampleSnapshot();
  await store.set("snapshot", { ...snap, till: { ...snap.till, ...till } });
  const shift: LocalShift = { clientId: uuid(), id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] };
  await store.set("shift", shift);
  await store.set("shiftid:" + shift.clientId, "s1");
  const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at, uuid });
  // Owner decision C4: the engine queues each drawer opening (its own tests cover the queue).
  Object.assign(engine, { recordDrawerOpening: recorded });
  recorded.mockClear();
  render(<TillApp device={device} engine={engine} />);
  await screen.findByRole("search");
  return engine;
}

function scan(code: string) {
  const box = screen.getByLabelText(/Scan a barcode/);
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest("form")!);
}

/** Scans one item and pays ₹500 cash; returns the "Bill finished" panel. */
async function cashSale() {
  scan("8900001");
  fireEvent.keyDown(window, { key: "F4" });
  fireEvent.click(screen.getByRole("button", { name: "₹500" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
  });
  return screen.findByRole("dialog", { name: "Bill finished" });
}

describe("receipt copies (owner decision C6)", () => {
  it("0 copies, or auto print off, prints nothing by itself; 1-3 copies otherwise", () => {
    expect(autoCopies({ autoPrint: true, receiptCopies: 0 })).toBe(0);
    expect(autoCopies({ autoPrint: false, receiptCopies: 2 })).toBe(0);
    expect(autoCopies({ autoPrint: true })).toBe(1);
    expect(autoCopies({ autoPrint: true, receiptCopies: 3 })).toBe(3);
    expect(autoCopies({ autoPrint: true, receiptCopies: 9 })).toBe(3);
  });

  it("prints two copies through the helper, opens the drawer for cash and records it with the bill", async () => {
    localStorage.setItem(HELPER_TOKEN_KEY, "helper-token");
    const calls = fakeHelper({});
    await offlineTill({ receiptCopies: 2 });
    await cashSale();
    await waitFor(() => expect(calls.filter((c) => c.path === "/print")).toHaveLength(2));
    expect(calls.some((c) => c.path === "/drawer/open")).toBe(true);
    await waitFor(() => expect(recorded).toHaveBeenCalledWith("sale", { billClientId: expect.any(String) }));
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Print a duplicate" })).toBeTruthy();
  });

  it("prints nothing by itself with 0 copies; the first Print is the original, the next a duplicate", async () => {
    await offlineTill({ receiptCopies: 0 });
    const done = await cashSale();
    await new Promise((r) => setTimeout(r, 30));
    expect(window.print).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(done).getByRole("button", { name: "Print" }));
    });
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(within(done).getByRole("button", { name: "Print a duplicate" })).toBeTruthy();
    const area = () => within(document.querySelector<HTMLElement>(".till-print-area")!);
    expect(area().queryAllByText("DUPLICATE")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(within(done).getByRole("button", { name: "Print a duplicate" }));
    });
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
    expect(area().getAllByText("DUPLICATE").length).toBeGreaterThan(0);
  });
});

describe("the receipt printer and the cash drawer tell the cashier (owner decisions C4, C9)", () => {
  it("out of paper: says so and prints in the browser instead", async () => {
    localStorage.setItem(HELPER_TOKEN_KEY, "helper-token");
    fakeHelper({ "/print": [{ status: 503, body: { ok: false, error: "The receipt printer is out of paper. Put in a new roll.", code: "no_paper" } }] });
    await offlineTill();
    const done = await cashSale();
    expect(await within(done).findByText("Receipt printer: out of paper — printed in the browser instead.")).toBeTruthy();
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });

  it("the drawer did not open: says so and records nothing", async () => {
    localStorage.setItem(HELPER_TOKEN_KEY, "helper-token");
    fakeHelper({ "/drawer/open": [{ status: 409, body: { ok: false, error: "No cash drawer is set up in the Till Helper", code: "drawer_not_configured" } }] });
    await offlineTill();
    const done = await cashSale();
    expect(await within(done).findByText(DRAWER_FAILED)).toBeTruthy();
    expect(recorded).not.toHaveBeenCalled();
  });

  it("no Till Helper paired: the browser prints and nothing is said about the printer", async () => {
    await offlineTill();
    const done = await cashSale();
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    expect(within(done).queryByTestId("device-notes")).toBeNull();
  });

  it("No sale / open drawer asks a manager's PIN, opens the drawer and records it with the approval", async () => {
    localStorage.setItem(HELPER_TOKEN_KEY, "helper-token");
    const calls = fakeHelper({});
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
    const approve = vi.fn(async (b: { action: string }) => ({ token: `approval-${b.action}`, manager: { id: "m1", name: "Meena" } }));
    const api = fakeApi({
      me: async () => sampleUser,
      snapshot: async () => sampleSnapshot(),
      currentShift: async () => ({ id: "s1", clientId: "sc", businessDate: "2026-10-15", openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] }),
      people: async () => ({ managers: [{ id: "m1", name: "Meena" }], cashiers: [] }),
      approve,
    });
    const engine = new TillEngine({ store, api, device, now: () => at, uuid });
    Object.assign(engine, { recordDrawerOpening: recorded });
    recorded.mockClear();
    render(<TillApp device={device} engine={engine} />);
    await screen.findByRole("search");
    await waitFor(() => expect(engine.getState().online).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "No sale / open drawer" }));
    const box = await screen.findByRole("dialog", { name: "Manager approval" });
    fireEvent.change(await within(box).findByLabelText("PIN"), { target: { value: "4321" } });
    await act(async () => {
      fireEvent.click(within(box).getByRole("button", { name: "Approve" }));
    });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ action: "open_drawer" }));
    await waitFor(() => expect(recorded).toHaveBeenCalledWith("no_sale", { approvalToken: "approval-open_drawer" }));
    expect(calls.some((c) => c.path === "/drawer/open")).toBe(true);
    expect(await screen.findByText(/Cash drawer opened \(no sale\)/)).toBeTruthy();
  });
});

describe("the Bill finished panel and a scan", () => {
  it("a scan closes the panel and its code goes onto the next bill", async () => {
    await offlineTill({ autoPrint: false });
    await cashSale();
    // A scanner's keys come a few milliseconds apart (the clock is held so a busy test machine does not matter).
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => (clock += 5));
    try {
      for (const key of "8900002") fireEvent.keyDown(window, { key });
      fireEvent.keyDown(window, { key: "Enter" });
    } finally {
      now.mockRestore();
    }
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bill finished" })).toBeNull());
    await waitFor(() => expect(screen.getByTestId("bill-total").textContent).not.toContain("₹0.00"));
    expect((screen.getByLabelText(/Scan a barcode/) as HTMLInputElement).value).toBe("");
  });

  it("a key or two typed by hand does not close it", async () => {
    await offlineTill({ autoPrint: false });
    await cashSale();
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("dialog", { name: "Bill finished" })).toBeTruthy();
  });
});

describe("a scan the till's copy does not know, online", () => {
  it("tries the code that was scanned again after the refresh, not what is in the box by then", async () => {
    const store = new MemoryStore();
    const old = sampleSnapshot();
    await store.set("snapshot", old);
    const shift: LocalShift = { clientId: uuid(), id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] };
    await store.set("shift", shift);
    await store.set("shiftid:" + shift.clientId, "s1");
    const withBarcode = { ...old.items[0], barcodes: [...old.items[0].barcodes, { code: "8909999000017", unitId: null }] };
    let downloads = 0;
    let release: () => void = () => {};
    const snapshot = vi.fn(async () => {
      if (downloads++ === 0) return { ...sampleSnapshot(), full: false, items: [] };
      await new Promise<void>((r) => (release = r));
      return { ...sampleSnapshot(), full: false, items: [withBarcode] };
    });
    const api = fakeApi({ me: async () => sampleUser, snapshot, currentShift: async () => ({ id: "s1", clientId: shift.clientId, businessDate: "2026-10-15", openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] }) });
    const engine = new TillEngine({ store, api, device, now: () => at, uuid });
    render(<TillApp device={device} engine={engine} />);
    await screen.findByRole("search");
    await waitFor(() => expect(engine.getState().online).toBe(true));
    scan("8909999000017");
    // The cashier starts typing the next code while the till fetches.
    const box = screen.getByLabelText(/Scan a barcode/) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "89" } });
    await waitFor(() => expect(snapshot.mock.calls.length).toBe(2));
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(screen.getAllByText(old.items[0].name).length).toBeGreaterThan(0));
    expect(box.value).toBe("89");
    expect(screen.queryByText(/Nothing found/)).toBeNull();
  });
});

describe("the pay box and a scanner", () => {
  function Harness({ net = "372" }: { net?: string }) {
    const [payments, setPayments] = useState<DraftPayment[]>([]);
    const draft = { ...emptyDraft("d", at), payments };
    return <PayDialog open net={new Decimal(net)} draft={draft} methods={sampleSnapshot().till.paymentMethods} busy={false} error={null} onChange={setPayments} onFinish={finish} onClose={() => {}} />;
  }
  const finish = vi.fn();

  it("takes at most 9 digits before the point and 2 after", () => {
    expect(cleanAmount("8901234567890")).toBe("890123456");
    expect(cleanAmount("12.345")).toBe("12.34");
    expect(cleanAmount("1.2.3")).toBe("1.23");
    expect(cleanAmount("₹ 500")).toBe("500");
  });

  it("change of ₹10,000 or more is a problem, not a finished bill", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    fireEvent.change(screen.getByLabelText("Cash amount"), { target: { value: "10372" } });
    expect(screen.getByRole("alert").textContent).toContain("Check the amount: change of ₹10,000.00");
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Cash amount"), { target: { value: "10371" } });
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ignores the Enter at the end of a barcode scanned into the amount and takes the code out", () => {
    finish.mockClear();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    const box = screen.getByLabelText("Cash amount") as HTMLInputElement;
    const before = box.value;
    let typed = before;
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => (clock += 5));
    let enter: boolean;
    try {
      for (const key of "89000017") {
        fireEvent.keyDown(box, { key });
        typed += key;
        fireEvent.change(box, { target: { value: typed } });
      }
      enter = fireEvent.keyDown(box, { key: "Enter" });
    } finally {
      now.mockRestore();
    }
    expect(enter).toBe(false);
    expect(box.value).toBe(before);
    expect(screen.getByText(SCANNED_INTO_AMOUNT)).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("printing through the Till Helper", () => {
  const receipt = (number: string) => ({ number }) as PrintableReceipt;

  it("says which printed and why the others did not, and does not try the rest", async () => {
    localStorage.setItem(HELPER_TOKEN_KEY, "helper-token");
    const calls = fakeHelper({ "/print": [{ status: 200, body: { ok: true } }, { status: 503, body: { ok: false, error: "The receipt printer cover is open. Close it.", code: "cover_open" } }] });
    const [a, b, c] = [receipt("A"), receipt("B"), receipt("C")];
    expect(await printWithHelper([a, b, c])).toEqual({ printed: [a], failed: [b, c], reason: "cover open", code: "cover_open" });
    expect(calls).toHaveLength(2);
  });

  it("not paired: everything goes to the browser, with nothing to tell the cashier", async () => {
    const calls = fakeHelper({});
    const a = receipt("A");
    expect(await printWithHelper([a])).toEqual({ printed: [], failed: [a], reason: null, code: null });
    expect(calls).toHaveLength(0);
  });

  it("the helper not running is said plainly", async () => {
    localStorage.setItem(HELPER_TOKEN_KEY, "helper-token");
    fakeHelper({ "/print": ["down"] });
    expect((await printWithHelper([receipt("A")])).reason).toBe("the Till Helper is not answering");
  });

  it("pairing shows the helper's own refusal", async () => {
    fakeHelper({ "/pair": [{ status: 403, body: { ok: false, error: "Wrong pairing code", code: "pair_wrong" } }] });
    await expect(pairHelper("000000")).rejects.toThrow("Wrong pairing code");
  });

  it("pairs from the back office with the 6-digit code", async () => {
    const calls = fakeHelper({ "/pair": [{ status: 200, body: { ok: true, token: "helper-token" } }] });
    render(<HelperPairingBox />);
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "654321" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    });
    expect(calls).toEqual([{ path: "/pair", body: { code: "654321" } }]);
    expect(localStorage.getItem(TILL_HELPER_TOKEN_KEY)).toBe("helper-token");
    expect(await screen.findByText("This computer is paired with its Till Helper.")).toBeTruthy();
  });
});
