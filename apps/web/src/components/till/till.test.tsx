// Copyright (c) 2026, Rademics. All rights reserved.
// Till screen tests (plan 06 §8 "Web"): the pay screen's change, the status
// and offline billing, the keyboard flow, and refusing to close the shift
// while bills wait to be sent. Runs on the in-memory till store.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { Decimal, type PosTransactionInput } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { TillEngine } from "@/lib/till/engine";
import { ASHA, fakeApi, sampleSnapshot, sampleUser, snapshotWithOnAccount, TILL_ID } from "@/lib/till/fixtures";
import { type DraftPayment, emptyDraft } from "@/lib/till/pricing";
import { MemoryStore } from "@/lib/till/storage";
import type { LocalShift, Receipt, TransactionResult } from "@/lib/till/types";
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
    // Owner decision of 22 Oct 2026: no "rates not approved" banner on the till.
    expect(screen.queryByText(/not approved/)).toBeNull();

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
    expect(within(done).getAllByText(/MAT1\/2627\/000042/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sync status: Offline, 1 waiting/ })).toBeTruthy());
    await waitFor(() => expect(window.print).toHaveBeenCalled());

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

describe("on account at the till (plan 07 §1a)", () => {
  function Harness({ online = true, namedCustomer = false }: { online?: boolean; namedCustomer?: boolean }) {
    const [payments, setPayments] = useState<DraftPayment[]>([]);
    const draft = { ...emptyDraft("d", at), payments };
    return <PayDialog open net={new Decimal("120")} draft={draft} methods={snapshotWithOnAccount().till.paymentMethods} busy={false} error={null} online={online} namedCustomer={namedCustomer} onChange={setPayments} onFinish={() => {}} onClose={() => {}} />;
  }

  it("a walk-in customer cannot choose On account; the cashier is pointed to F6 Customer", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "On account" }));
    expect(screen.getByText(/only for a named customer.*F6 Customer/)).toBeTruthy();
    expect(screen.queryByLabelText("On account amount")).toBeNull();
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("for a named customer it takes what is still to pay and gives no change", () => {
    render(<Harness namedCustomer />);
    fireEvent.click(screen.getByRole("button", { name: "On account" }));
    expect((screen.getByLabelText("On account amount") as HTMLInputElement).value).toBe("120.00");
    expect(screen.getByTestId("pay-change").textContent).toContain("₹0.00");
    expect((screen.getByRole("button", { name: /Finish and print/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("is switched off while the till is offline: needs the connection", () => {
    render(<Harness online={false} namedCustomer />);
    const button = screen.getByRole("button", { name: /On account \(needs the connection\)/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("over the credit limit: manager PIN, then the same bill is sent again and finished", async () => {
    const store = new MemoryStore();
    await store.set("snapshot", snapshotWithOnAccount());
    const basmati = sampleSnapshot().items[0];
    await store.set("draft", {
      ...emptyDraft("d1", at),
      customer: { id: ASHA, name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null },
      lines: [{ key: "k1", itemId: basmati.id, unitId: basmati.baseUnitId, quantity: "1", barcode: null, priceOverride: null, discountPercent: "0" }],
    });
    const receipt: Receipt = {
      billId: "b1",
      number: "MAT1/2627/000042",
      kind: "sale",
      duplicate: false,
      provisional: false,
      soldAt: at.toISOString(),
      till: "T1",
      footer: null,
      lines: [{ name: basmati.name, code: basmati.code, hsn: "1006", quantity: "1", price: "120.00", discount: "0.00", amount: "120.00", free: false, serials: [] }],
      gstTable: [],
      totals: { gross: "120.00", discount: "0.00", taxable: "114.29", rounding: "0.00", total: "120.00" },
      payments: [{ method: "On account", amount: "120.00", reference: null }],
      change: "0.00",
    };
    const bodies: { clientId: string; creditApprovalToken?: string }[] = [];
    const approve = vi.fn(async () => ({ token: "approval-1", manager: { id: "m1", name: "Meena" } }));
    const api = fakeApi({
      me: async () => sampleUser,
      snapshot: async () => snapshotWithOnAccount(),
      currentShift: async () => ({ id: "s1", clientId: "sc", businessDate: "2026-10-15", openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] }),
      people: async () => ({ managers: [{ id: "m1", name: "Meena" }], cashiers: [] }),
      approve,
      postBill: async (b) => {
        bodies.push(b);
        if (!b.creditApprovalToken) throw new ApiError(403, "Over the credit limit: owes ₹4900.00, limit ₹5000.00, this bill ₹120.00. A manager must approve");
        return { repeated: false, sale: null, return: null, net: "120.00", change: "0.00", receipts: [receipt] } satisfies TransactionResult;
      },
    });
    const engine = new TillEngine({ store, api, device, now: () => at, uuid });
    render(<TillApp device={device} engine={engine} />);
    await screen.findByRole("search");
    await waitFor(() => expect(engine.getState().online).toBe(true));

    fireEvent.keyDown(window, { key: "F4" });
    fireEvent.click(await screen.findByRole("button", { name: "On account" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
    });

    const box = await screen.findByRole("dialog", { name: "Manager approval" });
    expect(within(box).getByText(/^Over the credit limit/)).toBeTruthy();
    fireEvent.change(await within(box).findByLabelText("PIN"), { target: { value: "4321" } });
    await act(async () => {
      fireEvent.click(within(box).getByRole("button", { name: "Approve" }));
    });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ managerId: "m1", pin: "4321", action: "credit_over_limit" }));

    const done = await screen.findByRole("dialog", { name: "Bill finished" });
    expect(within(done).getAllByText("On account").length).toBeGreaterThan(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ clientId: bodies[0].clientId, creditApprovalToken: "approval-1" });
    expect(await engine.queue.items()).toEqual([]);
  });
});

function receiptFor(kind: "sale" | "return", total: string, method: string): Receipt {
  return {
    billId: "b9",
    number: "MAT1/2627/000042",
    kind,
    duplicate: false,
    provisional: false,
    soldAt: at.toISOString(),
    till: "T1",
    footer: null,
    lines: [],
    gstTable: [],
    totals: { gross: total, discount: "0.00", taxable: "0.00", rounding: "0.00", total },
    payments: [{ method, amount: total, reference: null }],
    change: "0.00",
  };
}

async function onlineTill(postBill: (b: PosTransactionInput) => Promise<TransactionResult>, draft?: unknown) {
  const store = new MemoryStore();
  await store.set("snapshot", sampleSnapshot());
  if (draft) await store.set("draft", draft);
  const approve = vi.fn(async (b: { action: string }) => ({ token: `approval-${b.action}`, manager: { id: "m1", name: "Meena" } }));
  const api = fakeApi({
    me: async () => sampleUser,
    snapshot: async () => sampleSnapshot(),
    currentShift: async () => ({ id: "s1", clientId: "sc", businessDate: "2026-10-15", openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] }),
    people: async () => ({ managers: [{ id: "m1", name: "Meena" }], cashiers: [] }),
    approve,
    postBill,
  });
  const engine = new TillEngine({ store, api, device, now: () => at, uuid });
  render(<TillApp device={device} engine={engine} />);
  await screen.findByRole("search");
  await waitFor(() => expect(engine.getState().online).toBe(true));
  return { engine, approve };
}

async function managerPin() {
  const box = await screen.findByRole("dialog", { name: "Manager approval" });
  fireEvent.change(await within(box).findByLabelText("PIN"), { target: { value: "4321" } });
  await act(async () => {
    fireEvent.click(within(box).getByRole("button", { name: "Approve" }));
  });
  return box;
}

describe("return without the original bill (plan 11 A9, scenario 11.8)", () => {
  it("scan what comes back, manager PIN, then refund by a refund method; sent with no original bill", async () => {
    const bodies: PosTransactionInput[] = [];
    const { engine, approve } = await onlineTill(async (b) => {
      bodies.push(b);
      return { repeated: false, sale: null, return: null, net: "-120.00", change: "0.00", receipts: [receiptFor("return", "-120.00", "Cash")] } satisfies TransactionResult;
    });

    fireEvent.keyDown(window, { key: "F7" });
    fireEvent.click(await screen.findByRole("button", { name: "Return without a bill" }));
    const dialog = await screen.findByRole("dialog", { name: "Return without a bill" });
    const box = within(dialog).getByLabelText("Scan or search the item coming back");
    fireEvent.change(box, { target: { value: "8900001" } });
    fireEvent.submit(box.closest("form")!);
    expect(within(dialog).getByText("₹120.00")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Lost the receipt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Return these/ }));

    const pin = await managerPin();
    expect(within(pin).getByText(/Return without a bill: ₹120.00 back/)).toBeTruthy();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ action: "return_without_bill" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Manager approval" })).toBeNull());
    expect(screen.getByText(/Return without a bill, approved by Meena/)).toBeTruthy();
    expect(screen.getByTestId("bill-total").textContent).toContain("₹120.00");

    fireEvent.keyDown(window, { key: "F4" });
    const pay = await screen.findByRole("dialog", { name: "Refund" });
    // UPI does not allow refunds, so it is not offered.
    expect(within(pay).queryByRole("button", { name: "UPI" })).toBeNull();
    fireEvent.click(within(pay).getByRole("button", { name: "Cash" }));
    await act(async () => {
      fireEvent.click(within(pay).getByRole("button", { name: /Finish and print/ }));
    });

    await screen.findByRole("dialog", { name: "Bill finished" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].ret).toMatchObject({ approvalToken: "approval-return_without_bill", reason: "Lost the receipt", lines: [{ lineNo: 1, quantity: "1" }] });
    expect(bodies[0].ret).not.toHaveProperty("returnOfId");
    expect(bodies[0].payments).toEqual([{ paymentMethodId: sampleSnapshot().till.paymentMethods[0].id, amount: "-120.00", reference: null }]);
    expect(await engine.queue.items()).toEqual([]);
  });

  it("is clearly unavailable while the till is offline", async () => {
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
    await store.set("shift", { clientId: "sc", id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] } satisfies LocalShift);
    await store.set("meta:user", sampleUser);
    const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at, uuid });
    render(<TillApp device={device} engine={engine} />);
    await screen.findByRole("search");
    fireEvent.keyDown(window, { key: "F7" });
    const button = (await screen.findByRole("button", { name: "Return without a bill" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Returns without a bill need the connection/)).toBeTruthy();
  });
});

