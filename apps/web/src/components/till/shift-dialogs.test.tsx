// Copyright (c) 2026, Rademics. All rights reserved.
// Launch check, 27 October 2026: a shift opened with an empty starting-cash box
// became ₹0 without a question.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TillEngine } from "@/lib/till/engine";
import { OpenShiftScreen } from "./shift-dialogs";

afterEach(cleanup);

describe("opening a shift", () => {
  it("asks once before opening with ₹0, and opens on the second press", async () => {
    const openShift = vi.fn(async () => undefined);
    render(<OpenShiftScreen engine={{ openShift } as unknown as TillEngine} openedBy="Ravi" />);
    fireEvent.click(screen.getByRole("button", { name: "Open shift" }));
    expect(openShift).not.toHaveBeenCalled();
    expect(screen.getByText(/is the drawer really empty/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, open with ₹0" }));
    await vi.waitFor(() => expect(openShift).toHaveBeenCalledWith("0", "Ravi"));
  });

  it("opens at once when an amount is typed", async () => {
    const openShift = vi.fn(async () => undefined);
    render(<OpenShiftScreen engine={{ openShift } as unknown as TillEngine} openedBy="Ravi" />);
    fireEvent.change(screen.getByLabelText("Starting cash (₹)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Open shift" }));
    await vi.waitFor(() => expect(openShift).toHaveBeenCalledWith("2000", "Ravi"));
  });
});
