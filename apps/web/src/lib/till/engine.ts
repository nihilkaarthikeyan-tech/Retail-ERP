// Copyright (c) 2026, Rademics. All rights reserved.
// The till engine: everything the till keeps and does without the screen
// (pos-offline plan §2–§7). It owns the saved snapshot, the open shift, the
// bill being made, parked bills, the send queue, the number counter and the
// till's recent bills, and it decides between online and offline. Pure
// TypeScript with its storage, API and clock passed in, so it is unit-tested.
import { businessDate, type CurrentUser, Decimal, type OpenShiftInput, type PosTransactionInput } from "shared";
import { ApiError, errorMessage } from "../api";
import type { TillDeviceInfo } from "../till-device";
import { NumberCounter, prefixFor } from "./numbers";
import { buildTransaction, checkPayments, type ComputedBill, type DraftBill, emptyDraft, hasNamedCustomer, isDraftEmpty, isNoBillReturn, priceBill, usesOnAccount, usesPointsOrCards } from "./pricing";
import { type QueueItem, type QueueResult, SendQueue } from "./queue";
import { localReceipts } from "./receipt";
import { isStale, loadSnapshot, REFRESH_MS, refreshSnapshot } from "./snapshot";
import type { KeyValueStore } from "./storage";
import { isOfflineError, priceChangedTotal, type TillApi } from "./till-api";
import type { BillDto, GiftCardSaleResult, LocalShift, Person, Receipt, ServerShift, StoredSnapshot, TillCustomerPoints, TillGiftCard, TransactionResult } from "./types";

const DRAFT_KEY = "draft";
const SHIFT_KEY = "shift";
const USER_KEY = "meta:user";
const LAST_RECEIPTS_KEY = "meta:last-receipts";
const PARKED = "parked:";
const RECENT = "recent:";
const SHIFT_IDS = "shiftid:";
/** The till keeps 30 days of its own bills for returns (pos-offline §8). */
const RECENT_DAYS = 30;

export const CASHIER_KEY = "retail-erp:till-cashier";

/** sessionStorage-like: the cashier's switch token lives only for this browser session. */
export interface SessionLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Cashier extends Person {
  token: string | null;
}

export interface EngineState {
  ready: boolean;
  snapshot: StoredSnapshot | null;
  shift: LocalShift | null;
  online: boolean;
  signedOut: boolean;
  user: CurrentUser | null;
  cashier: Cashier | null;
  waiting: number;
  problems: number;
  /** Problem with loading the till set-up (shown when there is no saved copy). */
  error: string | null;
}

export interface ParkedBill {
  id: string;
  parkedAt: string;
  label: string;
  draft: DraftBill;
}

export interface RecentBill {
  number: string;
  savedAt: string;
  /** The server's bill (with line ids for returns); null while it waits to be sent. */
  bill: BillDto | null;
  receipts: Receipt[];
}

export interface FinishResult {
  receipts: Receipt[];
  offline: boolean;
  change: string;
  paidCash: boolean;
  /** Plan 11 part 2: the server's warnings (e.g. stock set aside for a customer order was sold). */
  warnings?: string[];
}

/** Plan 11 part 2: orders, customer credit and alteration charges are checked on the server, so never kept offline. */
export const ORDER_OFFLINE = "Collecting an order, using a customer's advance or billing an alteration needs the connection. Try again when the till is online.";

/** An online bill whose total the server worked out differently (409 PRICE_CHANGED). */
export class PriceChangedError extends Error {
  constructor(
    readonly serverTotal: string,
    readonly tillTotal: string,
  ) {
    super(`The server total is ₹${serverTotal}, the till showed ₹${tillTotal}. Prices changed; check the bill again.`);
    this.name = "PriceChangedError";
  }
}

/** Plain messages for on-account bills (plan 07 §1a): they are never kept offline. */
export const ON_ACCOUNT_OFFLINE = "On account needs the connection: the customer's balance is checked on the server. Take another payment method, or wait until the till is online.";
export const ON_ACCOUNT_DROPPED = "The connection dropped while sending this bill. On account needs the connection, so the bill was not kept on the till: take another payment method, or try again when the till is online.";
export const ON_ACCOUNT_NAMED = "On account is only for a named customer. Choose the customer first (F6 Customer).";

