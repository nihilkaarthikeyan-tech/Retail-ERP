// Copyright (c) 2026, Rademics. All rights reserved.
import { afterEach, describe, expect, it } from "vitest";
import { getCounts, recordVisit, setMenuUser } from "./menu-usage";

afterEach(() => {
  setMenuUser(null);
  localStorage.clear();
});

describe("Most used, per person", () => {
  // Found in the launch check of 27 October 2026: a cashier saw the owner's most used screens.
  it("keeps each person's visits apart on a shared computer", () => {
    setMenuUser("owner");
    recordVisit("/items");
    recordVisit("/items");
    setMenuUser("cashier");
    expect(getCounts()).toEqual({});
    recordVisit("/till");
    setMenuUser("owner");
    expect(getCounts()).toEqual({ "/items": 2 });
    setMenuUser("cashier");
    expect(getCounts()).toEqual({ "/till": 1 });
  });
});
