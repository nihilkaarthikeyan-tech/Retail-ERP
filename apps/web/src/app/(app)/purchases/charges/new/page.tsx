// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChargesEditor } from "@/components/purchasing/charges-editor";

export default function NewChargesPage() {
  const router = useRouter();
  return (
    <>
      <p>
        <Link href="/purchases/charges">← Freight and charges</Link>
      </p>
      <ChargesEditor onSaved={(c) => router.replace(`/purchases/charges/${c.id}`)} />
    </>
  );
}
