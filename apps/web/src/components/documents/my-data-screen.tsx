// Copyright (c) 2026, Rademics. All rights reserved.
// "Download all my data" (owner, 23 October 2026), for the Owner only: one zip
// with every list and record of the shop as CSV files that open in Excel.
"use client";

import { useState } from "react";
import { businessDate } from "shared";
import { Alert, Button } from "@/components/ui";
import { downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export function MyDataScreen() {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!user?.isOwnerAdmin) {
    return (
      <>
        <h1>Download all my data</h1>
        <Alert kind="error">Only the Owner can see this page.</Alert>
      </>
    );
  }

  async function download() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await downloadFile("/data-export", `RetailERP-all-data-${businessDate()}.zip`);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Download all my data</h1>
      <p className="muted">Your shop’s data is yours. Take a full copy whenever you like and keep it on your own computer or drive.</p>
      <div className="card" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>What the file holds</h2>
        <ul>
          <li>Every list: items, prices, barcodes, customers, suppliers, stores, users and roles.</li>
          <li>Every record: bills, returns, purchases, stock movements, payments, ledger entries, GST details and the change history.</li>
          <li>One spreadsheet file (.csv) per list, all in one zip, with a “READ ME” that lists them.</li>
        </ul>
        <p className="muted">Passwords, PINs and login sessions are never included. The download is written in the change history.</p>
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          <Button variant="primary" busy={busy} onClick={() => void download()}>
            Download all my data
          </Button>
        </div>
        {busy ? <p className="muted">Preparing the file. A shop with a few years of bills can take a minute.</p> : null}
        {done ? <Alert kind="success">The file is downloaded. Keep it somewhere safe: it holds your customers’ details.</Alert> : null}
        <Alert kind="error">{error}</Alert>
      </div>
    </>
  );
}
