// Copyright (c) 2026, Rademics. All rights reserved.
// The send queue (pos-offline plan §2, §4–§6): shift openings, cash in/out
// finished bills and cash drawer openings not yet confirmed by the server,
// sent first in, first out.
// Each item keeps the clientId it was given once (the idempotency key), so a
// copy sent again after a timeout is recognised by the server, never saved
// twice. Network failures are retried with a growing wait; a refusal from the
// server (4xx) puts that one item on the "could not be sent" list and the rest
// of the queue carries on. Audit 5 (29 October 2026): an item the server keeps
// failing while it can be reached (a fault, or no answer to this one item) is
// tried 10 times or for an hour, then put on that list too, so the items behind
// it are not held up for ever; plain network trouble (the till is offline) never
// counts. A 401 waits for the next sign-in; a 403 "till not registered" stops
// sending and keeps everything.
import type { KeyValueStore } from "./storage";

export type QueueKind = "shift_open" | "cash_movement" | "bill" | "drawer_opening";

export interface QueueItem {
  /** The idempotency key sent with every attempt. */
  clientId: string;
  kind: QueueKind;
  /** Keeps first-in-first-out order across restarts. */
  seq: number;
  createdAt: string;
  /** What the cashier sees in lists, e.g. "Bill MAT1/2627/000012". */
  label: string;
  payload: unknown;
  /** Cash movements: the shift they belong to (its server id is found at send time). */
  shiftClientId?: string;
  /** Bills: who made it, so the cashier's switch token can be added when sending. */
  cashierId?: string;
  attempts: number;
  /** Failures while the server could be reached (they count towards giving up, audit 5). */
  strikes?: number;
  /** When the first of those failures happened. */
  firstStrikeAt?: string | null;
  nextAttemptAt: string | null;
  status: "waiting" | "problem";
  error: string | null;
}

/** What a failed send looks like to the queue. */
export interface SendError {
  /** 0 = could not reach the server. */
  statusCode: number;
  message: string;
  /** The server's machine-readable code, when it sent one. */
  code?: string;
}

export type Sender = (item: QueueItem) => Promise<unknown>;

export interface QueueResult {
  sent: number;
  problems: number;
  /** True when the server could not be reached. */
  offline: boolean;
  /** True when the server answered with a fault (5xx): it is reached but failing (not "offline"). */
  serverTrouble: boolean;
  /** True when the session has ended (401); a cashier must sign in again. */
  signedOut: boolean;
  /** True when the server says this computer is no longer registered as this till (403). */
  tillNotRegistered: boolean;
  /** True when the first waiting item is still in its retry wait (nothing was tried). */
  deferred: boolean;
}

const PREFIX = "queue:";
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;
/** Audit 5: an item failing while the server can be reached is given up after this many tries … */
export const MAX_STRIKES = 10;
/** … or after this long, whichever comes first. */
export const MAX_STRIKE_MS = 60 * 60_000;
export const TILL_NOT_REGISTERED = "TILL_NOT_REGISTERED";