describe("selling below cost (plan 11 A2, scenario 11.2)", () => {
  it("the server's refusal asks for a manager's PIN, then the same bill is sent again with that line's approval", async () => {
    const basmati = sampleSnapshot().items[0];
    const bodies: PosTransactionInput[] = [];
    const draft = { ...emptyDraft("d1", at), lines: [{ key: "k1", itemId: basmati.id, unitId: basmati.baseUnitId, quantity: "1", barcode: null, priceOverride: null, discountPercent: "5" }] };
    const { approve } = await onlineTill(async (b) => {
      bodies.push(b);
      if (!b.sale!.lines[0].approvalToken) throw new ApiError(400, "ITM-000001: this price is below cost; a manager must approve it");
      return { repeated: false, sale: null, return: null, net: "114.00", change: "0.00", receipts: [receiptFor("sale", "114.00", "Cash")] } satisfies TransactionResult;
    }, draft);

    fireEvent.keyDown(window, { key: "F4" });
    fireEvent.click(await screen.findByRole("button", { name: "Exact cash" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
    });

    const box = await screen.findByRole("dialog", { name: "Manager approval" });
    expect(within(box).getByText("ITM-000001: this price is below cost; a manager must approve it")).toBeTruthy();
    await managerPin();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ action: "price_change" }));

    await screen.findByRole("dialog", { name: "Bill finished" });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ clientId: bodies[0].clientId, sale: { number: bodies[0].sale!.number } });
    expect(bodies[1].sale!.lines[0]).toMatchObject({ approvalToken: "approval-price_change", discountPercent: "5" });
  });

  it("not approved: the cashier is told a manager must approve the price, and the bill stays open", async () => {
    const basmati = sampleSnapshot().items[0];
    const draft = { ...emptyDraft("d1", at), lines: [{ key: "k1", itemId: basmati.id, unitId: basmati.baseUnitId, quantity: "1", barcode: null, priceOverride: null, discountPercent: "0" }] };
    await onlineTill(async () => {
      throw new ApiError(400, "ITM-000001: this price is below cost; a manager must approve it");
    }, draft);
    fireEvent.keyDown(window, { key: "F4" });
    fireEvent.click(await screen.findByRole("button", { name: "Exact cash" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish and print/ }));
    });
    const box = await screen.findByRole("dialog", { name: "Manager approval" });
    fireEvent(box, new Event("cancel"));
    const pay = await screen.findByRole("dialog", { name: "Payment" });
    expect(within(pay).getByText(/below cost; a manager must approve it\. Not approved: change the price on the bill, or ask a manager/)).toBeTruthy();
  });
});
