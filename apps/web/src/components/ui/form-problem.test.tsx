// Copyright (c) 2026, Rademics. All rights reserved.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSeasonSchema } from "shared";
import { issuesToFieldErrors } from "@/lib/validation";
import { Dialog } from "./dialog";
import { ToastProvider } from "./toast";

const wrongDates = () => issuesToFieldErrors(createSeasonSchema.safeParse({ code: "DIWALI", name: "Diwali", startsOn: "2026-11-10", endsOn: "2026-10-01" }));

beforeAll(() => {
  // jsdom has no showModal.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

// Found in the launch check of 27 October 2026: a rule about two fields together showed nowhere.
describe("a form problem not tied to one field", () => {
  it("shows in the open pop-up and goes when the person changes something", () => {
    render(
      <ToastProvider>
        <Dialog open title="Add season" onClose={() => {}}>
          <input aria-label="To" />
        </Dialog>
      </ToastProvider>,
    );
    act(() => {
      wrongDates();
    });
    expect(screen.getByRole("alert").textContent).toBe("The season cannot end before it starts");
    fireEvent.input(screen.getByLabelText("To"), { target: { value: "2026-11-15" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows as a red note when no pop-up is open", () => {
    render(
      <ToastProvider>
        <p>page</p>
      </ToastProvider>,
    );
    act(() => {
      wrongDates();
    });
    expect(screen.getByRole("alert").textContent).toContain("The season cannot end before it starts");
  });
});
