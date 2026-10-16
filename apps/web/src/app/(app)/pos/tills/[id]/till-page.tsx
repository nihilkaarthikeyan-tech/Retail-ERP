// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use } from "react";
import { posRights, type TillDto } from "@/components/pos/pos-shared";
import { HelperPairingBox, TillDeviceBox } from "@/components/pos/till-device-box";
import { TillForm } from "@/components/pos/till-form";
import { ActiveBadge, Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLoad } from "@/lib/use-load";

export function TillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const rights = posRights(user);
  const till = useLoad(() => api.get<TillDto>(`/pos/tills/${id}`), [id]);

  return (
    <>
      <p>
        <Link href="/pos/tills">← Tills</Link>
      </p>
      <Alert kind="error">{till.error}</Alert>
      {till.data ? (
        <>
          <div className="toolbar">
            <h1 style={{ margin: 0 }}>
              Till <span className="mono">{till.data.code}</span> — {till.data.name}
            </h1>
            <ActiveBadge active={till.data.active} />
          </div>
          <TillForm key={till.data.id} till={till.data} canEdit={rights.setup} onSaved={till.setData} />
          <TillDeviceBox till={till.data} canSetup={rights.setup} onRegistered={() => void till.reload()} />
          <HelperPairingBox />
        </>
      ) : till.loading ? (
        <p className="muted">Loading…</p>
      ) : null}
    </>
  );
}
