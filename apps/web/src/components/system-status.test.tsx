// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemStatus } from "./system-status";

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SystemStatus", () => {
  it("shows API and database as connected", async () => {
    mockFetch(200, {
      status: "ok",
      api: { version: "0.0.1", time: "2026-10-14T10:00:00.000Z" },
      database: { connected: true },
    });
    render(<SystemStatus />);

    expect(await screen.findByText(/Connected \(version 0\.0\.1\)/)).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("says the database is not connected, without its details (they are in the server log)", async () => {
    mockFetch(503, {
      status: "error",
      api: { version: "0.0.1", time: "2026-10-14T10:00:00.000Z" },
      database: { connected: false },
    });
    render(<SystemStatus />);

    expect(await screen.findByText(/Not connected\. The details are in the server log/)).toBeTruthy();
  });

  it("shows the API as not reachable when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("Failed to fetch"))));
    render(<SystemStatus />);

    expect(await screen.findByText(/Not reachable: Failed to fetch/)).toBeTruthy();
  });
});
