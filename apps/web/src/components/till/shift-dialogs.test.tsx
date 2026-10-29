// Copyright (c) 2026, Rademics. All rights reserved.
// Launch check, 27 October 2026: a shift opened with an empty starting-cash box
// became ₹0 without a question. Audit 5 (29 October 2026): the float suggested
// from the last close (C7), the blind count (C8), a new count asks the manager
// again, and a large cash out needs a manager (C5).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TillEngine } from "@/lib/till/engine";
import type { ServerShift } from "@/lib/till/types";
import { CashDialog, CloseShiftDialog, OpenShiftScreen } from "./shift-dialogs";

afterEach(cleanup);

describe("opening a shift", () => {
  it("asks once before opening with ₹0, and opens on the second press", async () => {
    const openShift = vi.fn(async () => undefined);
    render(<OpenShiftScreen engine={{ openShift, suggestedFloat: () => null } as unknown as TillEngine} openedBy="Ravi" />);
    fireEvent.click(screen.getByRole("button", { name: "Open shift" }));
    expect(openShift).not.toHaveBeenCalled();
    expect(screen.getByText(/is the drawer really empty/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, open with ₹0" }));
    await vi.waitFor(() => expect(openShift).toHaveBeenCalledWith("0", "Ravi"));
  });

  it("opens at once when an amount is typed", async () => {
    const openShift = vi.fn(async () => undefined);
    render(<OpenShiftScreen engine={{ openShift, suggestedFloat: () => null } as unknown as TillEngine} openedBy="Ravi" />);
    fireEvent.change(screen.getByLabelText("Starting cash (₹)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Open shift" }));
    await vi.waitFor(() => expect(openShift).toHaveBeenCalledWith("2000", "Ravi"));
  });

  it("fills in the cash counted at the last close (C7)", async () => {
    const openShift = vi.fn(async () => undefined);
    render(<OpenShiftScreen engine={{ openShift, suggestedFloat: () => "1850.00" } as unknown as TillEngine} openedBy="Ravi" />);
    expect((screen.getByLabelText("Starting cash (₹)") as HTMLInputElement).value).toBe("1850.00");
    expect(screen.getByText(/Filled in from the cash counted at the last close/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open shift" }));
    await vi.waitFor(() => expect(openShift).toHaveBeenCalledWith("1850.00", "Ravi"));
  });
});

const CASH = "c0000000-0000-4000-8000-000000000001";
const shift: ServerShift = {
  id: "s1",
  clientId: "sc",
  businessDate: "2026-10-15",
  openedById: "u",
  openedAt: "2026-10-15T03:30:00.000Z",
  status: "open",
  openingCash: [],
  cashMovements: [],
  expected: [{ paymentMethodId: CASH, code: "CASH", name: "Cash", kind: "cash", opening: "0.00", received: "1500.00", change: "0.00", cashIn: "0.00", cashOut: "0.00", expected: "1500.00" }],
};

function closeEngine(blindCount: boolean) {
  const closeShift = vi.fn(async () => shift);
  const api = { people: async () => ({ managers: [{ id: "m1", name: "Manager" }], cashiers: [] }), approve: vi.fn(async () => ({ token: "ok-1", manager: { id: "m1", name: "Manager" } })) };
  const engine = { closingInfo: async () => ({ shift, approvalAmount: "100.00", blindCount }), closeShift, api } as unknown as TillEngine;
  return { engine, closeShift, api };
}

describe("closing a shift", () => {
  it("with a blind count, shows the expected cash only after the count is entered (C8)", async () => {
    const { engine, closeShift } = closeEngine(true);
    render(<CloseShiftDialog open engine={engine} online onClose={() => {}} onClosed={() => {}} />);
    await screen.findByText("Notes and coins in the drawer");
    expect(screen.queryByText("Expected")).toBeNull();
    expect(screen.queryByText("₹1,500.00")).toBeNull();
    fireEvent.change(screen.getByLabelText("Count of ₹500"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Count entered: show expected" }));
    expect(screen.getByText("Expected")).toBeTruthy();
    expect(closeShift).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close shift" }));
    await vi.waitFor(() => expect(closeShift).toHaveBeenCalled());
  });

  it("a manager's approval of a difference is dropped when the count changes", async () => {
    const { engine, closeShift } = closeEngine(false);
    render(<CloseShiftDialog open engine={engine} online onClose={() => {}} onClosed={() => {}} />);
    await screen.findByText("Expected");
    fireEvent.change(screen.getByLabelText("Count of ₹500"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Remark"), { target: { value: "Short" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask a manager and close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manager" }));
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Approved by Manager/);
    // Recounted: the approval was for the old difference.
    fireEvent.change(screen.getByLabelText("Count of ₹100"), { target: { value: "1" } });
    expect(screen.queryByText(/Approved by Manager/)).toBeNull();
    expect(screen.getByRole("button", { name: "Ask a manager and close" })).toBeTruthy();
    expect(closeShift).not.toHaveBeenCalled();
  });
});

describe("cash out", () => {
  it("above the set amount asks a manager and sends the approval (C5)", async () => {
    const cashMovement = vi.fn(async () => undefined);
    const approve = vi.fn(async () => ({ token: "co-1", manager: { id: "m1", name: "Manager" } }));
    const engine = {
      cashMovement,
      cashOutApprovalAbove: () => "2000.00",
      getState: () => ({ online: true, signedOut: false }),
      api: { people: async () => ({ managers: [{ id: "m1", name: "Manager" }], cashiers: [] }), approve },
    } as unknown as TillEngine;
    render(<CashDialog open engine={engine} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Supplier" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask a manager and save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manager" }));
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Approved by Manager/);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ action: "cash_out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(cashMovement).toHaveBeenCalledWith("out", "2500", "Supplier", "co-1"));
  });

  it("a small cash out goes without a manager", async () => {
    const cashMovement = vi.fn(async () => undefined);
    const engine = { cashMovement, cashOutApprovalAbove: () => "2000.00", getState: () => ({ online: false, signedOut: false }), api: {} } as unknown as TillEngine;
    render(<CashDialog open engine={engine} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Tea" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(cashMovement).toHaveBeenCalledWith("out", "200", "Tea", undefined));
  });
});
