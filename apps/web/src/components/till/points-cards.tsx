// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 at the till: paying part of a sale with loyalty points or gift
// cards (blueprint 04 process 7; plan 13 §1–§2), and selling or reloading a
// gift card. Both need the connection: balances are checked on the server, so
// the till shows a plain message when it is offline. The server checks every
// limit again when the bill is saved.
"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";
import { addDays, Decimal, formatGiftCardNumber, isValidGiftCardNumber, maskGiftCardNumber, maxRedeemable, normaliseGiftCardNumber, pointsValue, redeemProblem } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/till/format";
import type { DraftBill, DraftGiftCard } from "@/lib/till/pricing";
import type { SnapLoyalty, SnapPaymentMethod, TillCustomerPoints, TillGiftCard } from "@/lib/till/types";

export const POINTS_NEED_CUSTOMER = "Points are for a named customer. Close this and choose the customer with F6 Customer.";
export const NEEDS_CONNECTION = "Needs the connection: the balance is checked on the server.";

interface PointsAndCardsProps {
  /** The scheme's limits; null while Loyalty points is switched off. */
  loyalty: SnapLoyalty | null;
  /** Gift cards switched on. */
  giftCardsOn: boolean;
  online: boolean;
  namedCustomer: boolean;
  /** The customer's points, read when the customer was chosen (null offline or before). */
  customerPoints: TillCustomerPoints | null;
  /** The sale's total (the share of points is worked out on it). */
  billTotal: Decimal;
  /** What is still to pay with cash, card or UPI. */
  due: Decimal;
  points: DraftBill["points"];
  giftCards: DraftGiftCard[];
  onPoints: (p: DraftBill["points"]) => void;
  onGiftCards: (cards: DraftGiftCard[]) => void;
  checkCard: (number: string) => Promise<TillGiftCard>;
}

/** The points and gift card part of the Pay screen (sales only). */

/**
 * These sit inside the payment form, and a form may not hold another form: the browser then
 * submitted the page itself and the till reloaded (launch check, 27 October 2026). So each row
 * is a group whose Enter key does what its button does.
 */
function onEnter(run: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
}

