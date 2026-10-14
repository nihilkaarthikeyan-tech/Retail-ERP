// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { LoginForm } from "./login-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

/** Routes fetch calls by path so /auth/me and /auth/login can answer differently. */
function mockApi(routes: Record<string, { status: number; body: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([path]) => url.endsWith(path));
    if (!match) return new Response(JSON.stringify({ statusCode: 404, message: `No route for ${url}` }), { status: 404 });
    const { status, body } = match[1];
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe("LoginForm", () => {
  it("shows the server's error message when the login is refused", async () => {
    mockApi({
      "/auth/me": { status: 401, body: { statusCode: 401, message: "Not logged in" } },
      "/auth/login": { status: 401, body: { statusCode: 401, message: "Wrong email or password" } },
    });
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("Wrong email or password");
    expect(replace).not.toHaveBeenCalled();
  });

  it("validates the email before calling the API", async () => {
    const fetchMock = mockApi({
      "/auth/me": { status: 401, body: { statusCode: 401, message: "Not logged in" } },
    });
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "something" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("goes to the dashboard after a successful login", async () => {
    const user = {
      id: "u1",
      firstName: "Asha",
      lastName: null,
      email: "owner@example.com",
      isOwnerAdmin: true,
      permissions: [],
      allStores: true,
      stores: [],
      mustChangePassword: false,
      roles: [],
    };
    mockApi({
      "/auth/me": { status: 200, body: user },
      "/auth/login": { status: 200, body: user },
    });
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