/**
 * The server refused an on-account bill over the customer's credit limit, or
 * with too much overdue (403). A store manager's PIN can override it: the
 * same bill is sent again with the approval token.
 */
export class CreditApprovalError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "CreditApprovalError";
  }
}

/** The reason from a 403 credit check that a manager may override, or null. */
export function creditOverride(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.statusCode !== 403) return null;
  if (!/A manager must approve\.?$/.test(err.message)) return null;
  if (!err.message.startsWith("Over the credit limit") && !/^₹[\d,.]+ is overdue/.test(err.message)) return null;
  return err.message;
}

/** Plan 13: points and gift cards are checked on the server, so a bill using them is never kept offline. */
export const POINTS_OFFLINE = "Points and gift cards need the connection: the balance is checked on the server. Take them off the bill and use another payment method, or wait until the till is online.";
export const POINTS_DROPPED = "The connection dropped while sending this bill. Points and gift cards need the connection, so the bill was not kept on the till: try again when the till is online, or take them off and use another payment method.";
export const GIFT_CARD_SALE_OFFLINE = "Selling or reloading a gift card needs the connection: the card is made and checked on the server. Try again when the till is online.";
/** Plan 13: shown on the till's own receipt for a named customer's offline bill. */
export const POINTS_LATER = "Points for this bill are added when the till is back online.";

/** Plain messages for returns without the original bill (plan 11 A9): a manager approves them on the server, so they are never kept offline. */
export const NO_BILL_RETURN_OFFLINE = "A return without a bill needs the connection: a manager approves it on the server. Try again when the till is online, or find the original bill.";
export const NO_BILL_RETURN_DROPPED = "The connection dropped while sending this return. A return without a bill needs the connection, so it was not kept on the till: try again when the till is online.";
export const APPROVAL_SPENT = "A manager approval on this bill was already used or has expired. Ask the manager again (Manager PIN), then finish the bill.";

/**
 * The server refused an online sale line priced below cost (400, plan 11 A2).
 * The cashier cannot see costs, so the till learns it only here; a manager's
 * PIN (price change) on that line lets the same bill through.
 */
export class BelowCostError extends Error {
  constructor(
    readonly reason: string,
    readonly itemCode: string,
    /** The draft line the manager approves. */
    readonly lineKey: string,
  ) {
    super(reason);
    this.name = "BelowCostError";
  }
}

/** The item code from a 400 "<CODE>: this price is below cost; a manager must approve it", or null. */
export function belowCostCode(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.statusCode !== 400) return null;
  const m = /^(.+?): this price is below cost; a manager must approve it\.?$/.exec(err.message);
  return m ? m[1] : null;
}

/** A 403 for a manager approval already used, expired or not for this: the till asks again. */
export function approvalSpent(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 403 && /^The manager approval (was already used|has expired|is not valid)/.test(err.message);
}

/** The bill without any manager approvals (they are asked for again). */
function withoutApprovals(d: DraftBill): DraftBill {
  return {
    ...d,
    lines: d.lines.map((l) => ({ ...l, approvalToken: undefined, approvedBy: undefined })),
    billDiscount: d.billDiscount ? { ...d.billDiscount, approvalToken: undefined, approvedBy: undefined } : null,
    ret: d.ret ? { ...d.ret, approvalToken: undefined, approvedBy: undefined } : null,
  };
}

export interface FinishOptions {
  /** A manager's single-use approval for a bill over the credit limit (action credit_over_limit). */
  creditApprovalToken?: string;
}

export interface EngineDeps {
  store: KeyValueStore;
  api: TillApi;
  device: TillDeviceInfo;
  session?: SessionLike | null;
  now?: () => Date;
  uuid?: () => string;
}

function defaultUuid(): string {
  return crypto.randomUUID();
}

