// Copyright (c) 2026, Rademics. All rights reserved.
// The send queue (pos-offline plan §2, §4–§6): shift openings, cash in/out
// and finished bills not yet confirmed by the server, sent first in, first out.
// Each item keeps the clientId it was given once (the idempotency key), so a
// copy sent again after a timeout is recognised by the server, never saved
// twice. Network failures are retried with a growing wait; a refusal from the
// server (4xx) puts that one item on the "could not be sent" list and the rest
// of the queue carries on.
import type { KeyValueStore } from "./storage";

export type QueueKind = "shift_open" | "cash_movement" | "bill";

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
  nextAttemptAt: string | null;
  status: "waiting" | "problem";
  error: string | null;
}

/** What a failed send looks like to the queue. */
export interface SendError {
  /** 0 = could not reach the server. */
  statusCode: number;
  message: string;
}

export type Sender = (item: QueueItem) => Promise<unknown>;

export interface QueueResult {
  sent: number;
  problems: number;
  /** True when the server could not be reached (or was down). */
  offline: boolean;
  /** True when the session has ended (401); a cashier must sign in again. */
  signedOut: boolean;
  /** True when the first waiting item is still in its retry wait (nothing was tried). */
  deferred: boolean;
}

const PREFIX = "queue:";
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

function asSendError(err: unknown): SendError {
  if (err && typeof err === "object" && "statusCode" in err) {
    const e = err as { statusCode: number; message?: string };
    return { statusCode: Number(e.statusCode) || 0, message: e.message ?? "Sending failed" };
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
    await this.store.set(this.key(item), { ...item, status: "waiting", attempts: 0, nextAttemptAt: null, error: null });
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
    const result: QueueResult = { sent: 0, problems: 0, offline: false, signedOut: false, deferred: false };
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
          result.signedOut = true;
          break;
        }
        if (isRetryable(e)) {
          const attempts = item.attempts + 1;
          await this.store.set(this.key(item), { ...item, attempts, error: e.message, nextAttemptAt: new Date(this.now().getTime() + backoffMs(attempts)).toISOString() });
          result.offline = e.statusCode === 0 || e.statusCode >= 500;
          break;
        }
        await this.store.set(this.key(item), { ...item, attempts: item.attempts + 1, status: "problem", error: e.message, nextAttemptAt: null });
        result.problems++;
      }
    }
    return result;
  }
}
