// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PaymentForm } from "@/components/accounts/payment-form";
import { Alert } from "@/components/ui";
import { accountRights } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";

export default function NewPaymentPage() {
  const router = useRouter();
  const { user } = useAuth();
  return (
    <>
      <p>
        <Link href="/accounts/payments">← Receipts, payments and transfers</Link>
      </p>
      {user && !accountRights(user).makeTransfers ? (
        <Alert kind="error">You do not have the right to record receipts, payments or transfers.</Alert>
      ) : (
        <PaymentForm payment={null} onSaved={(p) => router.replace(`/accounts/payments/${p.id}`)} />
      )}
    </>
  );
}
