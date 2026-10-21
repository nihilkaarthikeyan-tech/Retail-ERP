// Copyright (c) 2026, Rademics. All rights reserved.
// The report centre (plan 09 §1.3): every report in the product, grouped as
// daily, weekly and monthly, each with the question it answers. A report is
// listed only for users who may run it.
"use client";

import Link from "next/link";
import { hasPermission } from "shared";
import { Alert } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { FREQUENCY_LABELS, type ReportFrequency, visibleReports } from "@/lib/reports";

const FREQUENCY_HINTS: Record<ReportFrequency, string> = {
  daily: "For keeping an eye on each day.",
  weekly: "For planning stock and checking dues.",
  monthly: "For closing the month and seeing how the business did.",
  gst: "The figures for the GST returns, per GSTIN, for a month or a quarter.",
};

export function ReportCentre() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  const reports = visibleReports(user);
  const canEmail = hasPermission(user, "reports.summary_email");

  return (
    <>
      <h1>Reports</h1>
      <p className="muted">Every report you may run, with the question it answers. Each one can be downloaded for Excel or printed.</p>
      {reports.length === 0 ? <Alert kind="info">You do not have the right to see any reports. Ask the owner if you need them.</Alert> : null}
      {(["daily", "weekly", "monthly", "gst"] as ReportFrequency[]).map((freq) => {
        const list = reports.filter((r) => r.frequency === freq);
        if (list.length === 0) return null;
        return (
          <section key={freq} aria-labelledby={`rc-${freq}`} className="report-centre-group">
            <h2 id={`rc-${freq}`}>{FREQUENCY_LABELS[freq]}</h2>
            <p className="muted">{FREQUENCY_HINTS[freq]}</p>
            <ul className="report-list">
              {list.map((r) => (
                <li key={r.id} className={`area-${r.area}`}>
                  <Link href={r.href} className="report-link">
                    {r.title}
                  </Link>
                  {r.where ? <span className="report-where">{r.where}</span> : null}
                  <p className="muted">{r.question}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {canEmail ? (
        <section aria-labelledby="rc-email" className="report-centre-group">
          <h2 id="rc-email">Sent by email</h2>
          <ul className="report-list">
            <li className="area-admin">
              <Link href="/reports/summary-email" className="report-link">
                Daily summary email
              </Link>
              <p className="muted">Yesterday&apos;s sales, cash, dues and stock problems, sent to you once a day.</p>
            </li>
          </ul>
        </section>
      ) : null}
    </>
  );
}
