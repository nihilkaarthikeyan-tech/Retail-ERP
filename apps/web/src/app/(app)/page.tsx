// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useSyncExternalStore } from "react";
import { hasPermission } from "shared";
import { SystemStatus } from "@/components/system-status";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CompanyDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const noop = () => () => {};

/** Time-of-day greeting from the browser clock; a neutral word while prerendering. */
function useGreeting(): string {
  return useSyncExternalStore(
    noop,
    () => {
      const hour = new Date().getHours();
      return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    },
    () => "Welcome",
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const canSeeCompany = hasPermission(user, "company.view");
  const company = useLoad<CompanyDto | null>(
    () => (canSeeCompany ? api.get<CompanyDto>("/company") : Promise.resolve(null)),
    [canSeeCompany],
  );

  const greeting = useGreeting();

  return (
    <>
      <h1>{user ? `${greeting}, ${user.firstName}` : greeting}</h1>
      {canSeeCompany ? (
        <p className="muted">
          {company.loading
            ? "Loading company…"
            : company.data
              ? (company.data.tradeName ?? company.data.legalName)
              : (company.error ?? "")}
        </p>
      ) : null}

      <h2>Your stores</h2>
      {user?.allStores ? (
        <p>You can work in every store.</p>
      ) : user && user.stores.length > 0 ? (
        <ul>
          {user.stores.map((s) => (
            <li key={s.id}>
              {s.code} — {s.name}
              {s.isDefault ? <span className="muted"> (default)</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No store has been assigned to you yet.</p>
      )}

      <h2>System status</h2>
      <SystemStatus />
    </>
  );
}
