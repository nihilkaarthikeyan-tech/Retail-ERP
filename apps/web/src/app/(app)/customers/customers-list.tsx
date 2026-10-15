// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { hasPermission, PARTY_STATUSES } from "shared";
import { QuickAddDialog } from "@/components/parties/quick-add-dialog";
import { PartyStatusBadge } from "@/components/parties/status-badge";
import { Alert, Badge, Button, DataTable, SelectInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flattenGroups, showMoney } from "@/lib/catalogue";
import { STATUS_LABELS } from "@/lib/parties";
import type { CustomerDto, CustomerPage, PartyGroupNode } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

interface Filters {
  search: string;
  groupId: string;
  status: string;
}

export function CustomersList() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const canManage = hasPermission(user, "customers.manage");
  const canQuickAdd = hasPermission(user, "customers.quick_add");
  const [filters, setFilters] = useState<Filters>({ search: params.get("search") ?? "", groupId: "", status: "" });
  const [typed, setTyped] = useState(filters.search);
  const [page, setPage] = useState(1);
  const [quickAdd, setQuickAdd] = useState(false);

  const groups = useLoad(() => api.get<PartyGroupNode[]>("/customer-groups"));
  const customers = useLoad(() => api.get<CustomerPage>(`/customers${query({ ...filters, page, pageSize: PAGE_SIZE })}`), [filters.search, filters.groupId, filters.status, page]);

  function setFilter(key: keyof Filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setFilter("search", typed.trim());
  }

  const columns: Column<CustomerDto>[] = [
    {
      key: "code",
      header: "Code",
      render: (c) => (
        <Link href={`/customers/${c.id}`} className="mono">
          {c.code}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (c) => (
        <>
          {c.name} {c.isWalkIn ? <Badge kind="neutral">Walk-in</Badge> : null}
          {c.isBusiness ? <Badge kind="neutral">Business</Badge> : null}
        </>
      ),
    },
    { key: "mobile", header: "Mobile", render: (c) => (c.mobile ? <span className="mono">{c.mobile}</span> : "—") },
    { key: "group", header: "Group", render: (c) => c.customerGroup.name },
    { key: "gstin", header: "GSTIN", render: (c) => (c.gstin ? <span className="mono">{c.gstin}</span> : "—") },
    { key: "credit", header: "Credit limit", align: "right", render: (c) => (c.isWalkIn ? "—" : showMoney(c.creditLimit)) },
    { key: "status", header: "Status", render: (c) => <PartyStatusBadge status={c.status} /> },
  ];

  const total = customers.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groupOptions = groups.data ? flattenGroups(groups.data) : [];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Customers</h1>
        <span className="spacer" />
        {canQuickAdd ? <Button onClick={() => setQuickAdd(true)}>Quick add</Button> : null}
        {canManage ? (
          <Link href="/customers/new" className="btn btn-primary">
            Add customer
          </Link>
        ) : null}
      </div>
      <form onSubmit={onSearch} className="scan-box" role="search">
        <label htmlFor="customers-search" className="sr-only">
          Search customers
        </label>
        <input id="customers-search" className="input" type="search" value={typed} placeholder="Name, mobile, code or GSTIN" autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      <div className="filter-row">
        <SelectInput id="customers-group" label="Group" value={filters.groupId} onChange={(e) => setFilter("groupId", e.target.value)}>
          <option value="">All groups</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="customers-status" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          {PARTY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </SelectInput>
      </div>
      <Alert kind="error">{customers.error ?? groups.error}</Alert>
      <DataTable columns={columns} rows={customers.data?.rows} rowKey={(c) => c.id} loading={customers.loading} empty={filters.search ? `No customers match "${filters.search}".` : "No customers yet."} />
      <div className="toolbar">
        <span className="muted">
          {total} customer{total === 1 ? "" : "s"}
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
      <QuickAddDialog open={quickAdd} onClose={() => setQuickAdd(false)} onSaved={(c) => router.push(`/customers/${c.id}`)} />
    </>
  );
}
