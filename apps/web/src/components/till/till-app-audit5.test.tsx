// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 5 (29 October 2026): one billing tab per till, a plain message when
// the till's database cannot be opened, and the status for a server fault, an
// unregistered till, a session that ended and a long offline spell.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TillEngine } from "@/lib/till/engine";
import { fakeApi, sampleSnapshot, TILL_ID } from "@/lib/till/fixtures";
import { MemoryStore } from "@/lib/till/storage";
import { OTHER_TAB, STORAGE_FAILED, TillApp } from "./till-app";
import { statusText } from "./till-status";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/till",
  useSearchParams: () => new URLSearchParams(""),
}));

const device = { tillId: TILL_ID, tillCode: "T1", deviceName: "Counter 1", token: "tok" };
const at = new Date("2026-10-15T05:00:00.000Z");

function withLocks(free: boolean) {
  const request = vi.fn((_name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void> | void) => {
    if (free) return Promise.resolve(cb({ name: _name }));
    if (opts.ifAvailable) return Promise.resolve(cb(null));
    return new Promise<void>(() => {});
  });
  Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
  return request;
}

afterEach(() => {
  cleanup();
  delete (navigator as { locks?: unknown }).locks;
});

describe("one billing tab per till", () => {
  it("a second tab of the same till says the till is open in another tab", async () => {
    const request = withLocks(false);
    const engine = new TillEngine({ store: new MemoryStore(), api: fakeApi(), device, now: () => at });
    const start = vi.spyOn(engine, "start");
    render(<TillApp device={device} engine={engine} />);
    expect(await screen.findByText(OTHER_TAB)).toBeTruthy();
    expect(request).toHaveBeenCalledWith(`retail-erp-till-${TILL_ID}`, expect.anything(), expect.any(Function));
    expect(start).not.toHaveBeenCalled();
  });

  it("the tab holding the till's lock bills as usual", async () => {
    withLocks(true);
    const store = new MemoryStore();
    await store.set("snapshot", sampleSnapshot());
    const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at });
    render(<TillApp device={device} engine={engine} />);
    expect(await screen.findByText("Open the shift")).toBeTruthy();
  });
});

describe("a till that cannot save on this computer", () => {
  it("says so instead of opening for ever", async () => {
    const store = new MemoryStore();
    store.get = () => Promise.reject(new Error("QuotaExceededError"));
    const engine = new TillEngine({ store, api: fakeApi(), device, now: () => at });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TillApp device={device} engine={engine} />);
    expect(await screen.findByText(new RegExp(STORAGE_FAILED.slice(0, 40)))).toBeTruthy();
    expect(screen.queryByText("Opening the till…")).toBeNull();
  });
});

describe("status (audit 5)", () => {
  const base = { online: true, signedOut: false, waiting: 0, problems: 0, fetchedAt: null, stale: false };
  it("tells a server fault from being offline, and shows the till's own problems first", () => {
    expect(statusText({ ...base, online: false, serverTrouble: true, waiting: 2 })).toEqual({ tone: "warn", text: "Server not answering, 2 waiting" });
    expect(statusText({ ...base, signedOut: true, waiting: 3 })).toEqual({ tone: "warn", text: "Sign in again, 3 waiting" });
    expect(statusText({ ...base, tillNotRegistered: true, problems: 1 })).toEqual({ tone: "danger", text: "Not registered as this till" });
    expect(statusText({ ...base, online: false, away: { level: "stop", message: "Offline for more than 48 hours" } })).toEqual({ tone: "danger", text: "Offline, 0 waiting" });
  });
});
