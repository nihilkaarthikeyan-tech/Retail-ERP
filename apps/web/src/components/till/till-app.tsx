// Copyright (c) 2026, Rademics. All rights reserved.
// The till (billing counter), full screen and outside the back-office shell.
// It runs from what is saved on this computer, so it keeps billing when the
// server cannot be reached (pos-offline plan §1). This computer must be
// registered as a till first (Billing counter → Tills).
"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { hasPermission } from "shared";
import { Alert, Button } from "@/components/ui";
import { CASHIER_KEY, type SessionLike, TillEngine } from "@/lib/till/engine";
import { tillStore } from "@/lib/till/storage";
import { tillApi } from "@/lib/till/till-api";
import { getTillDevice, type TillDeviceInfo } from "@/lib/till-device";
import { BillingScreen } from "./billing-screen";
import { LockScreen } from "./pin-dialogs";
import { OpenShiftScreen } from "./shift-dialogs";
import { TillStatus } from "./till-status";

const TICK_MS = 30_000;
const LOCK_KEY = `${CASHIER_KEY}:locked`;

function browserSession(): SessionLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Reads the registered till of this computer (client only). */
export function TillPage() {
  const [device] = useState<TillDeviceInfo | null>(() => getTillDevice());
  if (!device) return <NotATill />;
  return <TillApp device={device} />;
}

export function NotATill() {
  return (
    <div className="till-center">
      <div className="card till-open">
        <h1>Billing counter</h1>
        <p>This computer is not set up as a till. A manager can set it up on Billing counter → Tills.</p>
        <p>
          <Link href="/pos/tills">Go to Billing counter → Tills</Link>
        </p>
      </div>
    </div>
  );
}

export function TillApp({ device, engine: given }: { device: TillDeviceInfo; engine?: TillEngine }) {
  const engine = useMemo(() => given ?? new TillEngine({ store: tillStore(device.tillId), api: tillApi(device), device, session: browserSession() }), [device, given]);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const [locked, setLocked] = useState(() => browserSession()?.getItem(LOCK_KEY) === "1");

  useEffect(() => {
    void engine.start();
    const timer = setInterval(() => void engine.tick(), TICK_MS);
    const wake = () => void engine.tick();
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [engine]);

  // Warn before closing the page while bills wait to be sent (pos-offline §3 known risk).
  useEffect(() => {
    if (!state.waiting) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.waiting]);

  function lock(on: boolean) {
    setLocked(on);
    try {
      if (on) browserSession()?.setItem(LOCK_KEY, "1");
      else browserSession()?.removeItem(LOCK_KEY);
    } catch {
      // The lock then lasts until the page is reloaded.
    }
  }

  const snapshot = state.snapshot;
  const cashier = engine.currentCashier();
  const status = { online: state.online, signedOut: state.signedOut, waiting: state.waiting, problems: state.problems, fetchedAt: snapshot?.fetchedAt ?? null, stale: engine.isSnapshotStale() };

  let body: ReactNode;
  if (!state.ready) body = <p className="till-center muted">Opening the till…</p>;
  else if (!snapshot) {
    body = (
      <div className="till-center">
        <div className="card till-open">
          <h1>Till {device.tillCode}</h1>
          {state.signedOut || (!state.user && state.online) ? (
            <p>
              Sign in to start this till. <Link href="/login">Sign in</Link>
            </p>
          ) : state.error ? (
            <Alert kind="error">{state.error}</Alert>
          ) : state.online ? (
            <p className="muted">Downloading the items and prices…</p>
          ) : (
            <p>This till has not downloaded its items and prices yet. Connect it to the server once; after that it can bill offline.</p>
          )}
          <Button onClick={() => void engine.tick(true)}>Try again</Button>
        </div>
      </div>
    );
  } else if (state.user && !hasPermission(state.user, "pos.sell")) {
    body = (
      <div className="till-center">
        <Alert kind="error">Your role cannot bill at the till (needs the right “pos.sell”).</Alert>
      </div>
    );
  } else if (!state.shift) {
    body = <OpenShiftScreen engine={engine} openedBy={cashier?.name ?? ""} />;
  } else {
    body = <BillingScreen engine={engine} state={state} snapshot={snapshot} cashierName={cashier?.name ?? ""} />;
  }

  return (
    <div className="till">
      <header className="till-top">
        <div className="till-top-id">
          <strong>Till {snapshot?.till.code ?? device.tillCode}</strong>
          <span className="muted">{snapshot ? `${snapshot.till.store.name}` : device.deviceName}</span>
        </div>
        <div className="till-top-id">
          <span className="muted">Cashier</span>
          <strong>{cashier?.name || "—"}</strong>
        </div>
        <div className="till-top-id">
          <span className="muted">Shift</span>
          <strong>{state.shift ? state.shift.businessDate : "Not open"}</strong>
        </div>
        <TillStatus engine={engine} info={status} />
        <div className="till-top-end">
          <Button onClick={() => lock(true)} disabled={!state.online || !state.shift}>
            Lock / switch cashier
          </Button>
          <Link className="btn btn-link" href="/dashboard">
            Back office
          </Link>
        </div>
      </header>
      {state.signedOut ? (
        <div className="till-test-banner till-warn-banner" role="status">
          The session has ended. Billing goes on; <Link href="/login">sign in again</Link> to send the waiting bills.
        </div>
      ) : null}
      {body}
      {locked ? (
        <LockScreen
          api={engine.api}
          online={state.online}
          current={cashier?.name ?? null}
          onSwitch={async (userId, pin) => {
            await engine.switchCashier(userId, pin);
            lock(false);
          }}
          onResume={() => lock(false)}
        />
      ) : null}
    </div>
  );
}
