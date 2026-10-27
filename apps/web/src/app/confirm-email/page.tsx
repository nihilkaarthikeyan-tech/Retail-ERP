// Copyright (c) 2026, Rademics. All rights reserved.
import Link from "next/link";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { ConfirmEmail } from "@/components/email-link-forms";

/** Opened from the "Confirm your email" email sent at sign-up. */
export default function ConfirmEmailPage() {
  return (
    <AuthLayout
      title="Confirm your email"
      intro="Confirming the email you log in with lets you get back in if you ever forget your password."
      footer={
        <>
          Need help? <Link href="/#contact">Talk to us</Link>
        </>
      }
    >
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <ConfirmEmail />
      </Suspense>
    </AuthLayout>
  );
}
