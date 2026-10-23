// Copyright (c) 2026, Rademics. All rights reserved.
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Log in and sign up (F look): the form on the left, a picture of the product
 * on the right. On a phone only the form shows.
 */
export function AuthLayout({ title, intro, children, footer }: { title: string; intro: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-main">
        <div className="auth-top">
          <Link href="/" className="lp-brand">
            <BrandMark />
            Retail ERP
          </Link>
          <ThemeToggle />
        </div>
        <div className="auth-form">
          <h1>{title}</h1>
          <p className="auth-intro">{intro}</p>
          {children}
          <p className="auth-switch">{footer}</p>
        </div>
        <p className="auth-copy">© 2026 Rademics. All rights reserved.</p>
      </main>
      <aside className="auth-side" aria-hidden="true">
        <div className="auth-side-text">
          <p className="label-mono">For Indian shops</p>
          <p className="auth-side-title">Billing, stock, GST and accounts in one place.</p>
        </div>
        <Image className="auth-shot only-light" src="/landing/dashboard-light.png" alt="" width={2160} height={1290} />
        <Image className="auth-shot only-dark" src="/landing/dashboard-dark.png" alt="" width={2160} height={1290} />
      </aside>
    </div>
  );
}
