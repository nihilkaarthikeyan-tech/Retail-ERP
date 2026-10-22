// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 14, scenario 14.3 on screen: signing up checks the form, makes the shop
// and takes the new owner to the setup wizard.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { SignupForm } from "./signup-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

function mockApi(routes: Record<string, { status: number; body: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([path]) => url.endsWith(path));
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${url}` }), { status: 404 });
    return new Response(JSON.stringify(match[1].body), { status: match[1].status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
});

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const signupCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter((c) => String(c[0]).endsWith("/auth/signup"));

function fillIn() {
  type(/^First name/, "Lakshmi");
  type(/^Shop name/, "Lakshmi Fancy");
  type(/^Email/, "Lakshmi@Fancy.test");
  type(/^Mobile/, "9840012345");
  type(/^Password/, "Lakshmi-pass-2026");
}

describe("SignupForm", () => {
  it("checks the form first: the two passwords must match, and nothing is sent", async () => {
    const fn = mockApi({ "/auth/me": { status: 401, body: { statusCode: 401, message: "Not logged in" } } });
    render(
      <AuthProvider>
        <SignupForm />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Start my free trial/ }));
    expect(await screen.findAllByText(/Required|at least|Invalid/i)).toBeTruthy();

    fillIn();
    type(/^Type it again/, "Lakshmi-pass-2025");
    fireEvent.click(screen.getByRole("button", { name: /Start my free trial/ }));
    expect(await screen.findByText("The two passwords are not the same.")).toBeTruthy();
    expect(signupCalls(fn)).toEqual([]);
  });

  it("signs up and takes the new owner to the setup wizard", async () => {
    const fn = mockApi({
      "/auth/me": { status: 401, body: { statusCode: 401, message: "Not logged in" } },
      "/auth/signup": { status: 201, body: { id: "u1", firstName: "Lakshmi", isOwnerAdmin: true } },
    });
    render(
      <AuthProvider>
        <SignupForm />
      </AuthProvider>,
    );
    fillIn();
    type(/^Type it again/, "Lakshmi-pass-2026");
    fireEvent.click(screen.getByRole("button", { name: /Start my free trial/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup"));
    const [call] = signupCalls(fn);
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ firstName: "Lakshmi", lastName: null, email: "lakshmi@fancy.test", mobile: "9840012345", shopName: "Lakshmi Fancy", password: "Lakshmi-pass-2026" });
  });

  it("shows the server's message when the email already has an account", async () => {
    mockApi({
      "/auth/me": { status: 401, body: { statusCode: 401, message: "Not logged in" } },
      "/auth/signup": { status: 409, body: { statusCode: 409, message: "An account with this email already exists. Log in instead." } },
    });
    render(
      <AuthProvider>
        <SignupForm />
      </AuthProvider>,
    );
    fillIn();
    type(/^Type it again/, "Lakshmi-pass-2026");
    fireEvent.click(screen.getByRole("button", { name: /Start my free trial/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(replace).not.toHaveBeenCalled();
  });
});
