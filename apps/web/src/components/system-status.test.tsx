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
      database: {
        connected: true,
        serverVersion: "17.6",
        serverTime: "2026-10-14T10:00:00.000Z",
      },
    });
    render(<SystemStatus />);

    expect(await screen.findByText(/Connected \(version 0\.0\.1\)/)).toBeTruthy();
    expect(screen.getByText(/PostgreSQL 17\.6/)).toBeTruthy();
  });

  it("shows the database error when the API cannot reach it", async () => {
    mockFetch(503, {
      status: "error",
      api: { version: "0.0.1", time: "2026-10-14T10:00:00.000Z" },
      database: { connected: false, error: "connection refused" },
    });
    render(<SystemStatus />);

    expect(await screen.findByText(/Not connected: connection refused/)).toBeTruthy();
  });

  it("shows the API as not reachable when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("Failed to fetch"))));
    render(<SystemStatus />);

    expect(await screen.findByText(/Not reachable: Failed to fetch/)).toBeTruthy();
  });
});
