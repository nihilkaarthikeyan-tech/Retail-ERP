// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { businessDate, hasPermission, PARTY_STATUSES } from "shared";
import { ExportButton } from "@/components/documents/export-button";
import { HoldBadge, PartyStatusBadge } from "@/components/parties/status-badge";
import { Alert, Badge, Button, CheckInput, DataTable, SelectInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flattenGroups } from "@/lib/catalogue";
import { effectiveHold, STATUS_LABELS } from "@/lib/parties";
import type { PartyGroupNode, SupplierDto, SupplierPage } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

interface Filters {
  search: string;
  groupId: string;
  status: string;
  transporters: string;
}

export function SuppliersList() {
  const params = useSearchParams();
  const { user } = useAuth();
  const canManage = hasPermission(user, "suppliers.manage");
  const [filters, setFilters] = useState<Filters>({ search: params.get("search") ?? "", groupId: "", status: "", transporters: "" });
  const [typed, setTyped] = useState(filters.search);
  const [page, setPage] = useState(1);
  const today = businessDate();

  const groups = useLoad(() => api.get<PartyGroupNode[]>("/supplier-groups"));
  const suppliers = useLoad(
    () => api.get<SupplierPage>(`/suppliers${query({ ...filters, page, pageSize: PAGE_SIZE })}`),
    [filters.search, filters.groupId, filters.status, filters.transporters, page],
  );

  function setFilter(key: keyof Filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setFilter("search", typed.trim());
  }

  const columns: Column<SupplierDto>[] = [
    {
      key: "code",
      header: "Code",
      render: (s) => (
        <Link href={`/suppliers/${s.id}`} className="mono">
          {s.code}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <>
          {s.name} {s.isTransporter ? <Badge kind="neutral">Transporter</Badge> : null}
        </>
      ),
    },
    { key: "mobile", header: "Mobile", render: (s) => (s.mobile ? <span className="mono">{s.mobile}</span> : "—") },
    { key: "group", header: "Group", render: (s) => s.supplierGroup.name },
    { key: "gstin", header: "GSTIN / PAN", render: (s) => (s.gstin ?? s.pan ? <span className="mono">{s.gstin ?? s.pan}</span> : "—") },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <span className="row-actions">
          <PartyStatusBadge status={s.status} />
          <HoldBadge hold={effectiveHold(s, today)} until={s.holdUntil} />
        </span>
      ),
    },
  ];

  const total = suppliers.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groupOptions = groups.data ? flattenGroups(groups.data) : [];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Suppliers</h1>
        <span className="spacer" />
        <ExportButton kind="suppliers" />
        {canManage ? (
          <Link href="/suppliers/new" className="btn btn-primary">
            Add supplier
          </Link>
        ) : null}
      </div>
      <form onSubmit={onSearch} className="scan-box" role="search">
        <label htmlFor="suppliers-search" className="sr-only">
          Search suppliers
        </label>
        <input id="suppliers-search" className="input" type="search" value={typed} placeholder="Name, mobile, code or GSTIN" autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      <div className="filter-row">
        <SelectInput id="suppliers-group" label="Group" value={filters.groupId} onChange={(e) => setFilter("groupId", e.target.value)}>
          <option value="">All groups</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="suppliers-status" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          {PARTY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </SelectInput>
        <CheckInput id="suppliers-transporters" label="Transporters only" checked={filters.transporters === "true"} onChange={(e) => setFilter("transporters", e.target.checked ? "true" : "")} />
      </div>
      <Alert kind="error">{suppliers.error ?? groups.error}</Alert>
      <DataTable columns={columns} rows={suppliers.data?.rows} rowKey={(s) => s.id} loading={suppliers.loading} empty={filters.search ? `No suppliers match "${filters.search}".` : "No suppliers yet."} />
      <div className="toolbar">
        <span className="muted">
          {total} supplier{total === 1 ? "" : "s"}
          {pageCount > 1 ? `, page ${page} of ${pageCount}` : ""}
        </span>
        <span className="spacer" />
        {pageCount > 1 ? (
          <>
            <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="small" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </>
        ) : null}
      </div>
    </>
  );
}
