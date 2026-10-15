// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission } from "shared";
import { CustomerForm } from "@/components/parties/customer-form";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PartyGroupNode, PartySettingsDto, PaymentTermsDto, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function NewCustomerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canSeePrices = hasPermission(user, "prices.view");
  const groups = useLoad(() => api.get<PartyGroupNode[]>("/customer-groups"));
  const terms = useLoad(() => api.get<PaymentTermsDto[]>("/payment-terms"));
  const settings = useLoad(() => api.get<PartySettingsDto>("/party-settings"));
  const lists = useLoad<PriceListDto[] | null>(() => (canSeePrices ? api.get<PriceListDto[]>("/price-lists") : Promise.resolve(null)), [canSeePrices]);

  return (
    <>
      <p>
        <Link href="/customers">← Customers</Link>
      </p>
      <h1>Add customer</h1>
      <p className="muted">Addresses and contact people are added after the customer is saved. The code (CUS-000001…) is given automatically.</p>
      <Alert kind="error">{groups.error ?? terms.error ?? settings.error ?? lists.error}</Alert>
      {groups.data && terms.data && !settings.loading && !lists.loading ? (
        <CustomerForm customer={null} groups={groups.data} priceLists={lists.data} terms={terms.data} settings={settings.data} onSaved={(c) => router.replace(`/customers/${c.id}`)} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </>
  );
}
