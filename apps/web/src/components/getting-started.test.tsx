// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12, scenario 12.7 on screen: the owner's getting-started checklist shows
// each step with its screen and whether it is done, and can be hidden and shown.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type CurrentUser, GETTING_STARTED_STEPS, type GettingStartedDto } from "shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { GettingStarted } from "./getting-started";

/** Audit 11: shown once the sign-in has loaded, so "nothing appeared" is checked after the screen has decided. */
function SignedIn() {
  const { user } = useAuth();
  return user ? <span>signed in</span> : null;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const person = (isOwnerAdmin: boolean): CurrentUser => ({ id: "u1", firstName: "Karthik", lastName: null, email: "owner@example.com", isOwnerAdmin, permissions: isOwnerAdmin ? [] : ["pos.sell"], allStores: true, stores: [], mustChangePassword: false, roles: [] });

function checklist(done: string[], hidden = false): GettingStartedDto {
  const steps = GETTING_STARTED_STEPS.map((s) => ({ ...s, done: done.includes(s.key), note: s.key === "tills" && done.includes("tills") ? "2 tills" : null }));
  return { hidden, steps, doneCount: steps.filter((s) => s.done).length, total: steps.length };
}

function mockApi(me: CurrentUser, start: GettingStartedDto) {
  let state = start;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/auth/me") return new Response(JSON.stringify(me), { status: 200 });
    if (url.pathname === "/getting-started" && method === "GET") return new Response(JSON.stringify(state), { status: 200 });
    if (url.pathname === "/getting-started" && method === "PUT") {
      state = { ...state, hidden: JSON.parse(String(init!.body)).hidden };
      return new Response(JSON.stringify(state), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "No route" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const renderIt = () =>
  render(
    <AuthProvider>
      <GettingStarted />
    </AuthProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("getting-started checklist (12.7)", () => {
  it("shows every step with its screen, ticks the done ones, and counts them", async () => {
    mockApi(person(true), checklist(["tills", "items"]));
    renderIt();
    expect(await screen.findByRole("heading", { name: "Getting started" })).toBeTruthy();
    expect(screen.getByText("2 of 8 done")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add tills and payment methods" }).getAttribute("href")).toBe("/pos/tills");
    expect(screen.getByRole("link", { name: "Set your go-live date" }).getAttribute("href")).toBe("/go-live");
    expect(screen.getByText("2 tills")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.classList.contains("is-done"))).toEqual([true, true, false, false, false, false, false, false]);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
  });

  it("the owner hides it, and can bring it back", async () => {
    const fn = mockApi(person(true), checklist(["tills"]));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Hide" }));
    expect(await screen.findByRole("button", { name: "Show the checklist" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the checklist" }));
    expect(await screen.findByRole("heading", { name: "Getting started" })).toBeTruthy();
    const puts = fn.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT").map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(puts).toEqual([{ hidden: true }, { hidden: false }]);
  });

  it("is gone once every step is done, and is never shown to staff", async () => {
    mockApi(person(true), checklist(GETTING_STARTED_STEPS.map((s) => s.key)));
    const { container } = renderIt();
    await waitFor(() => expect(container.textContent).toBe(""));
    cleanup();

    const fn = mockApi(person(false), checklist([]));
    render(
      <AuthProvider>
        <GettingStarted />
        <SignedIn />
      </AuthProvider>,
    );
    await screen.findByText("signed in");
    expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
    expect(fn.mock.calls.some((c) => new URL(String(c[0])).pathname === "/getting-started")).toBe(false);
  });
});
