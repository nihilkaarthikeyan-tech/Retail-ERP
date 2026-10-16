// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, DataTable, SelectInput, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

/** One birthday or anniversary (GET /customers/birthdays). */
export interface UpcomingDateRow {
  customerId: string;
  code: string;
  name: string;
  mobile: string | null;
  email: string | null;
  status: "active" | "blocked" | "off";
  kind: "birthday" | "anniversary";
  dayMonth: string;
  /** The Indian date it falls on in this window. */
  on: string;
  daysAway: number;
  /** The age they turn, or the years married, when the year is known. */
  years: number | null;
  /** The customer does not want promotional messages (decision 74). */
  noPromotions: boolean;
}

export interface UpcomingDatesDto {
  from: string;
  days: number;
  rows: UpcomingDateRow[];
}

export function whenText(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

export function occasionText(r: Pick<UpcomingDateRow, "kind" | "years">): string {
  if (r.kind === "birthday") return r.years ? `Birthday (turns ${r.years})` : "Birthday";
  return r.years ? `Anniversary (${r.years} year${r.years === 1 ? "" : "s"})` : "Anniversary";
}

/** "Birthdays and anniversaries this week" under Customers (plan 11 C10). */
export function BirthdaysList() {
  const [days, setDays] = useState("7");
  const list = useLoad(() => api.get<UpcomingDatesDto>(`/customers/birthdays?days=${days}`), [days]);
  const columns: Column<UpcomingDateRow>[] = [
    {
      key: "when",
      header: "When",
      render: (r) => (
        <>
          {formatDate(r.on)} <span className="muted">{whenText(r.daysAway)}</span>
        </>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (r) => (
        <Link href={`/customers/${r.customerId}`}>
          <span className="mono">{r.code}</span> — {r.name}
        </Link>
      ),
    },
    { key: "occasion", header: "Occasion", render: (r) => occasionText(r) },
    { key: "mobile", header: "Mobile", render: (r) => <span className="mono">{r.mobile ?? "—"}</span> },
    { key: "promotions", header: "Messages", render: (r) => (r.noPromotions ? <Badge kind="warn">No promotions</Badge> : <span className="muted">Allowed</span>) },
  ];
  return (
    <>
      <h1>Birthdays and anniversaries</h1>
      <p className="muted">Customers with a birthday or anniversary coming up, by Indian date. Those marked &ldquo;No promotions&rdquo; have asked not to get offers by SMS or email; greet them without an offer.</p>
      <div className="filter-row">
        <SelectInput id="bd-days" label="Coming up in" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">The next 7 days</option>
          <option value="14">The next 14 days</option>
          <option value="31">The next 31 days</option>
        </SelectInput>
      </div>
      <Alert kind="error">{list.error}</Alert>
      <DataTable columns={columns} rows={list.data?.rows} rowKey={(r) => `${r.customerId}-${r.kind}`} loading={list.loading} empty="No birthdays or anniversaries coming up." />
    </>
  );
}
