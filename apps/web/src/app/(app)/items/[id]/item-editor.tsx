// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { ItemForm } from "@/components/items/item-form";
import { ItemImage } from "@/components/items/item-image";
import { ItemPrices } from "@/components/items/item-prices";
import { ItemUnitsBarcodes } from "@/components/items/item-units-barcodes";
import { ItemVariants } from "@/components/items/item-variants";
import { StyleStockGrid } from "@/components/items/style-stock-grid";
import { AuditTable } from "@/components/audit-table";
import { ActiveBadge, Alert, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useModules } from "@/lib/modules";
import { itemKindLabel } from "@/lib/catalogue";
import type { SeasonDto } from "@/lib/styles-seasons";
import type { AttributeDto, BrandDto, CatalogueSettingsDto, ItemDto, ItemGroupNode, UnitDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "units" | "variants" | "stock" | "prices" | "history";

export function ItemEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const canSeePrices = hasPermission(user, "prices.view");
  const canManagePrices = hasPermission(user, "prices.manage");
  const canSeeHistory = hasPermission(user, "audit.view");
  const canSeeStock = hasPermission(user, "stock.view");
  // Plan 12: a style's sizes and colours, attributes and seasons only while their modules are on.
  const { isOn } = useModules();
  const variantsOn = isOn("variants");
  const seasonsOn = isOn("seasons");

  const item = useLoad(() => api.get<ItemDto>(`/items/${id}`), [id]);
  const groups = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups"));
  const brands = useLoad(() => api.get<BrandDto[]>("/catalogue/brands"));
  const units = useLoad(() => api.get<UnitDto[]>("/catalogue/units"));
  const attributes = useLoad(() => (variantsOn ? api.get<AttributeDto[]>("/catalogue/attributes").catch(() => [] as AttributeDto[]) : Promise.resolve([] as AttributeDto[])), [variantsOn]);
  const settings = useLoad(() => api.get<CatalogueSettingsDto>("/catalogue/settings"));
  const seasons = useLoad(() => (seasonsOn ? api.get<SeasonDto[]>("/seasons").catch(() => [] as SeasonDto[]) : Promise.resolve([] as SeasonDto[])), [seasonsOn]);
  const [tab, setTab] = useState<Tab>("details");
  const [saved, setSaved] = useState(false);

  if (item.error) {
    return (
      <>
        <h1>Item</h1>
        <Alert kind="error">{item.error}</Alert>
        <Link href="/items">Back to items</Link>
      </>
    );
  }
  if (!item.data || !groups.data || !brands.data || !units.data || !attributes.data) {
    return (
      <>
        <Alert kind="error">{groups.error ?? brands.error ?? units.error ?? attributes.error}</Alert>
        <p className="muted">Loading…</p>
      </>
    );
  }
  const it = item.data;

  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "Details" },
    // Units, barcodes and prices belong to variants, never to the style itself.
    ...(it.isParentStyle ? (variantsOn ? [{ key: "variants" as const, label: `Variants (${it.variantCount})` }] : []) : [{ key: "units" as const, label: "Units & barcodes" }]),
    ...(it.isParentStyle && canSeeStock && variantsOn ? [{ key: "stock" as const, label: "Stock by size and colour" }] : []),
    ...(canSeePrices && !it.isParentStyle ? [{ key: "prices" as const, label: "Prices" }] : []),
    ...(canSeeHistory ? [{ key: "history" as const, label: "History" }] : []),
  ];

  return (
    <>
      <p>
        <Link href="/items">← Items</Link>
        {it.parent ? (
          <>
            {" · "}
            <Link href={`/items/${it.parent.id}`}>Style {it.parent.code}</Link>
          </>
        ) : null}
      </p>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          <span className="mono">{it.code}</span> — {it.name}
        </h1>
        <Badge kind="neutral">{itemKindLabel(it)}</Badge>
        {it.parent ? <Badge kind="neutral">Variant</Badge> : null}
        <ActiveBadge active={it.active} />
      </div>
      <div className="tabs" role="tablist" aria-label="Item sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} className="tab" onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {saved && tab === "details" ? <Alert kind="success">Item saved.</Alert> : null}
      {it.isParentStyle && !variantsOn ? <Alert kind="info">Sizes and colours is switched off in Settings → My modules. This style and its variants are kept; the variants still sell as ordinary items.</Alert> : null}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "details" ? (
          <div className="editor-grid">
            <div>
              <ItemForm
                key={it.id + it.updatedAt}
                item={it}
                groups={groups.data}
                brands={brands.data}
                units={units.data}
                attributes={attributes.data}
                settings={settings.data}
                seasons={seasons.data ?? []}
                readOnly={!canManage}
                onSaved={(s) => {
                  item.setData(s);
                  setSaved(true);
                }}
              />
            </div>
            <div>
              <h3 style={{ marginTop: 0 }}>Picture</h3>
              <ItemImage item={it} readOnly={!canManage} onChanged={(s) => item.setData(s)} />
              {it.variantValues.length > 0 && variantsOn ? (
                <>
                  <h3>Variant values</h3>
                  <dl className="kv">
                    {it.variantValues.map((v) => (
                      <div key={v.attribute.id} style={{ display: "contents" }}>
                        <dt>{v.attribute.name}</dt>
                        <dd>
                          {v.value} <span className="muted mono">({v.shortCode})</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        {tab === "units" ? <ItemUnitsBarcodes key={it.id + it.updatedAt} item={it} units={units.data} readOnly={!canManage} onChanged={(s) => item.setData(s)} /> : null}
        {tab === "variants" && variantsOn ? <ItemVariants item={it} attributes={attributes.data} readOnly={!canManage} onChanged={() => item.reload()} /> : null}
        {tab === "stock" && variantsOn ? <StyleStockGrid styleId={it.id} /> : null}
        {tab === "prices" ? <ItemPrices item={it} canManage={canManagePrices} /> : null}
        {tab === "history" ? (
          <>
            <p className="muted">Changes to this item record. Price and barcode changes are listed under Change history as their own records.</p>
            <AuditTable path="/audit" withEntity={false} record={{ entityType: "item", entityId: it.id }} />
          </>
        ) : null}
      </div>
    </>
  );
}
