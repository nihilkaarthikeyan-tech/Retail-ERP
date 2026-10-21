// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12: the module map on the till's saved copy.
import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "./fixtures";
import { tillModuleOn, withoutSwitchedOff } from "./modules";
import { emptyDraft } from "./pricing";
import { mergeSnapshot } from "./snapshot";

describe("optional modules on the till (plan 12)", () => {
  it("a module is on unless the saved copy says it is off", () => {
    expect(tillModuleOn(null, "delivery")).toBe(true);
    expect(tillModuleOn(sampleSnapshot(), "delivery")).toBe(true);
    expect(tillModuleOn(sampleSnapshot({ modules: { offers: false } }), "delivery")).toBe(true);
    expect(tillModuleOn(sampleSnapshot({ modules: { delivery: false } }), "delivery")).toBe(false);
    expect(tillModuleOn(sampleSnapshot({ modules: { delivery: true } }), "delivery")).toBe(true);
  });

  it("each refresh brings the whole map; a change of items only keeps the newest map", () => {
    const old = sampleSnapshot({ modules: { delivery: true, offers: false } });
    const delta = { ...sampleSnapshot({ modules: { delivery: false, offers: true } }), full: false, items: [] };
    const merged = mergeSnapshot(old, delta, new Date("2026-10-15T05:00:00.000Z"));
    expect(merged.modules).toEqual({ delivery: false, offers: true });
    expect(merged.items).toHaveLength(old.items.length);
  });

  it("the salesperson is left off a bill only while Salesperson is switched off", () => {
    const draft = { ...emptyDraft("d1", new Date()), salesStaffId: "s1", lines: [{ key: "k1", itemId: "i1", unitId: "u1", quantity: "1", barcode: null, priceOverride: null, discountPercent: "0", salesStaffId: "s2" }] };
    expect(withoutSwitchedOff(draft, sampleSnapshot())).toBe(draft);
    const off = withoutSwitchedOff(draft, sampleSnapshot({ modules: { salesperson: false } }));
    expect(off.salesStaffId).toBeNull();
    expect(off.lines[0].salesStaffId).toBeNull();
    expect(off.lines[0].itemId).toBe("i1");
  });
});
