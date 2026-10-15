// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { STOCK_DOC_KINDS } from "shared";
import { StockDocumentEditor } from "@/components/stock/stock-document-editor";
import type { EditableKind } from "@/components/stock/stock-line-grid";
import { useCompanyStores, useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert } from "@/components/ui";

export function NewStockDocument() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("kind") ?? "";
  const kind = (STOCK_DOC_KINDS as readonly string[]).includes(requested) ? (requested as EditableKind) : null;
  const locations = useStockLocations();
  const stores = useCompanyStores(locations.data);

  return (
    <>
      <p>
        <Link href="/stock/documents">← Stock documents</Link>
      </p>
      {!kind ? (
        <Alert kind="error">Choose what kind of document to create from the Stock documents page.</Alert>
      ) : locations.error ? (
        <Alert kind="error">{locations.error}</Alert>
      ) : !locations.data || stores.loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <StockDocumentEditor kind={kind} doc={null} locations={locations.data} receivingStores={stores.stores} onSaved={(doc) => router.replace(`/stock/documents/${doc.id}`)} />
      )}
    </>
  );
}
