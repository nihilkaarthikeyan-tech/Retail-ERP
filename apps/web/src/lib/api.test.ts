// Copyright (c) 2026, Rademics. All rights reserved.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, query, setUnauthorizedHandler } from "./api";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("sends JSON with the session cookie and returns the parsed body", async () => {
    const fn = mockFetch(200, { id: "1" });
    const result = await api.post<{ id: string }>("/stores", { code: "MAIN" });

    expect(result).toEqual({ id: "1" });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/stores$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ code: "MAIN" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch(204, undefined);
    await expect(api.delete("/auth/sessions/abc")).resolves.toBeUndefined();
  });

  it("throws an ApiError with field errors on a 400 validation failure", async () => {
    mockFetch(400, {
      statusCode: 400,
      message: "Validation failed",
      errors: [
        { path: "company.legalName", message: "Too small" },
        { path: "store.code", message: "Code must be 2–10 letters or digits" },
      ],
    });

    const err = await api.post("/setup", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.statusCode).toBe(400);
    // Audit 9: the message names the problems instead of "Validation failed".
    expect(apiErr.message).toBe("Please check: Too small; Code must be 2–10 letters or digits");
    expect(apiErr.errors).toHaveLength(2);
    expect(apiErr.fieldErrors).toEqual({
      "company.legalName": "Too small",
      "store.code": "Code must be 2–10 letters or digits",
    });
  });

  it("exposes the code of a 403 password-change response", async () => {
    mockFetch(403, { statusCode: 403, message: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" });
    const err = (await api.get("/users").catch((e: unknown) => e)) as ApiError;
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("calls the unauthorized handler on a 401 and still throws", async () => {
    mockFetch(401, { statusCode: 401, message: "Not logged in" });
    const handler = vi.fn();
    const previous = setUnauthorizedHandler(handler);
    try {
      const err = (await api.get("/users").catch((e: unknown) => e)) as ApiError;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(401);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      setUnauthorizedHandler(previous);
    }
  });

  it("does not call the unauthorized handler when redirectOnUnauthorized is false", async () => {
    mockFetch(401, { statusCode: 401, message: "Wrong email or password" });
    const handler = vi.fn();
    const previous = setUnauthorizedHandler(handler);
    try {
      const err = (await api.post("/auth/login", {}, { redirectOnUnauthorized: false }).catch((e: unknown) => e)) as ApiError;
      expect(err.message).toBe("Wrong email or password");
      expect(handler).not.toHaveBeenCalled();
    } finally {
      setUnauthorizedHandler(previous);
    }
  });

  it("wraps a network failure in an ApiError with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("Failed to fetch"))));
    const err = (await api.get("/users").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(0);
    expect(err.message).toMatch(/Cannot reach the server/);
    expect(err.message).not.toMatch(/Failed to fetch/);
  });

  it("says plainly when the server crashed, is restarting, or was asked too often", async () => {
    mockFetch(500, { statusCode: 500, message: "Internal server error" });
    expect(((await api.get("/x").catch((e: unknown) => e)) as ApiError).message).toMatch(/Something went wrong on our side/);
    mockFetch(503, "<html>Service Unavailable</html>");
    expect(((await api.get("/x").catch((e: unknown) => e)) as ApiError).message).toMatch(/restarting or busy/);
    mockFetch(429, { statusCode: 429, message: "Too many tries from this connection. Please wait a few minutes and try again." });
    expect(((await api.get("/x").catch((e: unknown) => e)) as ApiError).message).toMatch(/Too many tries/);
    // A real explanation from the server is kept as it is.
    mockFetch(409, { statusCode: 409, message: "This bill is already cancelled" });
    expect(((await api.get("/x").catch((e: unknown) => e)) as ApiError).message).toBe("This bill is already cancelled");
    // Dates in a message are shown the Indian way (launch check, 27 October 2026).
    mockFetch(400, { statusCode: 400, message: "This year overlaps 2026-04-01 to 2027-03-31" });
    expect(((await api.get("/x").catch((e: unknown) => e)) as ApiError).message).toBe("This year overlaps 01 Apr 2026 to 31 Mar 2027");
  });
});

describe("query", () => {
  it("skips empty values and encodes the rest", () => {
    expect(query({ userId: "", from: "2026-04-01", limit: 50, before: null, to: undefined })).toBe("?from=2026-04-01&limit=50");
    expect(query({})).toBe("");
  });
});
