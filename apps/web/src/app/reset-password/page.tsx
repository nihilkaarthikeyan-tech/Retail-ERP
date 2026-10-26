// Copyright (c) 2026, Rademics. All rights reserved.
import Link from "next/link";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { ResetPasswordForm } from "@/components/email-link-forms";

/** Opened from the "Choose a new password" email. */
export default function ResetPasswordPage() {
  return (
    <AuthLayout
      title="Choose a new password"
      intro="Pick a password you do not use anywhere else."
      footer={
        <>
          Link not working? <Link href="/forgot-password">Ask for a new one</Link>
        </>
      }
    >
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
