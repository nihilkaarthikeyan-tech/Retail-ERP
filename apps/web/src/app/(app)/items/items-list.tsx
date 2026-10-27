// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { hasPermission } from "shared";
import { ExportButton } from "@/components/documents/export-button";
import { ItemSearchBox } from "@/components/items/item-search-box";
import { ActiveBadge, Alert, Button, DataTable, EmptyState, PageHeader, SelectInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useModules } from "@/lib/modules";
import { flattenGroups, itemKindLabel, showMoney } from "@/lib/catalogue";
import type { SeasonDto } from "@/lib/styles-seasons";
import type { BrandDto, ItemDto, ItemGroupNode, ItemPage } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { forFilter, pickLabel } from "@/lib/pick";

const PAGE_SIZE = 50;

interface Filters {
  search: string;
  groupId: string;
  brandId: string;
  seasonId: string;
  kind: string;
  active: string;
}

export function ItemsList() {
  const params = useSearchParams();
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  // Plan 12: the season filter and the "styles" kind only while their modules are on.
  const { isOn } = useModules();
  const seasonsOn = isOn("seasons");
  const variantsOn = isOn("variants");
  const [filters, setFilters] = useState<Filters>({ search: params.get("search") ?? "", groupId: "", brandId: "", seasonId: params.get("seasonId") ?? "", kind: "", active: "true" });
  const [page, setPage] = useState(1);

  const groups = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups"));
  const brands = useLoad(() => api.get<BrandDto[]>("/catalogue/brands"));
  const seasons = useLoad(() => (seasonsOn ? api.get<SeasonDto[]>("/seasons").catch(() => [] as SeasonDto[]) : Promise.resolve([] as SeasonDto[])), [seasonsOn]);
  const items = useLoad(
    () => api.get<ItemPage>(`/items${query({ ...filters, page, pageSize: PAGE_SIZE })}`),
    [filters.search, filters.groupId, filters.brandId, filters.seasonId, filters.kind, filters.active, page],
  );

  function setFilter(key: keyof Filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const columns: Column<ItemDto>[] = [
    {
      key: "code",
      header: "Code",
      render: (i) => (
        <Link href={`/items/${i.id}`} className="mono">
          {i.code}
        </Link>
      ),
    },
    { key: "name", header: "Name", render: (i) => i.name },
    { key: "group", header: "Group", render: (i) => i.itemGroup.name },
    { key: "brand", header: "Brand", render: (i) => i.brand?.name ?? "—" },
    { key: "kind", header: "Kind", render: (i) => itemKindLabel(i) },
    { key: "unit", header: "Basic unit", render: (i) => i.baseUnit.code },
    { key: "mrp", header: "MRP", align: "right", render: (i) => showMoney(i.mrp) },
    ...(variantsOn ? [{ key: "variants", header: "Variants", align: "right", render: (i) => (i.isParentStyle ? i.variantCount : "—") } satisfies Column<ItemDto>] : []),
    { key: "active", header: "Status", render: (i) => <ActiveBadge active={i.active} /> },
  ];

  const total = items.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groupOptions = groups.data ? flattenGroups(groups.data) : [];

  return (
    <>
      <PageHeader title="Items">
        <ExportButton kind="items" />
        {canManage ? (
          <Link href="/items/new" className="btn btn-primary">
            Add item
          </Link>
        ) : null}
      </PageHeader>
      <ItemSearchBox key={filters.search} initial={filters.search} onSearch={(text) => setFilter("search", text)} />
      <div className="filter-row">
        <SelectInput id="items-group" label="Group" value={filters.groupId} onChange={(e) => setFilter("groupId", e.target.value)}>
          <option value="">All groups</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="items-brand" label="Brand" value={filters.brandId} onChange={(e) => setFilter("brandId", e.target.value)}>
          <option value="">All brands</option>
          {forFilter(brands.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {pickLabel(b.name, b)}
            </option>
          ))}
        </SelectInput>
        {seasonsOn && seasons.data?.length ? (
          <SelectInput id="items-season" label="Season" value={filters.seasonId} onChange={(e) => setFilter("seasonId", e.target.value)}>
            <option value="">All seasons</option>
            {seasons.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        ) : null}
        <SelectInput id="items-kind" label="Kind" value={filters.kind} onChange={(e) => setFilter("kind", e.target.value)}>
          <option value="">All kinds</option>
          <option value="stock">Stock items</option>
          <option value="service">Services</option>
          {variantsOn ? <option value="style">Styles</option> : null}
        </SelectInput>
        <SelectInput id="items-active" label="Status" value={filters.active} onChange={(e) => setFilter("active", e.target.value)}>
          <option value="">All</option>
          <option value="true">Active</option>
          <option value="false">Switched off</option>
        </SelectInput>
      </div>
      <Alert kind="error">{items.error ?? groups.error ?? brands.error}</Alert>
      <DataTable
        columns={columns}
        rows={items.data?.rows}
        rowKey={(i) => i.id}
        loading={items.loading}
        empty={
          filters.search ? (
            `No items match "${filters.search}".`
          ) : (
            <EmptyState title="No items yet" text="Add your first item, or bring your whole list from Excel with prices and opening stock.">
              {canManage ? (
                <Link href="/items/new" className="btn btn-primary">
                  Add item
                </Link>
              ) : null}
              {hasPermission(user, "import.masters") ? (
                <Link href="/imports" className="btn">
                  Import from Excel
                </Link>
              ) : null}
            </EmptyState>
          )
        }
      />
      <div className="toolbar">
        <span className="muted">
          {total} item{total === 1 ? "" : "s"}
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
