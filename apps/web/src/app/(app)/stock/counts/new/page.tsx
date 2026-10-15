// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CountEditor } from "@/components/stock/count-editor";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert } from "@/components/ui";

export default function NewCountPage() {
  const router = useRouter();
  const locations = useStockLocations();
  return (
    <>
      <p>
        <Link href="/stock/documents">← Stock documents</Link>
      </p>
      {locations.error ? (
        <Alert kind="error">{locations.error}</Alert>
      ) : !locations.data ? (
        <p className="muted">Loading…</p>
      ) : (
        <CountEditor doc={null} locations={locations.data} onSaved={(doc) => router.replace(`/stock/documents/${doc.id}`)} />
      )}
    </>
  );
}
