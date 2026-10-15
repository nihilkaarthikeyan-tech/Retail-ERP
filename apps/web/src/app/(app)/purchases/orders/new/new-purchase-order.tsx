// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrdersEditor } from "@/components/purchasing/orders-editor";
import { Alert } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { purchaseRights } from "@/lib/purchasing";

export function NewPurchaseOrder() {
  const router = useRouter();
  const { user } = useAuth();
  const rights = purchaseRights(user);

  return (
    <>
      <p>
        <Link href="/purchases/orders">← Purchase orders</Link>
      </p>
      {user && !rights.order ? (
        <Alert kind="error">You do not have the right to make purchase orders.</Alert>
      ) : (
        <OrdersEditor order={null} onSaved={(order) => router.replace(`/purchases/orders/${order.id}`)} />
      )}
    </>
  );
}
