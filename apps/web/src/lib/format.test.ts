// Copyright (c) 2026, Rademics. All rights reserved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYearFor, formatDateTime, todayIso } from "./format";

// 1 April 2026, 00:05 in India; still 31 March in UTC and in the Americas.
const JUST_AFTER_MIDNIGHT_IST = new Date("2026-03-31T18:35:00Z");
// 31 March 2026, 23:55 in India; already 1 April in far-east time zones.
const JUST_BEFORE_MIDNIGHT_IST = new Date("2026-03-31T18:25:00Z");

// Run every case under machine time zones on both sides of India, so a helper
// that reads the local calendar would fail at least one of them.
const MACHINE_TIME_ZONES = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"];

const originalTz = process.env.TZ;

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(MACHINE_TIME_ZONES)("Indian business dates with machine time zone %s", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });

  it("todayIso gives 1 April for 00:05 IST on 1 April", () => {
    expect(todayIso(JUST_AFTER_MIDNIGHT_IST)).toBe("2026-04-01");
  });

  it("todayIso gives 31 March for 23:55 IST on 31 March", () => {
    expect(todayIso(JUST_BEFORE_MIDNIGHT_IST)).toBe("2026-03-31");
  });

  it("financialYearFor puts 00:05 IST on 1 April in 2026-27", () => {
    expect(financialYearFor(JUST_AFTER_MIDNIGHT_IST)).toEqual({ startDate: "2026-04-01", endDate: "2027-03-31" });
  });

  it("formatDateTime shows the Indian date and time (audit 6)", () => {
    expect(formatDateTime(JUST_AFTER_MIDNIGHT_IST.toISOString())).toMatch(/^01 Apr 2026, 12:05\s?am$/i);
  });

  it("financialYearFor puts 23:55 IST on 31 March in 2025-26", () => {
    expect(financialYearFor(JUST_BEFORE_MIDNIGHT_IST)).toEqual({ startDate: "2025-04-01", endDate: "2026-03-31" });
  });
});

describe("machine time zone actually changes", () => {
  it("the local calendar disagrees with India in Los Angeles, so the tests above are meaningful", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(JUST_AFTER_MIDNIGHT_IST.getDate()).toBe(31);
    expect(todayIso(JUST_AFTER_MIDNIGHT_IST)).toBe("2026-04-01");
  });
});

describe("defaults to now", () => {
  it("todayIso and financialYearFor work without an argument", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fy = financialYearFor();
    expect(fy.startDate).toMatch(/^\d{4}-04-01$/);
    expect(fy.endDate).toMatch(/^\d{4}-03-31$/);
  });
});
