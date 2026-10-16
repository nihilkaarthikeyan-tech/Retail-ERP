// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { JOURNAL_KINDS, type JournalKind } from "shared";
import { JournalForm } from "@/components/accounts/journal-form";
import { Alert } from "@/components/ui";
import { accountRights } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";

export function NewJournal() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const requested = params.get("kind") ?? "";
  const kind = (JOURNAL_KINDS as readonly string[]).includes(requested) ? (requested as JournalKind) : undefined;

  return (
    <>
      <p>
        <Link href="/accounts/journals">← Journals</Link>
      </p>
      {user && !accountRights(user).makeJournals ? (
        <Alert kind="error">You do not have the right to make journals.</Alert>
      ) : (
        <JournalForm journal={null} presetKind={kind} onSaved={(j) => router.replace(`/accounts/journals/${j.id}`)} />
      )}
    </>
  );
}
