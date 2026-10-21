// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 at the till: paying with points and gift cards on the Pay screen
// (online only, the scheme's limits), the customer's points after picking
// them, selling a gift card, and hiding all of it when the modules are off.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { type CurrentUser, Decimal, type ModuleKey } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TillEngine } from "@/lib/till/engine";
import { ASHA, CASH, fakeApi, sampleUser, snapshotWithLoyalty, TILL_ID } from "@/lib/till/fixtures";
import { type DraftBill, type DraftGiftCard, emptyDraft } from "@/lib/till/pricing";
import { MemoryStore } from "@/lib/till/storage";
import type { GiftCardSaleResult, LocalShift, StoredSnapshot, TillCustomerPoints, TillGiftCard } from "@/lib/till/types";
import { PayDialog } from "./pay-dialog";
import { POINTS_NEED_CUSTOMER } from "./points-cards";
import { TillApp } from "./till-app";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/till",
  useSearchParams: () => new URLSearchParams(""),
}));

const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");
const CARD_NO = "6123456789012344";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const points: TillCustomerPoints = { customerId: ASHA, member: true, reason: null, balance: 150, balanceValue: "150.00", available: 150, tier: { name: "Gold", earnSpend: "100.00", earnPoints: 2 }, yearSpend: "26000.00", expiringSoon: [], minRedeem: 100, maxSharePercent: "50", pointValue: "1" };
const card: TillGiftCard = { id: "c1", number: CARD_NO, holderName: "Anita", holderPhone: null, customerId: null, issuedStoreId: "s", issuedOn: "2026-10-15", loadedTotal: "1000.00", balance: "1000.00", expiresOn: "2027-10-15", status: "active", blockedReason: null, problem: null };

