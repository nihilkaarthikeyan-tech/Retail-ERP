// Copyright (c) 2026, Rademics. All rights reserved.
// The till's quick add with an optional birthday and anniversary behind "More"
// (plan 11 C10, scenario 11.19).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleSnapshot } from "@/lib/till/fixtures";
import { CustomerDialog } from "./bill-dialogs";

afterEach(cleanup);

function open() {
  const onPick = vi.fn();
  render(<CustomerDialog open snapshot={sampleSnapshot()} current={null} newId={() => "00000000-0000-4000-8000-000000000055"} onPick={onPick} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9840099881" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meena R" } });
  return onPick;
}

describe("till quick add: birthday and anniversary (plan 11 C10)", () => {
  it("keeps the dates behind More and adds them to the new customer", () => {
    const onPick = open();
    expect(screen.queryByLabelText(/^Birthday: month/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More: birthday, anniversary/ }));
    fireEvent.change(screen.getByLabelText(/^Birthday: month/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/^Birthday: day/), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/^Birthday: year/), { target: { value: "1990" } });
    fireEvent.change(screen.getByLabelText(/^Anniversary: month/), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText(/^Anniversary: day/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "Meena R", mobile: "9840099881", newClientId: "00000000-0000-4000-8000-000000000055", birthday: "08-15", birthYear: 1990, anniversary: "11-20", anniversaryYear: null }));
  });

  it("adds a customer without dates as before", () => {
    const onPick = open();
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    const picked = onPick.mock.calls[0][0];
    expect(picked).toMatchObject({ name: "Meena R", mobile: "9840099881" });
    expect(picked.birthday).toBeUndefined();
  });

  it("refuses half a date or one that is not real, in plain words", () => {
    const onPick = open();
    fireEvent.click(screen.getByRole("button", { name: /More: birthday, anniversary/ }));
    fireEvent.change(screen.getByLabelText(/^Birthday: month/), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(screen.getByText("Birthday: choose both the day and the month")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Birthday: month/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Birthday: day/), { target: { value: "29" } });
    fireEvent.change(screen.getByLabelText(/^Birthday: year/), { target: { value: "2023" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(screen.getByText("Birthday: 2023 had no 29 February")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });
});
