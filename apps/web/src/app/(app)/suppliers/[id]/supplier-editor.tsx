// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { businessDate, hasPermission } from "shared";
import { PartyBalance } from "@/components/accounts/party-balance";
import { AuditTable } from "@/components/audit-table";
import { PartyAddresses } from "@/components/parties/party-addresses";
import { PartyContacts } from "@/components/parties/party-contacts";
import { HoldBadge, PartyStatusBadge } from "@/components/parties/status-badge";
import { SupplierForm } from "@/components/parties/supplier-form";
import { SupplierHold } from "@/components/parties/supplier-hold";
import { Alert, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { effectiveHold } from "@/lib/parties";
import type { PartyGroupNode, PaymentTermsDto, PriceListDto, SupplierDetailDto, SupplierDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "addresses" | "contacts" | "hold" | "history";

export function SupplierEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = hasPermission(user, "suppliers.manage");
  const canHold = hasPermission(user, "suppliers.hold");
  const canSeePrices = hasPermission(user, "prices.view");
  const canSeeTerms = hasPermission(user, "customers.view");
  const canSeeHistory = hasPermission(user, "audit.view");

  const supplier = useLoad(() => api.get<SupplierDetailDto>(`/suppliers/${id}`), [id]);
  const groups = useLoad(() => api.get<PartyGroupNode[]>("/supplier-groups"));
  const terms = useLoad<PaymentTermsDto[] | null>(() => (canSeeTerms ? api.get<PaymentTermsDto[]>("/payment-terms") : Promise.resolve(null)), [canSeeTerms]);
  const lists = useLoad<PriceListDto[] | null>(() => (canSeePrices ? api.get<PriceListDto[]>("/price-lists") : Promise.resolve(null)), [canSeePrices]);
  const [tab, setTab] = useState<Tab>("details");
  const [saved, setSaved] = useState(false);

  if (supplier.error) {
    return (
      <>
        <h1>Supplier</h1>
        <Alert kind="error">{supplier.error}</Alert>
        <Link href="/suppliers">Back to suppliers</Link>
      </>
    );
  }
  if (!supplier.data || !groups.data || terms.loading || lists.loading) {
    return (
      <>
        <Alert kind="error">{groups.error ?? terms.error ?? lists.error}</Alert>
        <p className="muted">Loading…</p>
      </>
    );
  }
  const s = supplier.data;
  const merge = (next: SupplierDto) => supplier.setData({ ...next, addresses: s.addresses, contacts: s.contacts });

  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "addresses", label: `Addresses (${s.addresses.filter((a) => a.active).length})` },
    { key: "contacts", label: `Contacts (${s.contacts.filter((c) => c.active).length})` },
    { key: "hold", label: "Hold" },
    ...(canSeeHistory ? [{ key: "history" as const, label: "History" }] : []),
  ];

  return (
    <>
      <p>
        <Link href="/suppliers">← Suppliers</Link>
        {s.linkedCustomers.map((c) => (
          <span key={c.id}>
            {" · "}
            <Link href={`/customers/${c.id}`}>Customer {c.code}</Link>
          </span>
        ))}
      </p>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          <span className="mono">{s.code}</span> — {s.name}
        </h1>
        {s.isTransporter ? <Badge kind="neutral">Transporter</Badge> : null}
        <PartyStatusBadge status={s.status} />
        <HoldBadge hold={effectiveHold(s, businessDate())} until={s.holdUntil} />
        <span className="spacer" />
        <PartyBalance partyType="supplier" partyId={s.id} />
      </div>
      <div className="tabs" role="tablist" aria-label="Supplier sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} className="tab" onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {saved && tab === "details" ? <Alert kind="success">Supplier saved.</Alert> : null}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "details" ? (
          <SupplierForm
            key={s.id + s.updatedAt}
            supplier={s}
            groups={groups.data}
            priceLists={lists.data}
            terms={terms.data}
            settings={null}
            readOnly={!canManage}
            onSaved={(next) => {
              merge(next);
              setSaved(true);
            }}
          />
        ) : null}
        {tab === "addresses" ? <PartyAddresses basePath={`/suppliers/${s.id}`} addresses={s.addresses} readOnly={!canManage} onChanged={() => supplier.reload()} /> : null}
        {tab === "contacts" ? <PartyContacts basePath={`/suppliers/${s.id}`} contacts={s.contacts} readOnly={!canManage} onChanged={() => supplier.reload()} /> : null}
        {tab === "hold" ? <SupplierHold key={s.id + s.updatedAt} supplier={s} canEdit={canHold} onSaved={merge} /> : null}
        {tab === "history" ? (
          <>
            <p className="muted">Changes to this supplier, including holds and status with their reasons. Addresses and contacts are listed under Change history as their own records.</p>
            <AuditTable path="/audit" withEntity={false} record={{ entityType: "supplier", entityId: s.id }} />
          </>
        ) : null}
      </div>
    </>
  );
}