export function PointsAndCards({ loyalty, giftCardsOn, online, namedCustomer, customerPoints, billTotal, due, points, giftCards, onPoints, onGiftCards, checkCard }: PointsAndCardsProps) {
  const [open, setOpen] = useState<"points" | "card" | null>(null);
  const [typed, setTyped] = useState("");
  const [cardNo, setCardNo] = useState("");
  const [card, setCard] = useState<TillGiftCard | null>(null);
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!loyalty && !giftCardsOn) return null;

  const pointValue = loyalty?.pointValue ?? "1";
  const pointsAvailable = customerPoints?.member ? customerPoints.available : 0;
  const most = loyalty ? maxRedeemable({ available: pointsAvailable, minRedeem: loyalty.minRedeem, maxSharePercent: loyalty.maxSharePercent, pointValue, billAmount: billTotal }) : 0;

  function spendPoints(e?: FormEvent) {
    e?.preventDefault();
    if (!loyalty) return;
    const n = Number(typed);
    const why = redeemProblem(n, { available: pointsAvailable, minRedeem: loyalty.minRedeem, maxSharePercent: loyalty.maxSharePercent, pointValue, billAmount: billTotal });
    if (why) return setProblem(why);
    onPoints({ points: n, value: pointsValue(n, pointValue).toFixed(2) });
    setOpen(null);
    setTyped("");
    setProblem(null);
  }

  async function check(e?: FormEvent) {
    e?.preventDefault();
    setProblem(null);
    setCard(null);
    const n = normaliseGiftCardNumber(cardNo);
    if (!isValidGiftCardNumber(n)) return setProblem("That gift card number is not right; check the digits");
    if (giftCards.some((g) => g.number === n)) return setProblem("This card is already on the bill");
    setBusy(true);
    try {
      const c = await checkCard(n);
      if (c.problem) return setProblem(c.problem);
      if (new Decimal(c.balance).lte(0)) return setProblem("There is no money left on this card");
      setCard(c);
      setAmount(Decimal.min(new Decimal(c.balance), due).toFixed(2));
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function applyCard(e?: FormEvent) {
    e?.preventDefault();
    if (!card) return;
    let a: Decimal;
    try {
      a = new Decimal(amount || "0");
    } catch {
      return setProblem("The amount is not a number");
    }
    if (a.lte(0)) return setProblem("Enter an amount above zero");
    if (a.gt(new Decimal(card.balance))) return setProblem(`The card has only ${rupees(card.balance)}`);
    if (a.gt(due)) return setProblem(`Only ${rupees(due)} is left to pay`);
    onGiftCards([...giftCards, { number: normaliseGiftCardNumber(card.number), masked: maskGiftCardNumber(card.number), amount: a.toFixed(2), balance: card.balance }]);
    setOpen(null);
    setCard(null);
    setCardNo("");
    setAmount("");
  }

  const pointsBlocked = !online ? NEEDS_CONNECTION : !namedCustomer ? POINTS_NEED_CUSTOMER : customerPoints && !customerPoints.member ? (customerPoints.reason ?? "This customer is not in the loyalty scheme") : null;
  return (
    <section className="till-pay-special" aria-label="Points and gift cards">
      <div className="till-pay-methods" role="group" aria-label="Points and gift cards">
        {loyalty ? (
          <button type="button" className="till-key till-method" disabled={!!pointsBlocked} title={pointsBlocked ?? undefined} onClick={() => setOpen(open === "points" ? null : "points")}>
            Pay with points{!online ? " (needs the connection)" : ""}
          </button>
        ) : null}
        {giftCardsOn ? (
          <button type="button" className="till-key till-method" disabled={!online} title={!online ? NEEDS_CONNECTION : undefined} onClick={() => setOpen(open === "card" ? null : "card")}>
            Gift card{!online ? " (needs the connection)" : ""}
          </button>
        ) : null}
      </div>
      {loyalty && namedCustomer && online && customerPoints && !customerPoints.member ? <p className="muted">{customerPoints.reason ?? "This customer is not in the loyalty scheme"}</p> : null}

      {open === "points" && loyalty ? (
        <div className="till-row" role="group" aria-label="Pay with points" onKeyDown={onEnter(() => spendPoints())}>
          <p className="muted">
            {customerPoints ? `${customerPoints.available} points can be spent today (1 point = ${rupees(pointValue)}). ` : ""}
            {most > 0 ? `Up to ${most} points on this bill; at least ${loyalty.minRedeem}.` : `At least ${loyalty.minRedeem} points, and at most ${loyalty.maxSharePercent}% of the bill.`}
          </p>
          <input className="input till-input-big" inputMode="numeric" aria-label="Points to spend" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} autoFocus />
          <Button variant="primary" onClick={() => spendPoints()}>
            Use points
          </Button>
        </div>
      ) : null}

      {open === "card" ? (
        <div>
          <div className="till-row" role="group" aria-label="Check a gift card" onKeyDown={onEnter(() => void check())}>
            <input className="input till-input-big" inputMode="numeric" aria-label="Gift card number" placeholder="Scan or type the card number" value={cardNo} onChange={(e) => setCardNo(e.target.value)} autoFocus autoComplete="off" />
            <Button busy={busy} onClick={() => void check()}>
              Check
            </Button>
          </div>
          {card ? (
            <div className="till-row" role="group" aria-label="Use the gift card" onKeyDown={onEnter(() => applyCard())}>
              <p data-testid="gift-card-balance">
                Card {maskGiftCardNumber(card.number)}: {rupees(card.balance)} left, valid until {formatDate(addDays(card.expiresOn, -1))}
              </p>
              <input className="input till-input-big" inputMode="decimal" aria-label="Amount from the card" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              <Button variant="primary" onClick={() => applyCard()}>
                Use card
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <Alert kind="error">{problem}</Alert>

      {points?.points || giftCards.length ? (
        <table className="table till-pay-rows" aria-label="Paid with points and gift cards">
          <tbody>
            {points?.points ? (
              <tr>
                <td>Loyalty points ({points.points})</td>
                <td className="num">{rupees(points.value)}</td>
                <td>
                  <Button variant="link" aria-label="Remove points" onClick={() => onPoints(null)}>
                    ✕
                  </Button>
                </td>
              </tr>
            ) : null}
            {giftCards.map((g) => (
              <tr key={g.number}>
                <td>Gift card {g.masked}</td>
                <td className="num">{rupees(g.amount)}</td>
                <td>
                  <Button variant="link" aria-label={`Remove gift card ${g.masked}`} onClick={() => onGiftCards(giftCards.filter((x) => x.number !== g.number))}>
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

interface GiftCardSaleDialogProps {
  open: boolean;
  online: boolean;
  /** The till's money methods (on account and the special methods are left out). */
  methods: SnapPaymentMethod[];
  customer: { id: string | null; name: string; mobile: string | null } | null;
  onSell: (body: { amount: string; paymentMethodId: string; reference: string | null; number: string | null; holderName: string | null; holderPhone: string | null; customerId: string | null }) => Promise<void>;
  onClose: () => void;
}

/** Selling a new gift card or loading more onto one (plan 13 §2): no GST, no stock; it needs the connection. */
export function GiftCardSaleDialog({ open, online, methods, customer, onSell, onClose }: GiftCardSaleDialogProps) {
  const usable = methods.filter((m) => m.active && m.kind !== "on_account");
  const [reload, setReload] = useState(false);
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState(usable.find((m) => m.isDefault)?.id ?? usable[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [holderName, setHolderName] = useState(customer?.name ?? "");
  const [holderPhone, setHolderPhone] = useState(customer?.mobile ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const method = usable.find((m) => m.id === methodId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!online) return setError("Selling or reloading a gift card needs the connection. Try again when the till is online.");
    if (reload && !isValidGiftCardNumber(number)) return setError("That gift card number is not right; check the digits");
    let a: Decimal;
    try {
      a = new Decimal(amount || "0");
    } catch {
      return setError("The amount is not a number");
    }
    if (a.lte(0)) return setError("Enter the amount to load");
    if (!method) return setError("Choose how it is paid");
    if (method.needsReference && !reference.trim()) return setError(`${method.name} needs the approval code or reference`);
    if (holderPhone.trim() && !/^\d{10}$/.test(holderPhone.trim())) return setError("Phone number must be 10 digits");
    setBusy(true);
    try {
      await onSell({
        amount: a.toFixed(2),
        paymentMethodId: method.id,
        reference: reference.trim() || null,
        number: reload ? normaliseGiftCardNumber(number) : null,
        holderName: holderName.trim() || null,
        holderPhone: holderPhone.trim() || null,
        customerId: customer?.id ?? null,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={reload ? "Reload a gift card" : "Sell a gift card"} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p className="muted">A gift card is money kept for the customer: no GST is charged now; GST is charged on the goods bought with it.</p>
        {!online ? <Alert kind="info">Needs the connection: the card is made and checked on the server.</Alert> : null}
        <div className="till-row" role="radiogroup" aria-label="New card or reload">
          <button type="button" role="radio" aria-checked={!reload} className={`till-key${!reload ? " is-selected" : ""}`} onClick={() => setReload(false)}>
            New card
          </button>
          <button type="button" role="radio" aria-checked={reload} className={`till-key${reload ? " is-selected" : ""}`} onClick={() => setReload(true)}>
            Reload a card
          </button>
        </div>
        {reload ? (
          <label className="field">
            <span>Card number</span>
            <input className="input till-input-big" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Scan or type the card number" autoComplete="off" />
            {isValidGiftCardNumber(number) ? <small className="muted">{formatGiftCardNumber(number)}</small> : null}
          </label>
        ) : null}
        <label className="field">
          <span>Amount (₹)</span>
          <input className="input till-input-big" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label className="field">
          <span>Paid by</span>
          <select className="input" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {method?.needsReference ? (
          <label className="field">
            <span>{method.name} approval code / reference</span>
            <input className="input" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
          </label>
        ) : null}
        {!reload ? (
          <>
            <label className="field">
              <span>Holder’s name (optional)</span>
              <input className="input" value={holderName} maxLength={120} onChange={(e) => setHolderName(e.target.value)} />
            </label>
            <label className="field">
              <span>Holder’s phone (optional)</span>
              <input className="input" inputMode="numeric" value={holderPhone} maxLength={10} onChange={(e) => setHolderPhone(e.target.value.replace(/\D/g, ""))} />
            </label>
          </>
        ) : null}
        <Alert kind="error">{error}</Alert>
        <Button type="submit" variant="primary" className="till-big" busy={busy} disabled={!online}>
          {reload ? "Load and print" : "Sell and print"}
        </Button>
      </form>
    </Dialog>
  );
}
