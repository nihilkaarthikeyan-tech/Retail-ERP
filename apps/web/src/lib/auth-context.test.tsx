// Copyright (c) 2026, Rademics. All rights reserved.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

function Probe() {
  const { user, loading, unreachable, reconnects } = useAuth();
  return <p>{loading ? (unreachable ? "unreachable" : "loading") : user ? `user ${user.firstName} after ${reconnects}` : "logged out"}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AuthProvider", () => {
  it("a 401 means logged out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ statusCode: 401, message: "Not logged in" }), { status: 401 })));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("logged out")).toBeTruthy();
  });

  // Found in the launch check of 27 October 2026: a short API restart sent everyone to the login page.
  it("a server that cannot be reached is not a logout: it keeps trying and finds the user", async () => {
    // Audit 11: the 3-second retries run on a fake clock, so a busy computer cannot make the test miss its wait.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("Failed to fetch");
        if (calls === 2) return new Response(JSON.stringify({ statusCode: 503, message: "Busy" }), { status: 503 });
        return new Response(JSON.stringify({ id: "u1", firstName: "Lakshmi" }), { status: 200 });
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unreachable")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(screen.getByText("user Lakshmi after 1")).toBeTruthy());
    expect(calls).toBe(3);
    expect(screen.queryByText("logged out")).toBeNull();
  });
});
