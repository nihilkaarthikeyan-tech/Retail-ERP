// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission } from "shared";
import { SupplierForm } from "@/components/parties/supplier-form";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PartyGroupNode, PartySettingsDto, PaymentTermsDto, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function NewSupplierPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canSeePrices = hasPermission(user, "prices.view");
  // The terms list and party settings sit behind customers.view (see the API controller).
  const canSeeTerms = hasPermission(user, "customers.view");
  const groups = useLoad(() => api.get<PartyGroupNode[]>("/supplier-groups"));
  const terms = useLoad<PaymentTermsDto[] | null>(() => (canSeeTerms ? api.get<PaymentTermsDto[]>("/payment-terms") : Promise.resolve(null)), [canSeeTerms]);
  const settings = useLoad<PartySettingsDto | null>(() => (canSeeTerms ? api.get<PartySettingsDto>("/party-settings") : Promise.resolve(null)), [canSeeTerms]);
  const lists = useLoad<PriceListDto[] | null>(() => (canSeePrices ? api.get<PriceListDto[]>("/price-lists") : Promise.resolve(null)), [canSeePrices]);

  return (
    <>
      <p>
        <Link href="/suppliers">← Suppliers</Link>
      </p>
      <h1>Add supplier</h1>
      <p className="muted">Addresses and contact people are added after the supplier is saved. The code (SUP-000001…) is given automatically.</p>
      <Alert kind="error">{groups.error ?? terms.error ?? settings.error ?? lists.error}</Alert>
      {groups.data && !terms.loading && !settings.loading && !lists.loading ? (
        <SupplierForm supplier={null} groups={groups.data} priceLists={lists.data} terms={terms.data} settings={settings.data} onSaved={(s) => router.replace(`/suppliers/${s.id}`)} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </>
  );
}
