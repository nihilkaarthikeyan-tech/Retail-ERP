// Copyright (c) 2026, Rademics. All rights reserved.
// The till (billing counter), full screen and outside the back-office shell.
// It runs from what is saved on this computer, so it keeps billing when the
// server cannot be reached (pos-offline plan §1). This computer must be
// registered as a till first (Billing counter → Tills). Audit 5: one billing
// tab per till at a time (navigator.locks), the browser is asked to keep the
// till's data, and a till that cannot open its database says so plainly.
"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { hasPermission } from "shared";
import { Alert, Button } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { CASHIER_KEY, offlineStopMessage, offlineWarnMessage, type SessionLike, TillEngine } from "@/lib/till/engine";
import { askPersistentStorage, tillStore } from "@/lib/till/storage";
import { tillApi } from "@/lib/till/till-api";
import { getTillDevice, type TillDeviceInfo } from "@/lib/till-device";
import { formatDate } from "@/lib/format";
import { BillingScreen } from "./billing-screen";
import { LockScreen } from "./pin-dialogs";
import { OpenShiftScreen } from "./shift-dialogs";
import { TillStatus } from "./till-status";

const TICK_MS = 30_000;
const LOCK_KEY = `${CASHIER_KEY}:locked`;

/** Shown when the till's database cannot be opened (IndexedDB blocked, full or broken). */
export const STORAGE_FAILED = "The till cannot save on this computer: the browser's storage is blocked or full. Bills cannot be kept safely, so billing cannot start. Free some disk space or allow this site to keep data, then reload the page.";
export const OTHER_TAB = "This till is open in another tab. Bill in that tab, or close it; this tab takes over when it is closed.";

type TabLock = "waiting" | "held" | "other";

/**
 * Audit 5: one billing tab per till. With navigator.locks the first tab holds
 * the till's lock until it closes; another tab waits and takes over then.
 * Without navigator.locks (older browsers) every tab bills, as before.
 */
function useTabLock(tillId: string): TabLock {
  const [state, setState] = useState<TabLock>(() => (typeof navigator !== "undefined" && navigator.locks ? "waiting" : "held"));
  useEffect(() => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return;
    const name = `retail-erp-till-${tillId}`;
    const stop = new AbortController();
    let release: () => void = () => {};
    let cancelled = false;
    const hold = () =>
      new Promise<void>((resolve) => {
        // Unmounted before the lock came: give it back at once.
        if (cancelled) return resolve();
        release = resolve;
        setState("held");
      });
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (lock) return hold();
        if (!cancelled) setState("other");
        // Wait for the other tab to close, then take over.
        return locks.request(name, { signal: stop.signal }, hold).catch(() => undefined);
      })
      .catch(() => setState("held"));
    return () => {
      cancelled = true;
      stop.abort();
      release();
    };
  }, [tillId]);
  return state;
}

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
        <p>This computer is not set up as a till yet. A manager does it once, on this computer:</p>
        {/* Audit 9: the steps, so a new shop owner is not left guessing. */}
        <ol>
          <li>Open Billing counter → Tills.</li>
          <li>Choose the till (a new shop has Till 1).</li>
          <li>Press “Use this computer as till …” at the bottom of its page.</li>
        </ol>
        <p>
          <Link className="btn btn-primary" href="/pos/tills">
            Open Billing counter → Tills
          </Link>
        </p>
      </div>
    </div>
  );
}

export function TillApp({ device, engine: given }: { device: TillDeviceInfo; engine?: TillEngine }) {
  const tab = useTabLock(device.tillId);
  if (tab === "waiting") return <p className="till-center muted">Opening the till…</p>;
  if (tab === "other") {
    return (
      <div className="till-center">
        <div className="card till-open">
          <h1>Till {device.tillCode}</h1>
          <Alert kind="info">{OTHER_TAB}</Alert>
        </div>
      </div>
    );
  }
  return <TillRunning device={device} given={given} />;
}

function TillRunning({ device, given }: { device: TillDeviceInfo; given?: TillEngine }) {
  const engine = useMemo(() => given ?? new TillEngine({ store: tillStore(device.tillId), api: tillApi(device), device, session: browserSession() }), [device, given]);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const [locked, setLocked] = useState(() => browserSession()?.getItem(LOCK_KEY) === "1");
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    // Audit 5: ask once that the browser keeps the till's data when the disk runs low.
    void askPersistentStorage();
  }, []);

  useEffect(() => {
    engine.start().catch((err: unknown) => {
      // Audit 5: the till's database could not be opened; say so instead of "Opening the till…" for ever.
      console.error("The till could not start", err);
      setStartError(`${STORAGE_FAILED} (${errorMessage(err)})`);
    });
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
  const away = engine.offlineLevel();
  const status = {
    online: state.online,
    signedOut: state.signedOut,
    waiting: state.waiting,
    problems: state.problems,
    fetchedAt: snapshot?.fetchedAt ?? null,
    stale: engine.isSnapshotStale(),
    serverTrouble: state.serverTrouble,
    tillNotRegistered: state.tillNotRegistered,
    away: away.level === "ok" ? null : { level: away.level, message: away.level === "stop" ? offlineStopMessage(away.stopHours) : offlineWarnMessage(away.warnHours, away.stopHours) },
  };

  let body: ReactNode;
  if (startError) {
    body = (
      <div className="till-center">
        <div className="card till-open">
          <h1>Till {device.tillCode}</h1>
          <Alert kind="error">{startError}</Alert>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  } else if (!state.ready) body = <p className="till-center muted">Opening the till…</p>;
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
        <Alert kind="error">Your role cannot bill at the till. Ask the owner to give you the Cashier role under Administration → Users.</Alert>
      </div>
    );
  } else if (state.user && !state.user.allStores && !state.user.stores.some((s) => s.id === snapshot.till.store.id)) {
    // Found in the launch check of 27 October 2026: a cashier of another store could open a shift
    // here; it was only refused when sent, and every bill after it would have been refused too.
    body = (
      <div className="till-center">
        <Alert kind="error">
          {state.user.firstName} is not allowed to work at {snapshot.till.store.name}. Ask the owner to allow this store under Administration → Users, or sign in as a cashier of this store.
        </Alert>
      </div>
    );
  } else if (!state.shift) {
    body = <OpenShiftScreen engine={engine} openedBy={cashier?.name ?? ""} />;
  } else {
    body = <BillingScreen engine={engine} state={state} snapshot={snapshot} cashierName={cashier?.name ?? ""} locked={locked} />;
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
          <strong>{state.shift ? formatDate(state.shift.businessDate) : "Not open"}</strong>
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
      {state.tillNotRegistered ? (
        <div className="till-test-banner till-warn-banner" role="alert">
          This computer is no longer registered as this till. The bills on it are kept and nothing more is sent; ask a manager to register it again under Billing counter → Tills.
        </div>
      ) : state.signedOut ? (
        <div className="till-test-banner till-warn-banner" role="status">
          The session has ended. Billing goes on; <Link href="/login">sign in again</Link> to send the waiting bills.
        </div>
      ) : null}
      {/* Audit 9: nothing behind the lock screen can be reached with the keyboard. */}
      <div className="till-body" inert={locked}>
        {body}
      </div>
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
