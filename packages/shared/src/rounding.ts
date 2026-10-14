// Copyright (c) 2026, Rademics. All rights reserved.
// The one place rounding is defined (reliability rule 2). Decision 5:
// normal commercial rounding, an exact half goes away from zero.

import { Decimal } from 'decimal.js';

export const MONEY_DECIMALS = 2;
export const QUANTITY_DECIMALS = 3;

/** Inputs are strings or Decimals to keep binary floating point out (rule 1). */
export type DecimalInput = string | number | Decimal;

const HALF_AWAY_FROM_ZERO = Decimal.ROUND_HALF_UP;

export function roundTo(value: DecimalInput, places: number): Decimal {
  return new Decimal(value).toDecimalPlaces(places, HALF_AWAY_FROM_ZERO);
}

export function roundMoney(value: DecimalInput): Decimal {
  return roundTo(value, MONEY_DECIMALS);
}

export function roundQuantity(value: DecimalInput): Decimal {
  return roundTo(value, QUANTITY_DECIMALS);
}

/** Fixed-point string for storage and display, e.g. "12.50". */
export function moneyString(value: DecimalInput): string {
  return roundMoney(value).toFixed(MONEY_DECIMALS);
}

export function quantityString(value: DecimalInput): string {
  return roundQuantity(value).toFixed(QUANTITY_DECIMALS);
}

export { Decimal };
