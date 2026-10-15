// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BillKindChooser } from "@/components/purchasing/bills-kind-chooser";
import { BillEditor } from "@/components/purchasing/bills-editor";
import type { NewBillKind } from "@/components/purchasing/bills-lines";
import { Alert } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { purchaseRights } from "@/lib/purchasing";

const KINDS: NewBillKind[] = ["against_receipt", "receives_goods", "services"];

export function NewSupplierBill() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const requested = params.get("kind") ?? "";
  const kind = (KINDS as string[]).includes(requested) ? (requested as NewBillKind) : null;

  return (
    <>
      <p>
        <Link href="/purchases/bills">← Supplier bills</Link>
      </p>
      {user && !purchaseRights(user).bill ? (
        <Alert kind="error">You do not have the right to record supplier bills.</Alert>
      ) : kind ? (
        <>
          <p>
            <Link href="/purchases/bills/new">Choose a different kind</Link>
          </p>
          <BillEditor kind={kind} bill={null} onSaved={(bill) => router.replace(`/purchases/bills/${bill.id}`)} />
        </>
      ) : (
        <BillKindChooser onChoose={(k) => router.push(`/purchases/bills/new?kind=${k}`)} />
      )}
    </>
  );
}