export class TillEngine {
  readonly store: KeyValueStore;
  readonly api: TillApi;
  readonly device: TillDeviceInfo;
  readonly queue: SendQueue;
  readonly counter: NumberCounter;
  private readonly session: SessionLike | null;
  private readonly now: () => Date;
  readonly uuid: () => string;
  private state: EngineState = { ready: false, snapshot: null, shift: null, online: false, signedOut: false, user: null, cashier: null, waiting: 0, problems: 0, error: null };
  private listeners = new Set<() => void>();
  private lastRefresh = 0;
  private draftChain: Promise<unknown> = Promise.resolve();

  constructor(deps: EngineDeps) {
    this.store = deps.store;
    this.api = deps.api;
    this.device = deps.device;
    this.session = deps.session ?? null;
    this.now = deps.now ?? (() => new Date());
    this.uuid = deps.uuid ?? defaultUuid;
    this.counter = new NumberCounter(this.store);
    this.queue = new SendQueue(this.store, (item) => this.send(item), this.now, (item, res) => this.onSent(item, res));
  }

  // ---- State for the screen ----

  getState = (): EngineState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  today(): string {
    return businessDate(this.now());
  }

  // ---- Starting up and keeping in touch ----

  /** Loads what is saved on the till, then tries the server. Billing works either way. */
  async start(): Promise<void> {
    const [snapshot, shift, user] = await Promise.all([loadSnapshot(this.store), this.store.get<LocalShift>(SHIFT_KEY), this.store.get<CurrentUser>(USER_KEY)]);
    this.set({ snapshot, shift: shift ?? null, user: user ?? null, cashier: this.readCashier() });
    await this.updateCounts();
    await this.pruneRecent();
    this.set({ ready: true });
    await this.tick(true);
  }

