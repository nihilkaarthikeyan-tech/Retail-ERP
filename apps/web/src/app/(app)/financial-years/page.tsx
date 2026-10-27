// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createFinancialYearSchema, financialYearName, hasPermission, isIsoDate, isRegularYear, nextFinancialYear } from "shared";
import { Alert, Badge, Button, CheckInput, DataTable, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { financialYearFor, formatDate, todayIso } from "@/lib/format";
import type { FinancialYearDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

export default function FinancialYearsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "financial_years.manage");
  const years = useLoad(() => api.get<FinancialYearDto[]>("/financial-years"));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isIrregular, setIsIrregular] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);

  function suggestNext() {
    const latest = years.data?.[0];
    const next = latest ? nextFinancialYear(latest) : financialYearFor();
    setStartDate(next.startDate);
    setEndDate(next.endDate);
  }

  const previewName = isIsoDate(startDate) && isIsoDate(endDate) ? financialYearName({ startDate, endDate }) : null;
  const regular = isIsoDate(startDate) && isIsoDate(endDate) ? isRegularYear({ startDate, endDate }) : true;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createFinancialYearSchema.safeParse({ startDate, endDate, isIrregular });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/financial-years", parsed.data);
      setStartDate("");
      setEndDate("");
      setIsIrregular(false);
      await years.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(year: FinancialYearDto, status: "open" | "locked") {
    // Launch check, 27 October 2026: locking the current year by mistake stops all billing.
    const today = todayIso();
    const current = year.startDate <= today && today <= year.endDate;
    if (
      status === "locked" &&
      !window.confirm(
        current
          ? `Lock ${year.name}? This is the current year: no bills, purchases or entries can be saved until it is opened again.`
          : `Lock ${year.name}? Nothing dated in it can be saved or changed until it is opened again.`,
      )
    )
      return;
    setRowError(null);
    setChanging(year.id);
    try {
      await api.patch(`/financial-years/${year.id}`, { status });
      await years.reload();
    } catch (err) {
      setRowError(errorMessage(err));
    } finally {
      setChanging(null);
    }
  }

  const columns: Column<FinancialYearDto>[] = [
    { key: "name", header: "Year", render: (y) => <strong>{y.name}</strong> },
    { key: "start", header: "Starts", render: (y) => formatDate(y.startDate) },
    { key: "end", header: "Ends", render: (y) => formatDate(y.endDate) },
    {
      key: "kind",
      header: "Kind",
      render: (y) => (y.isIrregular ? <Badge kind="warn">Short or long year</Badge> : <span className="muted">Regular</span>),
    },
    {
      key: "status",
      header: "Status",
      render: (y) => <Badge kind={y.status === "open" ? "ok" : "off"}>{y.status === "open" ? "Open" : "Locked"}</Badge>,
    },
    { key: "auto", header: "Created", render: (y) => (y.createdAutomatically ? "automatically" : "by hand") },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (y: FinancialYearDto) =>
              y.status === "open" ? (
                <Button size="small" variant="danger" busy={changing === y.id} onClick={() => setStatus(y, "locked")}>
                  Lock
                </Button>
              ) : (
                <Button size="small" busy={changing === y.id} onClick={() => setStatus(y, "open")}>
                  Open
                </Button>
              ),
          } satisfies Column<FinancialYearDto>,
        ]
      : []),
  ];

  return (
    <>
      <h1>Financial years</h1>
      <p className="muted">Documents can only be dated inside an open year. The next year is created automatically three days before the current one ends.</p>
      <Alert kind="error">{rowError ?? years.error}</Alert>
      <DataTable columns={columns} rows={years.data} rowKey={(y) => y.id} loading={years.loading} empty="No financial year yet." />

      {canManage ? (
        <form onSubmit={onSubmit} noValidate className="card">
          <h2 style={{ marginTop: 0 }}>Add a financial year</h2>
          <Alert kind="error">{error}</Alert>
          <div className="form-grid">
            <TextInput id="fy-start" label="Starts on" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} required />
            <TextInput id="fy-end" label="Ends on" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} required />
            <div className="span-2">
              <CheckInput
                id="fy-irregular"
                label="Short or long year"
                description="Tick when the year is deliberately not twelve months (for example a first year that starts mid-way)."
                checked={isIrregular}
                onChange={(e) => setIsIrregular(e.target.checked)}
              />
              {previewName ? (
                <p className="muted">
                  Will be named <strong>{previewName}</strong>
                  {!regular && !isIrregular ? " — this is not a regular twelve-month year; tick the box above if that is intended." : "."}
                </p>
              ) : null}
            </div>
          </div>
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy}>
              Add year
            </Button>
            <Button onClick={suggestNext}>Suggest the next year</Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
