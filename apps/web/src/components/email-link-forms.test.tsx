// Copyright (c) 2026, Rademics. All rights reserved.
// Launch check, 27 October 2026: a reset link cut short showed nothing when saving.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "./email-link-forms";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

afterEach(cleanup);

describe("choosing a new password by link", () => {
  it("a link cut short says so and offers a new one, without asking the server", () => {
    search = "token=short";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: "Launch-check-2026" } });
    fireEvent.change(screen.getByLabelText(/Type it again/), { target: { value: "Launch-check-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my new password" }));
    expect(screen.getByText(/This link has expired or has already been used/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask for a new link" })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
