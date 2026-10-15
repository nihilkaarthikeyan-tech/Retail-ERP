// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { CouponForm, OfferForm } from "@/components/pos/offer-form";
import { type CouponDto, OFFER_KIND_LABELS, OFFER_TARGET_LABELS, type OfferDto, posRights } from "@/components/pos/pos-shared";
import { ActiveBadge, Alert, Badge, Button, DataTable, Dialog, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { showQuantity, useBusinessToday } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

function offerValue(o: OfferDto): string {
  switch (o.kind) {
    case "percent":
      return `${showQuantity(o.value)}% off`;
    case "amount":
      return `${rupees(o.value)} off`;
    case "special_price":
      return `at ${rupees(o.value)}`;
    case "free_goods":
      return `buy ${showQuantity(o.buyQuantity)} get ${showQuantity(o.freeQuantity)} free`;
  }
}

export default function OffersPage() {
  const { user } = useAuth();
  const canEdit = posRights(user).offers;
  const today = useBusinessToday();
  const data = useLoad(() => api.get<{ offers: OfferDto[]; coupons: CouponDto[] }>("/pos/offers"));
  const [editing, setEditing] = useState<OfferDto | "new" | null>(null);
  const [addingCoupon, setAddingCoupon] = useState(false);
  const offers = data.data?.offers ?? [];
  const offerCode = new Map(offers.map((o) => [o.id, o.code]));

  const offerColumns: Column<OfferDto>[] = [
    { key: "code", header: "Code", render: (o) => <span className="mono">{o.code}</span> },
    { key: "name", header: "Name", render: (o) => o.name },
    { key: "kind", header: "Offer", render: (o) => `${OFFER_KIND_LABELS[o.kind]}: ${offerValue(o)}` },
    { key: "applies", header: "On", render: (o) => (o.appliesTo === "bill" ? OFFER_TARGET_LABELS.bill : `${o.targetIds.length} ${OFFER_TARGET_LABELS[o.appliesTo].toLowerCase()}`) },
    { key: "dates", header: "Runs", render: (o) => `${formatDate(o.startDate)} – ${o.endDate ? formatDate(o.endDate) : "no end"}` },
    { key: "priority", header: "Priority", align: "right", render: (o) => o.priority },
    {
      key: "status",
      header: "Status",
      render: (o) => (
        <span className="row-actions">
          <ActiveBadge active={o.active} />
          {o.couponOnly ? <Badge kind="neutral">Coupon only</Badge> : null}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            render: (o: OfferDto) => (
              <Button size="small" onClick={() => setEditing(o)}>
                Edit
              </Button>
            ),
          } satisfies Column<OfferDto>,
        ]
      : []),
  ];

  const couponColumns: Column<CouponDto>[] = [
    { key: "code", header: "Coupon", render: (c) => <span className="mono">{c.code}</span> },
    { key: "offer", header: "Offer", render: (c) => <span className="mono">{offerCode.get(c.offerId) ?? "—"}</span> },
    { key: "dates", header: "Valid", render: (c) => `${formatDate(c.startDate)} – ${c.endDate ? formatDate(c.endDate) : "no end"}` },
    { key: "uses", header: "Used", align: "right", render: (c) => (c.maxUses != null ? `${c.usedCount} of ${c.maxUses}` : String(c.usedCount)) },
    { key: "customer", header: "For", render: (c) => (c.customerId ? "One customer" : "Anyone") },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Offers and coupons</h1>
        <span className="spacer" />
        {canEdit ? (
          <Button variant="primary" onClick={() => setEditing("new")} disabled={!today}>
            Add offer
          </Button>
        ) : null}
      </div>
      <p className="muted">The till applies the offer that saves the customer the most by itself; offers never add up and never stop a sale.</p>
      <Alert kind="error">{data.error}</Alert>
      <DataTable columns={offerColumns} rows={data.data?.offers} rowKey={(o) => o.id} loading={data.loading} empty="No offers yet." />

      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Coupons</h2>
        <span className="spacer" />
        {canEdit ? (
          <Button onClick={() => setAddingCoupon(true)} disabled={!today || !data.data}>
            Add coupon
          </Button>
        ) : null}
      </div>
      <DataTable columns={couponColumns} rows={data.data?.coupons} rowKey={(c) => c.id} loading={data.loading} empty="No coupons yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add offer" : `Edit offer: ${editing?.code ?? ""}`} onClose={() => setEditing(null)}>
        {editing !== null ? (
          <OfferForm
            key={editing === "new" ? "new" : editing.id}
            offer={editing === "new" ? null : editing}
            today={today}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void data.reload();
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={addingCoupon} title="Add coupon" onClose={() => setAddingCoupon(false)}>
        {addingCoupon ? (
          <CouponForm
            offers={offers}
            today={today}
            onCancel={() => setAddingCoupon(false)}
            onSaved={() => {
              setAddingCoupon(false);
              void data.reload();
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