beforeEach(() => {
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Pay screen: points and gift cards", () => {
  function Harness({ online = true, named = true, onPoints = vi.fn(), onCards = vi.fn(), check = vi.fn(async () => card) }: { online?: boolean; named?: boolean; onPoints?: (p: DraftBill["points"]) => void; onCards?: (c: DraftGiftCard[]) => void; check?: (n: string) => Promise<TillGiftCard> }) {
    const [d, setD] = useState<DraftBill>({ ...emptyDraft("d", at), payments: [] });
    const snap = snapshotWithLoyalty();
    return (
      <PayDialog
        open
        net={new Decimal("500")}
        draft={d}
        methods={snap.till.paymentMethods}
        busy={false}
        error={null}
        online={online}
        namedCustomer={named}
        onChange={(payments) => setD({ ...d, payments })}
        onFinish={() => {}}
        onClose={() => {}}
        special={{
          loyalty: snap.till.loyalty ?? null,
          giftCardsOn: true,
          customerPoints: named ? points : null,
          billTotal: new Decimal("500"),
          onPoints: (p) => {
            onPoints(p);
            setD({ ...d, points: p });
          },
          onGiftCards: (c) => {
            onCards(c);
            setD({ ...d, giftCards: c });
          },
          checkCard: check,
        }}
      />
    );
  }

  it("100 of Asha's 150 points pay ₹100; fewer than 100 or more than half the bill are refused with the reason", async () => {
    const onPoints = vi.fn();
    render(<Harness onPoints={onPoints} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay with points" }));
    expect(screen.getByText(/150 points can be spent today/).textContent).toContain("Up to 150 points on this bill; at least 100.");
    const box = screen.getByLabelText("Points to spend");
    fireEvent.change(box, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Use points" }));
    expect(screen.getByRole("alert").textContent).toBe("At least 100 points must be spent at a time");
    fireEvent.change(box, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Use points" }));
    expect(onPoints).toHaveBeenCalledWith({ points: 100, value: "100.00" });
    expect(screen.getByRole("table", { name: "Paid with points and gift cards" }).textContent).toContain("Loyalty points (100)₹100.00");
  });

  it("offline, and for a walk-in bill, points cannot be used", () => {
    render(<Harness online={false} />);
    const pts = screen.getByRole("button", { name: /Pay with points \(needs the connection\)/ }) as HTMLButtonElement;
    expect(pts.disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Gift card \(needs the connection\)/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<Harness named={false} />);
    const b = screen.getByRole("button", { name: "Pay with points" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe(POINTS_NEED_CUSTOMER);
  });

  it("a gift card is checked on the server; a wrong digit is caught first; up to what is left to pay is taken", async () => {
    const check = vi.fn(async () => card);
    const onCards = vi.fn();
    render(<Harness check={check} onCards={onCards} />);
    fireEvent.click(screen.getByRole("button", { name: "Gift card" }));
    const box = screen.getByLabelText("Gift card number");
    fireEvent.change(box, { target: { value: "6123 4567 8901 2345" } });
    fireEvent.submit(box.closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("That gift card number is not right; check the digits");
    expect(check).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "6123 4567 8901 2344" } });
    await act(async () => {
      fireEvent.submit(box.closest("form")!);
    });
    expect(check).toHaveBeenCalledWith(CARD_NO);
    expect(screen.getByTestId("gift-card-balance").textContent).toContain("₹1,000.00 left");
    expect((screen.getByLabelText("Amount from the card") as HTMLInputElement).value).toBe("500.00");
    fireEvent.click(screen.getByRole("button", { name: "Use card" }));
    expect(onCards).toHaveBeenCalledWith([{ number: CARD_NO, masked: "**** 2344", amount: "500.00", balance: "1000.00" }]);
  });

  it("a blocked card's reason is shown and nothing is taken", async () => {
    const onCards = vi.fn();
    render(<Harness check={async () => ({ ...card, status: "blocked", problem: "This gift card is blocked" })} onCards={onCards} />);
    fireEvent.click(screen.getByRole("button", { name: "Gift card" }));
    const box = screen.getByLabelText("Gift card number");
    fireEvent.change(box, { target: { value: CARD_NO } });
    await act(async () => {
      fireEvent.submit(box.closest("form")!);
    });
    expect(screen.getByRole("alert").textContent).toBe("This gift card is blocked");
    expect(screen.queryByRole("button", { name: "Use card" })).toBeNull();
    expect(onCards).not.toHaveBeenCalled();
  });
});

describe("the billing screen (plan 13)", () => {
  const serverShift = { id: "s1", clientId: "sc", businessDate: "2026-10-15", openedById: "u", openedAt: at.toISOString(), status: "open", openingCash: [], cashMovements: [] };

  async function till(snap: StoredSnapshot, over: Parameters<typeof fakeApi>[0] = {}, user: CurrentUser = { ...sampleUser, permissions: [...sampleUser.permissions, "giftcards.sell"] }) {
    const store = new MemoryStore();
    await store.set("snapshot", snap);
    const shift: LocalShift = { clientId: "sc", id: "s1", businessDate: "2026-10-15", openedAt: at.toISOString(), openedByName: "Ravi", openingCash: [] };
    await store.set("shift", shift);
    await store.set("shiftid:sc", "s1");
    const engine = new TillEngine({ store, api: fakeApi({ me: async () => user, snapshot: async () => snap, currentShift: async () => serverShift, ...over }), device, now: () => at, uuid });
    render(<TillApp device={device} engine={engine} />);
    await screen.findByRole("search");
    return engine;
  }

  function withModules(modules: Partial<Record<ModuleKey, boolean>>): StoredSnapshot {
    return { ...snapshotWithLoyalty(), modules };
  }

  it("after picking a member her points show under the customer", async () => {
    const customerPoints = vi.fn(async () => points);
    const engine = await till(snapshotWithLoyalty(), { customerPoints });
    await waitFor(() => expect(engine.getState().online).toBe(true));
    const d = (await engine.loadDraft()).draft;
    await act(async () => {
      await engine.saveDraft({ ...d, customer: { id: ASHA, name: "Asha", mobile: "9876543210", gstin: null, stateCode: null, customerGroupId: null } });
    });
    cleanup();
    render(<TillApp device={device} engine={engine} />);
    expect((await screen.findByTestId("customer-points")).textContent).toBe("150 points (₹150.00) · Gold");
    expect(customerPoints).toHaveBeenCalledWith(ASHA);
  });

  it("selling a gift card: amount and method, then the receipt with the card number", async () => {
    const result: GiftCardSaleResult = {
      repeated: false,
      card: { ...card },
      receipt: { billId: null, number: "GC-2026-27-00001", kind: "sale", title: "GIFT CARD RECEIPT", duplicate: false, provisional: false, soldAt: at.toISOString(), till: "T1", footer: null, lines: [{ name: "Gift card (new)", code: "", hsn: null, quantity: "1", price: "1000.00", discount: "0.00", amount: "1000.00", free: false, serials: [] }], gstTable: [], totals: { gross: "1000.00", discount: "0.00", taxable: "0.00", rounding: "0.00", total: "1000.00" }, payments: [{ method: "Cash", amount: "1000.00", reference: null }], change: "0.00", giftCards: [{ action: "sold", number: "6123 4567 8901 2344", barcode: true, amount: "1000.00", balance: "1000.00", expiresOn: "2027-10-15" }] },
    };
    const sellGiftCard = vi.fn(async () => result);
    const engine = await till(snapshotWithLoyalty(), { sellGiftCard });
    await waitFor(() => expect(engine.getState().online).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Sell gift card" }));
    const dialog = await screen.findByRole("dialog", { name: "Sell a gift card" });
    fireEvent.change(within(dialog).getByLabelText("Amount (₹)"), { target: { value: "1000" } });
    fireEvent.change(within(dialog).getByLabelText("Holder’s name (optional)"), { target: { value: "Anita" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Sell and print" }));
    });
    expect(sellGiftCard).toHaveBeenCalledWith(expect.objectContaining({ amount: "1000.00", paymentMethodId: CASH, number: null, holderName: "Anita" }));
    const done = await screen.findByRole("dialog", { name: "Bill finished" });
    expect(within(done).getAllByText("GIFT CARD RECEIPT").length).toBeGreaterThan(0);
    expect(within(done).getAllByTestId("receipt-gift-card")[0].textContent).toContain("Card: 6123 4567 8901 2344");
  });

  it("switched off: no Sell gift card button, no points under the customer, no points or gift card on the Pay screen", async () => {
    const customerPoints = vi.fn(async () => points);
    const engine = await till(withModules({ loyalty: false, gift_cards: false }), { customerPoints });
    await waitFor(() => expect(engine.getState().online).toBe(true));
    expect(screen.queryByRole("button", { name: "Sell gift card" })).toBeNull();
    const box = screen.getByLabelText(/Scan a barcode/);
    fireEvent.change(box, { target: { value: "8900001" } });
    fireEvent.submit(box.closest("form")!);
    fireEvent.keyDown(window, { key: "F4" });
    const pay = await screen.findByRole("dialog", { name: "Payment" });
    expect(within(pay).queryByRole("button", { name: /Pay with points/ })).toBeNull();
    expect(within(pay).queryByRole("button", { name: /Gift card/ })).toBeNull();
    expect(customerPoints).not.toHaveBeenCalled();
  });

  it("a cashier without the right to sell gift cards does not see the button", async () => {
    const engine = await till(snapshotWithLoyalty(), {}, sampleUser);
    await waitFor(() => expect(engine.getState().online).toBe(true));
    expect(screen.queryByRole("button", { name: "Sell gift card" })).toBeNull();
  });
});
