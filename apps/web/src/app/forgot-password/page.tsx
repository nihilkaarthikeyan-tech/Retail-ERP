// Copyright (c) 2026, Rademics. All rights reserved.
import Link from "next/link";
import { AuthLayout } from "@/components/auth-layout";
import { ForgotPasswordForm } from "@/components/email-link-forms";

/** "Forgot password?" (owner, 26 October 2026): a link to choose a new password, sent by email. */
export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Forgot your password?"
      intro="Type the email you log in with. We will send you a link to choose a new password."
      footer={
        <>
          Remembered it? <Link href="/login">Log in</Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
