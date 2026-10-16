// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { posRights } from "@/components/pos/pos-shared";
import { TillForm } from "@/components/pos/till-form";
import { Alert } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

export default function NewTillPage() {
  const router = useRouter();
  const { user } = useAuth();
  const rights = posRights(user);

  return (
    <>
      <p>
        <Link href="/pos/tills">← Tills</Link>
      </p>
      <h1>New till</h1>
      {user && !rights.setup ? (
        <Alert kind="error">You do not have the right to set up tills.</Alert>
      ) : (
        <TillForm till={null} canEdit onSaved={(t) => router.replace(`/pos/tills/${t.id}`)} />
      )}
    </>
  );
}
