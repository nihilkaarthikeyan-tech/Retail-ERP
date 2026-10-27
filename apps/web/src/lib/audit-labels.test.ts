// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from "vitest";
import { actionName, addressName, browserName, fieldName, recordName } from "./audit-labels";

describe("plain words in the history and sessions", () => {
  it("names actions, records and fields", () => {
    expect(actionName("login_failed")).toBe("Login refused");
    expect(recordName("number_series")).toBe("Document numbering");
    expect(fieldName("failedLoginCount")).toBe("Failed login count");
    expect(fieldName("allStores")).toBe("All stores");
    expect(fieldName("storeId")).toBe("Store");
    expect(fieldName("gstin")).toBe("GSTIN");
  });

  it("names the browser and the server's own address", () => {
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(browserName("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/150.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/150.0 Safari/537.36 Edg/150.0")).toBe("Edge on Windows");
    expect(addressName("::1")).toBe("This server");
    expect(addressName("::ffff:49.37.10.2")).toBe("49.37.10.2");
  });
});