  /** Checks the connection, refreshes the snapshot when due, syncs the shift and sends the queue. */
  async tick(forceRefresh = false): Promise<void> {
    const wasOffline = !this.state.online || this.state.signedOut;
    try {
      const me = await this.api.me();
      await this.store.set(USER_KEY, me);
      this.set({ online: true, signedOut: false, user: me });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) this.set({ online: true, signedOut: true });
      else this.set({ online: false });
      await this.updateCounts();
      return;
    }
    if (forceRefresh || !this.state.snapshot || Date.now() - this.lastRefresh >= REFRESH_MS) await this.refresh();
    await this.syncShift();
    // Just back online: send at once rather than waiting out the retry delay.
    await this.sync(wasOffline);
  }

  async refresh(): Promise<void> {
    try {
      const snapshot = await refreshSnapshot(this.store, (since) => this.api.snapshot(since), this.now);
      this.lastRefresh = Date.now();
      this.set({ snapshot, error: null, online: true });
    } catch (err) {
      if (isOfflineError(err)) this.set({ online: false });
      else this.set({ error: errorMessage(err) });
    }
  }

  isSnapshotStale(): boolean {
    return isStale(this.state.snapshot, this.now());
  }

  /** The server's open shift wins; a shift opened here and not yet sent is kept. */
  /** Why the server's shift could not be read, when it was not a lost connection. */
  private shiftProblem: string | null = null;

  async syncShift(): Promise<ServerShift | null> {
    let server: ServerShift | null;
    try {
      server = await this.api.currentShift();
      this.shiftProblem = null;
    } catch (err) {
      if (isOfflineError(err)) this.set({ online: false });
      // Audit 1 (28 October 2026): keep the server's reason (for example a till of another shop) to show it.
      else this.shiftProblem = err instanceof Error ? err.message : String(err);
      return null;
    }
    const local = this.state.shift;
    if (server) {
      await this.store.set(`${SHIFT_IDS}${server.clientId}`, server.id);
      const shift: LocalShift = {
        clientId: server.clientId,
        id: server.id,
        businessDate: server.businessDate,
        openedAt: typeof server.openedAt === "string" ? server.openedAt : new Date(server.openedAt).toISOString(),
        openedByName: local?.clientId === server.clientId ? local.openedByName : "",
        openingCash: server.openingCash,
      };
      await this.store.set(SHIFT_KEY, shift);
      this.set({ shift });
    } else if (local) {
      const pending = (await this.queue.items()).some((i) => i.kind === "shift_open" && i.clientId === local.clientId && i.status === "waiting");
      if (!pending) {
        await this.store.delete(SHIFT_KEY);
        this.set({ shift: null });
      }
    }
    return server;
  }

  /** Sends the queue; `force` ignores the retry delay ("Send now"). */
  async sync(force = false): Promise<QueueResult> {
    const result = await this.queue.process({ force });
    if (result.offline) this.set({ online: false });
    else if (result.sent) this.set({ online: true });
    if (result.signedOut) this.set({ signedOut: true });
    await this.updateCounts();
    return result;
  }

  async updateCounts(): Promise<void> {
    const c = await this.queue.counts();
    this.set({ waiting: c.waiting, problems: c.problems });
  }

  private async send(item: QueueItem): Promise<unknown> {
    switch (item.kind) {
      case "shift_open":
        return this.api.openShift(item.payload as OpenShiftInput);
      case "cash_movement": {
        const shiftId = item.shiftClientId ? await this.store.get<string>(`${SHIFT_IDS}${item.shiftClientId}`) : undefined;
        if (!shiftId) throw new ApiError(400, "The shift of this cash entry did not reach the server");
        return this.api.cashMovement(shiftId, item.payload as never);
      }
      case "bill": {
        const body = { ...(item.payload as PosTransactionInput) };
        const token = item.cashierId ? this.cashierTokens()[item.cashierId] : undefined;
        if (token) body.cashierToken = token;
        else delete body.cashierToken;
        return this.api.postBill(body);
      }
    }
  }

  private async onSent(item: QueueItem, response: unknown): Promise<void> {
    if (item.kind === "shift_open") {
      const s = response as ServerShift;
      await this.store.set(`${SHIFT_IDS}${s.clientId}`, s.id);
      const local = this.state.shift;
      if (local?.clientId === s.clientId) {
        const shift = { ...local, id: s.id };
        await this.store.set(SHIFT_KEY, shift);
        this.set({ shift });
      }
    } else if (item.kind === "bill") {
      await this.rememberResult(response as TransactionResult);
    }
  }

  // ---- The signed-in cashier and PIN switching (decision 68) ----

  private cashierTokens(): Record<string, string> {
    try {
      return JSON.parse(this.session?.getItem(`${CASHIER_KEY}:tokens`) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  }

  private readCashier(): Cashier | null {
    try {
      const raw = this.session?.getItem(CASHIER_KEY);
      return raw ? (JSON.parse(raw) as Cashier) : null;
    } catch {
      return null;
    }
  }

  /** Who is billing now: the cashier who switched in with a PIN, else the signed-in user. */
  currentCashier(): Cashier | null {
    if (this.state.cashier) return this.state.cashier;
    const u = this.state.user;
    return u ? { id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" "), token: null } : null;
  }

  async switchCashier(userId: string, pin: string): Promise<Cashier> {
    const res = await this.api.switchCashier({ userId, pin });
    const cashier: Cashier = { id: res.cashier.id, name: res.cashier.name, token: res.token };
    const tokens = { ...this.cashierTokens(), [cashier.id]: res.token };
    this.session?.setItem(`${CASHIER_KEY}:tokens`, JSON.stringify(tokens));
    this.session?.setItem(CASHIER_KEY, JSON.stringify(cashier));
    this.set({ cashier });
    return cashier;
  }

  // ---- The bill being made (saved on every change, pos-offline §6) ----

  /** The saved bill and whether it is a restored one (the till closed with it half made). */
  async loadDraft(): Promise<{ draft: DraftBill; restored: boolean }> {
    const saved = await this.store.get<DraftBill>(DRAFT_KEY);
    if (saved && !isDraftEmpty(saved)) return { draft: saved, restored: true };
    return { draft: saved ?? emptyDraft(this.uuid(), this.now()), restored: false };
  }

  /** Saves in order, so the last change always wins on disk. */
  saveDraft(draft: DraftBill): Promise<void> {
    const run = () => this.store.set(DRAFT_KEY, draft);
    const p = this.draftChain.then(run, run);
    this.draftChain = p.catch(() => undefined);
    return p;
  }

  async newDraft(): Promise<DraftBill> {
    const d = emptyDraft(this.uuid(), this.now());
    await this.saveDraft(d);
    return d;
  }

  // ---- Parked bills (kept on the till) ----

  async park(draft: DraftBill, label: string): Promise<void> {
    const p: ParkedBill = { id: draft.id, parkedAt: this.now().toISOString(), label, draft };
    await this.store.set(`${PARKED}${draft.id}`, p);
  }

  async parked(): Promise<ParkedBill[]> {
    return (await this.store.entries<ParkedBill>(PARKED)).map(([, v]) => v).sort((a, b) => (a.parkedAt < b.parkedAt ? -1 : 1));
  }

  async recall(id: string): Promise<DraftBill | null> {
    const p = await this.store.get<ParkedBill>(`${PARKED}${id}`);
    if (!p) return null;
    await this.store.delete(`${PARKED}${id}`);
    await this.saveDraft(p.draft);
    return p.draft;
  }

  // ---- Shift ----

  defaultCashMethodId(): string | null {
    const methods = this.state.snapshot?.till.paymentMethods.filter((m) => m.active) ?? [];
    return (methods.find((m) => m.kind === "cash" && m.isDefault) ?? methods.find((m) => m.kind === "cash"))?.id ?? null;
  }

  /** Opens the shift here at once and sends it (works offline, pos-offline §8). */
  async openShift(startingCash: string, openedByName: string): Promise<LocalShift> {
    if (this.state.shift) throw new Error("A shift is already open on this till");
    const cashId = this.defaultCashMethodId();
    const amount = new Decimal(startingCash || "0");
    if (amount.isNegative()) throw new Error("Starting cash cannot be below zero");
    const at = this.now();
    const clientId = this.uuid();
    const shift: LocalShift = { clientId, id: null, businessDate: businessDate(at), openedAt: at.toISOString(), openedByName, openingCash: cashId ? [{ paymentMethodId: cashId, amount: amount.toFixed(2) }] : [] };
    const payload: OpenShiftInput = { clientId, tillId: this.device.tillId, openedAt: at.toISOString(), cash: shift.openingCash };
    await this.queue.enqueue({ clientId, kind: "shift_open", label: `Shift opened ${shift.businessDate}`, payload });
    await this.store.set(SHIFT_KEY, shift);
    this.set({ shift });
    await this.updateCounts();
    void this.sync();
    return shift;
  }

  async cashMovement(direction: "in" | "out", amount: string, reason: string): Promise<void> {
    const shift = this.state.shift;
    if (!shift) throw new Error("Open a shift first");
    const a = new Decimal(amount || "0");
    if (a.lte(0)) throw new Error("Enter an amount above zero");
    if (!reason.trim()) throw new Error("Give a reason");
    const clientId = this.uuid();
    await this.queue.enqueue({
      clientId,
      kind: "cash_movement",
      label: `Cash ${direction} ₹${a.toFixed(2)}`,
      shiftClientId: shift.clientId,
      payload: { clientId, direction, amount: a.toFixed(2), reason: reason.trim(), at: this.now().toISOString() },
    });
    await this.updateCounts();
    void this.sync();
  }

  /** Closing needs the connection and an empty queue, so the count is checked against every bill (pos-offline §8). */
  async closingInfo(): Promise<{ shift: ServerShift; approvalAmount: string }> {
    const { waiting } = await this.queue.counts();
    if (waiting > 0) throw new Error(`${waiting} ${waiting === 1 ? "entry is" : "entries are"} still waiting to be sent; the shift can be closed once they are sent`);
    if (!this.state.online) throw new Error("Closing a shift needs the connection");
    const shift = await this.syncShift();
    if (!shift) throw new Error(this.shiftProblem ?? "This till has no open shift on the server");
    const settings = await this.api.settings().catch(() => ({ cashDifferenceApprovalAmount: "100.00" }));
    return { shift, approvalAmount: settings.cashDifferenceApprovalAmount };
  }

  async closeShift(shiftId: string, body: Parameters<TillApi["closeShift"]>[1]): Promise<ServerShift> {
    const { waiting } = await this.queue.counts();
    if (waiting > 0) throw new Error(`${waiting} still waiting to be sent`);
    const closed = await this.api.closeShift(shiftId, body);
    await this.store.delete(SHIFT_KEY);
    this.set({ shift: null });
    return closed;
  }

  // ---- Working out and finishing a bill ----

  price(draft: DraftBill): ComputedBill | null {
    const snapshot = this.state.snapshot;
    if (!snapshot) return null;
    return priceBill(draft, { snapshot, date: this.today() });
  }

  /**
   * Finishes a paid bill. Online it is saved at once and the server's receipt
   * printed; if the server cannot be reached it goes to the queue as an offline
   * bill with what was charged, and the till's own receipt is printed.
   * A bill paid on account is never queued: it needs the server's credit check.
   * Nor is a return without a bill: the server checks the manager's approval.
   * A line the server finds below cost comes back as BelowCostError, so a
   * manager can approve it and the same bill is sent again.
   */
  async finish(input: DraftBill, options: FinishOptions = {}): Promise<FinishResult> {
    const snapshot = this.state.snapshot;
    const shift = this.state.shift;
    if (!snapshot) throw new Error("The till has no price list yet; connect once to download it");
    if (!shift) throw new Error("Open a shift first");
    const draft: DraftBill = { ...input, numbers: { ...input.numbers } };
    const soldAt = draft.soldAt ? new Date(draft.soldAt) : this.now();
    const date = businessDate(soldAt);
    if (shift.businessDate !== date) throw new Error(`This till's shift is from ${shift.businessDate}; close it and open a new one`);
    const bill = priceBill(draft, { snapshot, date });
    if (bill.problems.length) throw new Error(bill.problems[0]);
    if (bill.approvals.length) throw new Error(bill.approvals[0].reason);
    const methods = snapshot.till.paymentMethods.filter((m) => m.active);
    const pay = checkPayments(bill.due, draft.payments, methods);
    if (pay.problem) throw new Error(pay.problem);
    if (pay.short.gt(0)) throw new Error(bill.net.gte(0) ? `₹${pay.short.toFixed(2)} is still to be paid` : `₹${pay.short.toFixed(2)} is still to be refunded`);
    const onAccount = usesOnAccount(draft.payments, methods);
    if (onAccount && !hasNamedCustomer(draft, snapshot.till.walkInCustomerId)) throw new Error(ON_ACCOUNT_NAMED);
    if (onAccount && (!this.state.online || this.state.signedOut)) throw new Error(ON_ACCOUNT_OFFLINE);
    const noBill = isNoBillReturn(draft);
    if (noBill && (!this.state.online || this.state.signedOut)) throw new Error(NO_BILL_RETURN_OFFLINE);
    const needsServer = !!draft.order || !!draft.alteration || bill.credit.gt(0);
    if (needsServer && (!this.state.online || this.state.signedOut)) throw new Error(ORDER_OFFLINE);
    const pointsOrCards = usesPointsOrCards(draft);
    if (pointsOrCards && (!this.state.online || this.state.signedOut)) throw new Error(POINTS_OFFLINE);

    // The identity and the numbers are given once and saved before anything is sent (pos-offline §3–§4).
    draft.clientId = draft.clientId ?? this.uuid();
    draft.soldAt = soldAt.toISOString();
    const { prefix, serverLast } = prefixFor(snapshot, date);
    if (bill.ret && !draft.numbers.ret) draft.numbers.ret = await this.counter.next(prefix, serverLast);
    if (bill.sale && !draft.numbers.sale) draft.numbers.sale = await this.counter.next(prefix, serverLast);
    await this.saveDraft(draft);

    const cashier = this.currentCashier();
    const opts = { clientId: draft.clientId, tillId: this.device.tillId, shiftClientId: shift.clientId, soldAt: draft.soldAt, numbers: draft.numbers };
    const paidCash = draft.payments.some((p) => methods.find((m) => m.id === p.methodId)?.kind === "cash" && p.amount.trim() !== "" && !new Decimal(p.amount).isZero());

    if (this.state.online && !this.state.signedOut) {
      const tx = buildTransaction(draft, bill, methods, { ...opts, offline: false, cashierToken: cashier?.token ?? undefined });
      if (options.creditApprovalToken) tx.creditApprovalToken = options.creditApprovalToken;
      try {
        const result = await this.api.postBill(tx);
        await this.rememberResult(result);
        await this.store.set(LAST_RECEIPTS_KEY, result.receipts);
        await this.newDraft();
        return { receipts: result.receipts, offline: false, change: result.change, paidCash, warnings: result.warnings ?? [] };
      } catch (err) {
        const serverTotal = priceChangedTotal(err);
        if (serverTotal !== null) throw new PriceChangedError(serverTotal, bill.net.toFixed(2));
        const credit = creditOverride(err);
        if (credit !== null) throw new CreditApprovalError(credit);
        const belowCost = belowCostCode(err);
        if (belowCost !== null) {
          // The first line of that item without an approval is the one the server stopped at.
          const line = bill.sale?.lines.find((l) => !l.isFree && l.item.code === belowCost && l.draftKey && !draft.lines.find((d) => d.key === l.draftKey)?.approvalToken);
          if (line?.draftKey) throw new BelowCostError(err instanceof Error ? err.message : String(err), belowCost, line.draftKey);
          throw err;
        }
        if (approvalSpent(err)) {
          // Approvals are single-use; one was used up by an earlier try. Ask for them again.
          await this.saveDraft(withoutApprovals(draft));
          throw new Error(APPROVAL_SPENT);
        }
        if (err instanceof ApiError && err.statusCode === 401) this.set({ signedOut: true });
        else if (isOfflineError(err)) this.set({ online: false });
        else throw err;
        // The bill keeps its identity and numbers; it is not queued.
        if (onAccount) throw new Error(ON_ACCOUNT_DROPPED);
        if (noBill) throw new Error(NO_BILL_RETURN_DROPPED);
        if (needsServer) throw new Error(ORDER_OFFLINE);
        if (pointsOrCards) throw new Error(POINTS_DROPPED);
      }
    }
    if (needsServer) throw new Error(ORDER_OFFLINE);
    if (pointsOrCards) throw new Error(POINTS_OFFLINE);
    if (onAccount) throw new Error(ON_ACCOUNT_OFFLINE);
    if (noBill) throw new Error(NO_BILL_RETURN_OFFLINE);

    // Offline: kept on the till and sent when the connection returns.
    const tx = buildTransaction(draft, bill, methods, { ...opts, offline: true });
    const label = [draft.numbers.ret, draft.numbers.sale].filter(Boolean).join(" + ");
    await this.queue.enqueue({ clientId: draft.clientId, kind: "bill", label: `Bill ${label}`, payload: tx, cashierId: cashier?.id });
    // A return of a bill paid with points or gift cards: the server gives those back by itself (plan 13).
    const back = bill.back
      ? [
          ...(bill.back.points > 0 ? [{ paymentMethodId: "points", amount: bill.back.pointsValue.neg().toFixed(2), reference: `${bill.back.points} points back`, name: "Loyalty points" }] : []),
          ...bill.back.giftCards.map((g) => ({ paymentMethodId: "giftcard", amount: g.amount.neg().toFixed(2), reference: g.number, name: "Gift card" })),
        ]
      : [];
    const receipts = localReceipts(bill, draft.numbers, {
      soldAt: draft.soldAt,
      till: snapshot.till,
      payments: [...tx.payments, ...back],
      change: pay.change,
      extras: {
        staff: snapshot.salesStaff,
        salesStaffId: draft.salesStaffId,
        delivery: draft.delivery,
        deliveryCharge: bill.delivery?.charge ?? null,
        buyer: draft.buyer,
        customer: draft.customer ? { name: draft.customer.name, gstin: draft.customer.gstin } : null,
        originalNumber: draft.ret?.originalNumber ?? null,
        // Plan 13: a named customer's points are worked out when the bill reaches the server.
        loyaltyNote: snapshot.till.loyalty && bill.sale && hasNamedCustomer(draft, snapshot.till.walkInCustomerId) ? { scheme: snapshot.till.loyalty.schemeName, note: POINTS_LATER } : null,
      },
    });
    for (const r of receipts) await this.store.set(`${RECENT}${r.number}`, { number: r.number, savedAt: this.now().toISOString(), bill: null, receipts: [r] } satisfies RecentBill);
    await this.store.set(LAST_RECEIPTS_KEY, receipts);
    await this.newDraft();
    await this.updateCounts();
    if (this.state.online) void this.sync();
    return { receipts, offline: true, change: pay.change.toFixed(2), paidCash };
  }

  // ---- Plan 13: points and gift cards (online only) ----

  /** A customer's points: balance, what can be spent today, tier. */
  async customerPoints(customerId: string): Promise<TillCustomerPoints> {
    if (!this.state.online || this.state.signedOut) throw new Error("The points balance needs the connection");
    return this.api.customerPoints(customerId);
  }

  /** Checks a gift card typed or scanned at the till. */
  async checkGiftCard(number: string): Promise<TillGiftCard> {
    if (!this.state.online || this.state.signedOut) throw new Error(POINTS_OFFLINE);
    return this.api.checkGiftCard(number);
  }

  /**
   * Sells a new gift card or loads more onto one (plan 13 §2). Online only;
   * the same sale sent twice (a retry) is saved once, under `clientId`.
   */
  async sellGiftCard(body: { clientId: string; amount: string; paymentMethodId: string; reference?: string | null; number?: string | null; holderName?: string | null; holderPhone?: string | null; customerId?: string | null }): Promise<GiftCardSaleResult> {
    if (!this.state.shift) throw new Error("Open a shift first");
    if (!this.state.online || this.state.signedOut) throw new Error(GIFT_CARD_SALE_OFFLINE);
    try {
      const res = await this.api.sellGiftCard(body);
      await this.store.set(LAST_RECEIPTS_KEY, [res.receipt]);
      return res;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) this.set({ signedOut: true });
      else if (isOfflineError(err)) {
        this.set({ online: false });
        throw new Error(GIFT_CARD_SALE_OFFLINE);
      }
      throw err;
    }
  }

  // ---- Recent bills (returns and reprints) ----

  private async rememberResult(result: TransactionResult): Promise<void> {
    for (const b of [result.sale, result.return]) {
      if (!b) continue;
      const receipts = result.receipts.filter((r) => r.number === b.number);
      await this.store.set(`${RECENT}${b.number}`, { number: b.number, savedAt: this.now().toISOString(), bill: b, receipts } satisfies RecentBill);
    }
  }

  async recentBill(number: string): Promise<RecentBill | null> {
    return (await this.store.get<RecentBill>(`${RECENT}${number.trim()}`)) ?? null;
  }

  async recentBills(): Promise<RecentBill[]> {
    return (await this.store.entries<RecentBill>(RECENT)).map(([, v]) => v).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  async lastReceipts(): Promise<Receipt[]> {
    return (await this.store.get<Receipt[]>(LAST_RECEIPTS_KEY)) ?? [];
  }

  private async pruneRecent(): Promise<void> {
    const cutoff = this.now().getTime() - RECENT_DAYS * 86_400_000;
    for (const [key, r] of await this.store.entries<RecentBill>(RECENT)) {
      if (new Date(r.savedAt).getTime() < cutoff) await this.store.delete(key);
    }
  }

  /**
   * Finds a sale for a return: online by number on the server (any till),
   * otherwise from this till's own recent bills.
   */
  async findBillForReturn(number: string): Promise<BillDto> {
    const n = number.trim();
    if (!n) throw new Error("Type or scan the bill number");
    if (this.state.online) {
      try {
        const { rows } = await this.api.findBills(n);
        const exact = rows.find((b) => b.number.toUpperCase() === n.toUpperCase()) ?? (rows.length === 1 ? rows[0] : undefined);
        if (exact) return exact;
        throw new Error(`Bill ${n} was not found`);
      } catch (err) {
        if (!isOfflineError(err) || !(err instanceof ApiError)) throw err;
        this.set({ online: false });
      }
    }
    const local = await this.recentBill(n);
    if (!local) throw new Error(`Bill ${n} is not on this till; returns of other tills' bills need the connection`);
    if (!local.bill) throw new Error(`Bill ${n} has not reached the server yet; try again once it is sent`);
    return local.bill;
  }
}
