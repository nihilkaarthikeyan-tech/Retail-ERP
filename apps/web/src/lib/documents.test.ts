// Copyright (c) 2026, Rademics. All rights reserved.
import type { CurrentUser } from "shared";
import { describe, expect, it } from "vitest";
import { barRuns, companyNameMatches, eanDigits, groupedAmount, logoProblem, printAmount, printCell, sheetLayout, sheetsOf, stockPrintKind } from "./documents";
import { visibleMenu } from "./menu";

describe("print values", () => {
  it("groups amounts the Indian way without floating point", () => {
    expect(groupedAmount("12345678.90")).toBe("1,23,45,678.90");
    expect(groupedAmount("999.00")).toBe("999.00");
    expect(groupedAmount("-1500.50")).toBe("−1,500.50");
    expect(groupedAmount("-0.00")).toBe("0.00");
    expect(printCell("100000.10")).toBe("1,00,000.10");
    expect(printAmount("100000.10")).toBe("₹1,00,000.10");
  });

  it("shows dates as 16 Oct 2026, also inside text, and leaves other text alone", () => {
    expect(printCell("2026-10-16")).toBe("16 Oct 2026");
    expect(printCell("B12 · exp. 2027-04-30")).toBe("B12 · exp. 30 Apr 2027");
    expect(printCell("50 PCS + 2 free")).toBe("50 PCS + 2 free");
    // Quantities and counts are not amounts.
    expect(printCell("12")).toBe("12");
    expect(printAmount("3")).toBe("3");
    expect(printCell(undefined)).toBe("");
  });
});

describe("labels on a sheet", () => {
  it("uses the standard sheet's own layout", () => {
    expect(sheetLayout({ width: 38.1, height: 21.2, across: 5, down: 13, marginTop: 10.7, marginLeft: 4.7, gapX: 2.5, gapY: 0 })).toEqual({ across: 5, down: 13, perSheet: 65, marginTop: 10.7, marginLeft: 4.7, gapX: 2.5, gapY: 0 });
  });

  it("fits as many custom labels as the A4 page takes", () => {
    const l = sheetLayout({ width: 50, height: 30, across: null, down: null, marginTop: null, marginLeft: null, gapX: null, gapY: null });
    // (210 − 10) / 50 = 4 across; (297 − 20) / 30 = 9 down.
    expect([l.across, l.down, l.perSheet]).toEqual([4, 9, 36]);
  });

  it("splits labels into sheets, leaving used spaces of a part-used first sheet empty", () => {
    expect(sheetsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(sheetsOf([1, 2, 3], 4, 2)).toEqual([[null, null, 1, 2], [3]]);
    // At most a sheet less one can be skipped.
    expect(sheetsOf([1], 3, 10)).toEqual([[null, null, 1]]);
  });
});

describe("barcode drawing", () => {
  it("turns runs of 1s into bars and marks EAN guard bars", () => {
    expect(barRuns("0110100").map((r) => [r.x, r.width])).toEqual([
      [1, 2],
      [4, 1],
    ]);
    const ean8 = `101${"0".repeat(28)}01010${"0".repeat(28)}101`;
    const runs = barRuns(ean8, "EAN8");
    expect(runs).toHaveLength(6);
    expect(runs.every((r) => r.guard)).toBe(true);
  });

  it("places EAN-13 digits: the first in the margin, six under each half", () => {
    const digits = eanDigits({ symbology: "EAN13", modules: "1".repeat(95), text: "8901234567890" })!;
    expect(digits[0]).toEqual({ ch: "8", x: -5 });
    expect(digits[1].x).toBe(6.5);
    expect(digits[7].x).toBe(53.5);
    expect(eanDigits({ symbology: "CODE128", modules: "11", text: "AB" })).toBeNull();
  });
});

describe("small rules", () => {
  it("matches the typed company name whatever the capitals and outer spaces", () => {
    expect(companyNameMatches("  rademics retail pvt ltd ", "Rademics Retail Pvt Ltd")).toBe(true);
    expect(companyNameMatches("Rademics Retail", "Rademics Retail Pvt Ltd")).toBe(false);
    expect(companyNameMatches("", "")).toBe(false);
  });

  it("knows which stock documents print and how", () => {
    expect(stockPrintKind("transfer_send")).toBe("transfer");
    expect(stockPrintKind("move")).toBe("transfer");
    expect(stockPrintKind("count")).toBe("count_sheet");
    expect(stockPrintKind("stock_out")).toBeNull();
  });

  it("checks a logo before uploading it", () => {
    expect(logoProblem({ type: "image/png", size: 120_000 })).toBeNull();
    expect(logoProblem({ type: "image/gif", size: 1000 })).toMatch(/PNG or JPEG/);
    expect(logoProblem({ type: "image/jpeg", size: 300_001 })).toMatch(/smaller than 300 KB/);
  });
});

describe("menu", () => {
  const base: CurrentUser = { id: "u", firstName: "A", lastName: null, email: "a@x.test", isOwnerAdmin: false, permissions: [], allStores: true, stores: [], mustChangePassword: false, roles: [] };
  const labels = (u: CurrentUser) => visibleMenu(u).map((e) => e.label);

  it("shows the module 10 pages by right, and Going live to the Owner only", () => {
    expect(labels({ ...base, permissions: ["labels.print"] })).toContain("Labels");
    expect(labels({ ...base, permissions: ["labels.print"] })).not.toContain("Label templates");
    expect(labels({ ...base, permissions: ["import.opening"] })).toContain("Import from Excel");
    expect(labels({ ...base, permissions: ["print.settings"] })).toEqual(expect.arrayContaining(["Settings", "Label templates"]));
    expect(labels({ ...base, permissions: ["golive.manage"] })).not.toContain("Going live");
    expect(labels({ ...base, isOwnerAdmin: true })).toEqual(expect.arrayContaining(["Labels", "Import from Excel", "Settings", "Label templates", "Going live"]));
  });
});
