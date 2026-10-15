// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { AuditTable } from "@/components/audit-table";
import { CustomerCredit } from "@/components/parties/customer-credit";
import { CustomerForm } from "@/components/parties/customer-form";
import { PartyAddresses } from "@/components/parties/party-addresses";
import { PartyContacts } from "@/components/parties/party-contacts";
import { PartyStatusBadge } from "@/components/parties/status-badge";
import { Alert, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CustomerDetailDto, CustomerDto, PartyGroupNode, PaymentTermsDto, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "addresses" | "contacts" | "credit" | "history";

export function CustomerEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = hasPermission(user, "customers.manage");
  const canCredit = hasPermission(user, "customers.credit");
  const canSeePrices = hasPermission(user, "prices.view");
  const canSeeHistory = hasPermission(user, "audit.view");

  const customer = useLoad(() => api.get<CustomerDetailDto>(`/customers/${id}`), [id]);
  const groups = useLoad(() => api.get<PartyGroupNode[]>("/customer-groups"));
  const terms = useLoad(() => api.get<PaymentTermsDto[]>("/payment-terms"));
  const lists = useLoad<PriceListDto[] | null>(() => (canSeePrices ? api.get<PriceListDto[]>("/price-lists") : Promise.resolve(null)), [canSeePrices]);
  const [tab, setTab] = useState<Tab>("details");
  const [saved, setSaved] = useState(false);

  if (customer.error) {
    return (
      <>
        <h1>Customer</h1>
        <Alert kind="error">{customer.error}</Alert>
        <Link href="/customers">Back to customers</Link>
      </>
    );
  }
  if (!customer.data || !groups.data || !terms.data || lists.loading) {
    return (
      <>
        <Alert kind="error">{groups.error ?? terms.error ?? lists.error}</Alert>
        <p className="muted">Loading…</p>
      </>
    );
  }
  const c = customer.data;

  /** A saved form or credit change replaces the record but keeps the loaded addresses and contacts. */
  const merge = (next: CustomerDto) => customer.setData({ ...next, addresses: c.addresses, contacts: c.contacts });

  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "addresses", label: `Addresses (${c.addresses.filter((a) => a.active).length})` },
    { key: "contacts", label: `Contacts (${c.contacts.filter((x) => x.active).length})` },
    { key: "credit", label: "Credit" },
    ...(canSeeHistory ? [{ key: "history" as const, label: "History" }] : []),
  ];

  return (
    <>
      <p>
        <Link href="/customers">← Customers</Link>
        {c.linkedSupplier ? (
          <>
            {" · "}
            <Link href={`/suppliers/${c.linkedSupplier.id}`}>Supplier {c.linkedSupplier.code}</Link>
          </>
        ) : null}
      </p>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          <span className="mono">{c.code}</span> — {c.name}
        </h1>
        {c.isWalkIn ? <Badge kind="neutral">Walk-in</Badge> : null}
        <Badge kind="neutral">{c.isBusiness ? "Business" : "Person"}</Badge>
        <PartyStatusBadge status={c.status} />
      </div>
      <div className="tabs" role="tablist" aria-label="Customer sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} className="tab" onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {saved && tab === "details" ? <Alert kind="success">Customer saved.</Alert> : null}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "details" ? (
          <CustomerForm
            key={c.id + c.updatedAt}
            customer={c}
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
        {tab === "addresses" ? <PartyAddresses basePath={`/customers/${c.id}`} addresses={c.addresses} readOnly={!canManage || c.isWalkIn} withGstin={!c.isWalkIn} onChanged={() => customer.reload()} /> : null}
        {tab === "contacts" ? <PartyContacts basePath={`/customers/${c.id}`} contacts={c.contacts} readOnly={!canManage} onChanged={() => customer.reload()} /> : null}
        {tab === "credit" ? <CustomerCredit key={c.id + c.updatedAt} customer={c} canEdit={canCredit} onSaved={merge} /> : null}
        {tab === "history" ? (
          <>
            <p className="muted">Changes to this customer, including credit limits and status with their reasons. Addresses and contacts are listed under Change history as their own records.</p>
            <AuditTable path="/audit" withEntity={false} record={{ entityType: "customer", entityId: c.id }} />
          </>
        ) : null}
      </div>
    </>
  );
}
