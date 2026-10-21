// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 08 G4: the buyer's GSTIN at the till, checked with its check character.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { gstinCheckCharacter } from "shared";
import { BuyerDialog } from "./extras-dialogs";

const KA = `29AABCK1234A1Z${gstinCheckCharacter("29AABCK1234A1Z")}`;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("BuyerDialog", () => {
  it("refuses a GSTIN with a typing mistake, then saves the buyer with the state from the GSTIN", () => {
    const onSave = vi.fn();
    render(<BuyerDialog open current={null} defaults={{ name: "" }} onSave={onSave} onClose={() => undefined} />);
    const typo = KA.slice(0, 14) + (KA[14] === "A" ? "B" : "A");
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: typo.toLowerCase() } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kaveri Traders" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "12 MG Road, Bengaluru" } });
    fireEvent.click(screen.getByRole("button", { name: "Save buyer" }));
    expect(screen.getByText(/typing mistake/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: KA } });
    expect(screen.getByText("From the GSTIN: 29")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save buyer" }));
    expect(onSave).toHaveBeenCalledWith({ gstin: KA, name: "Kaveri Traders", address: "12 MG Road, Bengaluru", stateCode: "29" });
  });

  it("a business invoice needs the name and address", () => {
    const onSave = vi.fn();
    render(<BuyerDialog open current={null} defaults={{ name: "" }} onSave={onSave} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: KA } });
    fireEvent.click(screen.getByRole("button", { name: "Save buyer" }));
    expect(screen.getByText(/name and address/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