export function backoffMs(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

function asSendError(err: unknown): SendError {
  if (err && typeof err === "object" && "statusCode" in err) {
    const e = err as { statusCode: number; message?: string; code?: string };
    return { statusCode: Number(e.statusCode) || 0, message: e.message ?? "Sending failed", ...(e.code ? { code: e.code } : {}) };
  }
  return { statusCode: 0, message: err instanceof Error ? err.message : String(err) };
}

/** Network trouble or a server fault: keep the item and try again later. */
export function isRetryable(e: SendError): boolean {
  return e.statusCode === 0 || e.statusCode === 408 || e.statusCode === 429 || e.statusCode >= 500;
}

export class SendQueue {
  private running: Promise<QueueResult> | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly sender: Sender,
    private readonly now: () => Date = () => new Date(),
    /** Told about each item the server confirmed, with its answer. */
    private readonly onSent: (item: QueueItem, response: unknown) => Promise<void> | void = () => {},
    /** After a network failure: can the server be reached at all? Only then does the failure count (audit 5). */
    private readonly reachable: () => Promise<boolean> = async () => false,
  ) {}

  private key(item: Pick<QueueItem, "seq" | "clientId">): string {
    return `${PREFIX}${String(item.seq).padStart(12, "0")}:${item.clientId}`;
  }

  async items(): Promise<QueueItem[]> {
    return (await this.store.entries<QueueItem>(PREFIX)).map(([, v]) => v).sort((a, b) => a.seq - b.seq);
  }

  async counts(): Promise<{ waiting: number; problems: number }> {
    const all = await this.items();
    return { waiting: all.filter((i) => i.status === "waiting").length, problems: all.filter((i) => i.status === "problem").length };
  }

  /** Adds an item; the same clientId twice is kept once. Saved before this returns. */
  async enqueue(item: Pick<QueueItem, "clientId" | "kind" | "label" | "payload" | "shiftClientId" | "cashierId">): Promise<QueueItem> {
    const all = await this.items();
    const same = all.find((i) => i.clientId === item.clientId && i.kind === item.kind);
    if (same) return same;
    const seq = Math.max(this.now().getTime(), (all.at(-1)?.seq ?? 0) + 1);
    const full: QueueItem = { ...item, seq, createdAt: this.now().toISOString(), attempts: 0, nextAttemptAt: null, status: "waiting", error: null };
    await this.store.set(this.key(full), full);
    return full;
  }

  async remove(item: QueueItem): Promise<void> {
    await this.store.delete(this.key(item));
  }

  /** Puts a "could not be sent" item back in line (after a manager fixed the cause). */
  async retry(item: QueueItem): Promise<void> {
    await this.store.set(this.key(item), { ...item, status: "waiting", attempts: 0, strikes: 0, firstStrikeAt: null, nextAttemptAt: null, error: null });
  }

  /** Sends what is waiting, in order. Only one run at a time; a second call waits for the first. */
  process(options: { force?: boolean } = {}): Promise<QueueResult> {
    if (!this.running) {
      this.running = this.run(options.force ?? false).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(force: boolean): Promise<QueueResult> {
    const result: QueueResult = { sent: 0, problems: 0, offline: false, serverTrouble: false, signedOut: false, tillNotRegistered: false, deferred: false };
    for (const item of await this.items()) {
      if (item.status !== "waiting") continue;
      if (!force && item.nextAttemptAt && new Date(item.nextAttemptAt) > this.now()) {
        // First in, first out: later items wait for this one.
        result.deferred = true;
        break;
      }
      try {
        const response = await this.sender(item);
        await this.remove(item);
        await this.onSent(item, response);
        result.sent++;
      } catch (err) {
        const e = asSendError(err);
        if (e.statusCode === 401) {
          // The session ended: everything waits, and goes on after the next sign-in.
          result.signedOut = true;
          break;
        }
        if (e.statusCode === 403 && e.code === TILL_NOT_REGISTERED) {
          // Nothing more can be sent from this computer; nothing is thrown away either.
          result.tillNotRegistered = true;
          break;
        }
        if (isRetryable(e)) {
          const attempts = item.attempts + 1;
          // A network failure counts only if the server can be reached (this one item gets no answer).
          const reached = e.statusCode !== 0 || (await this.reachable().catch(() => false));
          const strikes = (item.strikes ?? 0) + (reached ? 1 : 0);
          const firstStrikeAt = reached ? (item.firstStrikeAt ?? this.now().toISOString()) : (item.firstStrikeAt ?? null);
          const givenUp = reached && (strikes >= MAX_STRIKES || (!!firstStrikeAt && this.now().getTime() - new Date(firstStrikeAt).getTime() >= MAX_STRIKE_MS));
          if (givenUp) {
            await this.store.set(this.key(item), { ...item, attempts, strikes, firstStrikeAt, status: "problem", error: `The server kept failing on this one (${e.message})`, nextAttemptAt: null });
            result.problems++;
            continue;
          }
          await this.store.set(this.key(item), { ...item, attempts, strikes, firstStrikeAt, error: e.message, nextAttemptAt: new Date(this.now().getTime() + backoffMs(attempts)).toISOString() });
          if (e.statusCode === 0 && !reached) result.offline = true;
          else result.serverTrouble = true;
          break;
        }
        await this.store.set(this.key(item), { ...item, attempts: item.attempts + 1, status: "problem", error: e.message, nextAttemptAt: null });
        result.problems++;
      }
    }
    return result;
  }
}
