// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { VariantPicker } from "@/components/items/variant-picker";
import { ActiveBadge, Alert, DataTable, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { showMoney } from "@/lib/catalogue";
import type { AttributeDto, ItemDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

interface ItemVariantsProps {
  item: ItemDto;
  attributes: AttributeDto[];
  readOnly: boolean;
  onChanged: () => Promise<void> | void;
}

/** Variants tab of a style: create combinations and list the variants that exist. */
export function ItemVariants({ item, attributes, readOnly, onChanged }: ItemVariantsProps) {
  const variants = useLoad(() => api.get<ItemDto[]>(`/items/${item.id}/variants`), [item.id]);

  const columns: Column<ItemDto>[] = [
    {
      key: "code",
      header: "Code",
      render: (v) => (
        <Link href={`/items/${v.id}`} className="mono">
          {v.code}
        </Link>
      ),
    },
    { key: "name", header: "Name", render: (v) => v.name },
    { key: "values", header: "Values", render: (v) => v.variantValues.map((x) => `${x.attribute.name}: ${x.value}`).join(", ") },
    { key: "barcodes", header: "Barcodes", render: (v) => v.barcodes.filter((b) => b.active).length },
    { key: "mrp", header: "MRP", align: "right", render: (v) => showMoney(v.mrp) },
    { key: "active", header: "Status", render: (v) => <ActiveBadge active={v.active} /> },
  ];

  return (
    <>
      <p className="muted">
        This style varies by {item.variantAttributes.map((a) => a.name).join(", ") || "no attributes"}. Variant codes are the style code plus the
        value short codes, for example <span className="mono">{item.code}-RED-M</span>.
      </p>
      {!readOnly ? (
        <VariantPicker
          item={item}
          attributes={attributes}
          onCreated={async () => {
            await variants.reload();
            await onChanged();
          }}
        />
      ) : null}
      <h2>Existing variants</h2>
      <Alert kind="error">{variants.error}</Alert>
      <DataTable columns={columns} rows={variants.data} rowKey={(v) => v.id} loading={variants.loading} empty="No variants yet." />
    </>
  );
}
