// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ItemForm } from "@/components/items/item-form";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import type { AttributeDto, BrandDto, CatalogueSettingsDto, ItemGroupNode, UnitDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function NewItemPage() {
  const router = useRouter();
  const groups = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups"));
  const brands = useLoad(() => api.get<BrandDto[]>("/catalogue/brands"));
  const units = useLoad(() => api.get<UnitDto[]>("/catalogue/units"));
  const attributes = useLoad(() => api.get<AttributeDto[]>("/catalogue/attributes"));
  const settings = useLoad(() => api.get<CatalogueSettingsDto>("/catalogue/settings"));

  return (
    <>
      <p>
        <Link href="/items">← Items</Link>
      </p>
      <h1>Add item</h1>
      <Alert kind="error">{groups.error ?? brands.error ?? units.error ?? attributes.error}</Alert>
      {groups.data && brands.data && units.data && attributes.data && !settings.loading ? (
        <ItemForm item={null} groups={groups.data} brands={brands.data} units={units.data} attributes={attributes.data} settings={settings.data} onSaved={(item) => router.replace(`/items/${item.id}`)} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </>
  );
}
