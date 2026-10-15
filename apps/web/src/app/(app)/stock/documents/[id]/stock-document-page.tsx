// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { AuditTable } from "@/components/audit-table";
import { CountEditor } from "@/components/stock/count-editor";
import { StockDocumentEditor } from "@/components/stock/stock-document-editor";
import { StockDocumentView } from "@/components/stock/stock-document-view";
import { useCompanyStores, useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { canDraftKind, canFinaliseKind } from "@/lib/stock";
import type { StockDocumentDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "history";

export function StockDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canSeeHistory = hasPermission(user, "audit.view");
  const doc = useLoad(() => api.get<StockDocumentDto>(`/stock/documents/${id}`), [id]);
  const locations = useStockLocations();
  const stores = useCompanyStores(locations.data);
  const [tab, setTab] = useState<Tab>("details");

  if (doc.error) {
    return (
      <>
        <h1>Stock document</h1>
        <Alert kind="error">{doc.error}</Alert>
        <Link href="/stock/documents">Back to stock documents</Link>
      </>
    );
  }
  if (!doc.data || !locations.data || stores.loading) {
    return (
      <>
        <Alert kind="error">{locations.error}</Alert>
        <p className="muted">Loading…</p>
      </>
    );
  }
  const d = doc.data;
  const draft = d.status === "draft";
  const editableKind = d.kind === "stock_in" || d.kind === "stock_out" || d.kind === "move" || d.kind === "transfer_send" ? d.kind : null;
  const useEditor = draft && (canDraftKind(user, d.kind) || canFinaliseKind(user, d.kind));

  return (
    <>
      <p>
        <Link href="/stock/documents">← Stock documents</Link>
      </p>
      {canSeeHistory ? (
        <div className="tabs" role="tablist" aria-label="Document sections">
          {(["details", "history"] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="tab" onClick={() => setTab(t)}>
              {t === "details" ? "Details" : "History"}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={canSeeHistory ? `tab-${tab}` : undefined}>
        {tab === "details" ? (
          useEditor && d.kind === "count" ? (
            <CountEditor doc={d} locations={locations.data} onSaved={doc.setData} />
          ) : useEditor && editableKind ? (
            <StockDocumentEditor kind={editableKind} doc={d} locations={locations.data} receivingStores={stores.stores} onSaved={doc.setData} />
          ) : (
            <StockDocumentView doc={d} locations={locations.data} stores={stores.stores} onChanged={doc.setData} />
          )
        ) : (
          <AuditTable path="/audit" withEntity={false} record={{ entityType: "stock_document", entityId: d.id }} />
        )}
      </div>
    </>
  );
}
