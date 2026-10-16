// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BirthdaysList, occasionText, type UpcomingDatesDto, whenText } from "./birthdays-list";
import { type DayMonthYear, DayMonthYearFields, joinDayMonth, splitDayMonth } from "./customer-dates-fields";
import { CustomerPurchases, type CustomerPurchasesDto } from "./customer-purchases";

function stubApi(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = routes[url.pathname];
    return body === undefined ? new Response(JSON.stringify({ statusCode: 404, message: "Not found" }), { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("birthday and anniversary fields (plan 11 C10)", () => {
  it("turn day, month and year into MM-DD and a year, and back", () => {
    expect(joinDayMonth({ day: "5", month: "8", year: "" })).toEqual({ dayMonth: "08-05", year: null });
    expect(joinDayMonth({ day: "29", month: "2", year: "1996" })).toEqual({ dayMonth: "02-29", year: 1996 });
    expect(joinDayMonth({ day: "", month: "8", year: "" })).toEqual({ dayMonth: null, year: null });
    expect(Number.isNaN(joinDayMonth({ day: "1", month: "1", year: "96" }).year)).toBe(true);
    expect(splitDayMonth("08-05", 1990)).toEqual({ day: "5", month: "8", year: "1990" });
    expect(splitDayMonth(null, null)).toEqual({ day: "", month: "", year: "" });
  });

  function Harness() {
    const [v, setV] = useState<DayMonthYear>({ day: "31", month: "1", year: "" });
    return <DayMonthYearFields idPrefix="t" label="Birthday" value={v} onChange={setV} />;
  }

  it("offers only the days a month has, and clears a day the new month lacks", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/^Birthday: month/), { target: { value: "2" } });
    const day = screen.getByLabelText(/^Birthday: day/) as HTMLSelectElement;
    expect(day.value).toBe("");
    expect(day.options[day.options.length - 1].value).toBe("29");
  });
});

describe("CustomerPurchases (plan 11 C9)", () => {
  const DTO: CustomerPurchasesDto = {
    customerId: "c1",
    isWalkIn: false,
    thisYear: { name: "2026-27", from: "2026-04-01", to: "2027-03-31", bills: 2, returns: 1, netSales: "2000.00", total: "2100.00", quantity: "2" },
    lastYear: null,
    page: 1,
    pageSize: 50,
    total: 2,
    rows: [
      { id: "b2", number: "MAIN-T1-2026-27-000004", kind: "return", status: "completed", date: "2026-10-16", soldAt: "2026-10-16T05:00:00Z", store: { id: "s1", code: "MAIN", name: "Main Store" }, returnOfId: "b1", lines: 1, quantity: "-1", netAmount: "-1000.00", amount: "-1050.00" },
      { id: "b1", number: "MAIN-T1-2026-27-000001", kind: "sale", status: "completed", date: "2026-10-16", soldAt: "2026-10-16T04:00:00Z", store: { id: "s1", code: "MAIN", name: "Main Store" }, returnOfId: null, lines: 1, quantity: "2", netAmount: "2000.00", amount: "2100.00" },
    ],
  };

  it("shows this and last year's totals and the bills, returns marked", async () => {
    const fetchMock = stubApi({ "/customers/c1/purchases": DTO });
    render(<CustomerPurchases customerId="c1" />);
    const year = await screen.findByLabelText("This financial year");
    expect(year.textContent).toContain("2026-27");
    expect(year.textContent).toContain("₹2,100.00");
    expect(year.textContent).toContain("₹2,000.00");
    expect(screen.getByLabelText("Last financial year").textContent).toContain("No financial year set up");
    const ret = screen.getByRole("link", { name: "MAIN-T1-2026-27-000004" });
    expect(ret.getAttribute("href")).toBe("/pos/bills/b2");
    expect(ret.closest("tr")!.textContent).toContain("Return");
    expect(ret.closest("tr")!.textContent).toContain("−₹1,050.00");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Birthdays this week (plan 11 C10)", () => {
  it("lists the coming days, soonest first, and marks customers who want no promotions", async () => {
    const dto: UpcomingDatesDto = {
      from: "2026-10-16",
      days: 7,
      rows: [
        { customerId: "c3", code: "CUS-000003", name: "Meena R", mobile: "9840011225", email: null, status: "active", kind: "anniversary", dayMonth: "10-16", on: "2026-10-16", daysAway: 0, years: 16, noPromotions: true },
        { customerId: "c1", code: "CUS-000001", name: "Priya S", mobile: "9840011223", email: null, status: "active", kind: "birthday", dayMonth: "10-18", on: "2026-10-18", daysAway: 2, years: 30, noPromotions: false },
      ],
    };
    const fetchMock = stubApi({ "/customers/birthdays": dto });
    render(<BirthdaysList />);
    const meena = (await screen.findByText(/Meena R/)).closest("tr")!;
    expect(meena.textContent).toContain("Today");
    expect(meena.textContent).toContain("Anniversary (16 years)");
    expect(meena.textContent).toContain("No promotions");
    const priya = screen.getByText(/Priya S/).closest("tr")!;
    expect(priya.textContent).toContain("Birthday (turns 30)");
    expect(priya.textContent).toContain("In 2 days");
    expect(priya.textContent).toContain("Allowed");

    fireEvent.change(screen.getByLabelText(/^Coming up in/), { target: { value: "31" } });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("days=31"))).toBe(true));
  });

  it("words the day and the occasion plainly", () => {
    expect(whenText(1)).toBe("Tomorrow");
    expect(occasionText({ kind: "birthday", years: null })).toBe("Birthday");
    expect(occasionText({ kind: "anniversary", years: 1 })).toBe("Anniversary (1 year)");
  });
});
