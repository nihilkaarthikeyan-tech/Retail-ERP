// Copyright (c) 2026, Rademics. All rights reserved.
// The sync status always on screen (pos-offline plan §7): green "Online",
// amber "Offline, N waiting", red "N could not be sent" (with the list).
// Audit 5: a server fault is "Server not answering", not "Offline"; a till the
// server no longer knows is red; long offline spells warn, then stop billing.
"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Dialog } from "@/components/ui";
import type { TillEngine } from "@/lib/till/engine";
import { dateTimeIn, timeIn } from "@/lib/till/format";
import type { QueueItem } from "@/lib/till/queue";

export interface StatusInfo {
  online: boolean;
  signedOut: boolean;
  waiting: number;
  problems: number;
  fetchedAt: string | null;
  stale: boolean;
  /** Audit 5: the server answers with faults of its own. */
  serverTrouble?: boolean;
  /** Audit 5: the server says this computer is no longer registered as this till. */
  tillNotRegistered?: boolean;
  /** Audit 5 (C1): a warning after long offline, or the reason billing stopped. */
  away?: { level: "warn" | "stop"; message: string } | null;
}

export function statusText(s: StatusInfo): { tone: "ok" | "warn" | "danger"; text: string } {
  if (s.tillNotRegistered) return { tone: "danger", text: "Not registered as this till" };
  // A problem can be a shift opening or a cash entry as well as a bill; the details list says which.
  if (s.problems > 0) return { tone: "danger", text: `${s.problems} not sent: see why` };
  if (s.signedOut) return { tone: "warn", text: s.waiting ? `Sign in again, ${s.waiting} waiting` : "Sign in again" };
  if (!s.online && s.serverTrouble) return { tone: "warn", text: `Server not answering, ${s.waiting} waiting` };
  if (!s.online) return { tone: s.away?.level === "stop" ? "danger" : "warn", text: `Offline, ${s.waiting} waiting` };
  if (s.waiting > 0) return { tone: "warn", text: `Sending, ${s.waiting} waiting` };
  return { tone: "ok", text: "Online" };
}

export function TillStatus({ engine, info }: { engine: TillEngine; info: StatusInfo }) {
  const [open, setOpen] = useState(false);
  const { tone, text } = statusText(info);
  return (
    <div className="till-status-wrap">
      <button type="button" className={`till-status till-status-${tone}`} onClick={() => setOpen(true)} aria-label={`Sync status: ${text}. Show details`}>
        <span className="till-dot" aria-hidden="true" />
        {text}
      </button>
      {!info.online && info.fetchedAt ? <span className="till-status-note">Last price update {timeIn(info.fetchedAt)}</span> : null}
      {info.stale ? <span className="till-status-note till-status-stale">Prices may be out of date (over 24 hours old)</span> : null}
      {info.away ? (
        <span className="till-status-note till-status-stale" role="status">
          {info.away.message}
        </span>
      ) : null}
      <QueueDialog engine={engine} open={open} onClose={() => setOpen(false)} info={info} />
    </div>
  );
}

function QueueDialog({ engine, open, onClose, info }: { engine: TillEngine; open: boolean; onClose: () => void; info: StatusInfo }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    engine.queue.items().then((i) => {
      if (!cancelled) setItems(i);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, open, version, info.waiting, info.problems]);

  async function sendNow() {
    setBusy(true);
    try {
      await engine.tick();
      await engine.sync(true);
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }

  return (
    <Dialog open={open} title="Waiting to be sent" onClose={onClose}>
      {info.tillNotRegistered ? (
        <Alert kind="error">
          This computer is no longer registered as this till. Nothing more is sent from it, and nothing is thrown away: ask a manager to register it again under Billing counter → Tills.
        </Alert>
      ) : null}
      <p>
        {info.online
          ? "The till is connected."
          : info.serverTrouble
            ? "The server is reached but is not answering properly; bills are kept here and sent automatically when it recovers."
            : "The till is offline; bills are kept here and sent automatically when the connection returns."}
      </p>
      {info.away ? <p>{info.away.message}</p> : null}
      {info.signedOut ? (
        <p>
          The session has ended. <a href="/login">Sign in again</a> to send the waiting bills; billing goes on meanwhile.
        </p>
      ) : null}
      {items.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>What</th>
              <th>Made</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={`${i.seq}`} className={i.status === "problem" ? "row-alert" : undefined}>
                <td>{i.label}</td>
                <td>{dateTimeIn(i.createdAt)}</td>
                <td>{i.status === "problem" ? `Could not be sent: ${i.error ?? ""}` : i.error ? `Waiting (last try: ${i.error})` : "Waiting"}</td>
                <td className="row-actions">
                  {i.status === "problem" ? (
                    <Button
                      size="small"
                      onClick={async () => {
                        await engine.queue.retry(i);
                        await engine.updateCounts();
                        setVersion((v) => v + 1);
                      }}
                    >
                      Try again
                    </Button>
                  ) : null}
                  {/* A refused shift opening or cash entry can be done again by hand; it is not kept for ever
                      (launch check, 27 October 2026). A bill is never removed here: it is a sale. */}
                  {i.status === "problem" && i.kind !== "bill" ? (
                    <Button
                      size="small"
                      variant="danger"
                      onClick={async () => {
                        if (!window.confirm(`Remove "${i.label}" from this till? It was refused and will not be sent.`)) return;
                        await engine.queue.remove(i);
                        await engine.tick(true);
                        await engine.updateCounts();
                        setVersion((v) => v + 1);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Nothing is waiting.</p>
      )}
      {info.problems ? <p className="muted">A bill that could not be sent is also listed for a manager under Billing counter → Till reports → Sync problems.</p> : null}
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void sendNow()}>
          Send now
        </Button>
      </div>
    </Dialog>
  );
}
