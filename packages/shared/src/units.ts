// Copyright (c) 2026, Rademics. All rights reserved.
// Units, fractions (decision 11) and conversions (blueprint 03).
import { Decimal, type DecimalInput, roundQuantity } from './rounding.js';

export const UNIT_KINDS = ['count', 'weight', 'length', 'volume', 'other'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** Decision 11: fractions only where the unit is weight, length or volume. */
export function fractionsAllowedForKind(kind: UnitKind): boolean {
  return kind === 'weight' || kind === 'length' || kind === 'volume';
}

/** Returns null when the quantity is acceptable for the unit, otherwise the reason. */
export function quantityProblem(quantity: DecimalInput, unit: { code: string; allowsFractions: boolean }): string | null {
  let q: Decimal;
  try {
    q = new Decimal(quantity);
  } catch {
    return 'Quantity must be a number';
  }
  if (!q.isFinite()) return 'Quantity must be a number';
  if (!unit.allowsFractions && !q.isInteger()) return `${unit.code} is counted in whole numbers; ${q.toString()} is not allowed`;
  return null;
}

export interface ConversionRow {
  fromUnitId: string;
  toUnitId: string;
  factor: DecimalInput;
}

function directFactor(fromUnitId: string, toUnitId: string, rows: ConversionRow[]): Decimal | null {
  const direct = rows.find((r) => r.fromUnitId === fromUnitId && r.toUnitId === toUnitId);
  if (direct) return new Decimal(direct.factor);
  const reverse = rows.find((r) => r.fromUnitId === toUnitId && r.toUnitId === fromUnitId);
  if (reverse) return new Decimal(1).div(reverse.factor);
  return null;
}

/**
 * Factor from one unit to another: direct, reverse (1 ÷ factor) or one step
 * through a common unit (blueprint 03, calculations). Null when unknown.
 */
export function conversionFactor(fromUnitId: string, toUnitId: string, rows: ConversionRow[]): Decimal | null {
  if (fromUnitId === toUnitId) return new Decimal(1);
  const direct = directFactor(fromUnitId, toUnitId, rows);
  if (direct) return direct;
  const middles = new Set<string>();
  for (const r of rows) {
    if (r.fromUnitId === fromUnitId) middles.add(r.toUnitId);
    if (r.toUnitId === fromUnitId) middles.add(r.fromUnitId);
  }
  for (const middle of middles) {
    const a = directFactor(fromUnitId, middle, rows);
    const b = directFactor(toUnitId, middle, rows);
    if (a && b) return a.div(b);
  }
  return null;
}

/** Quantity in basic units = quantity entered × basic units per entered unit. */
export function toBasicUnits(quantity: DecimalInput, unitsPerEnteredUnit: DecimalInput): Decimal {
  return roundQuantity(new Decimal(quantity).mul(unitsPerEnteredUnit));
}

/** Price per basic unit = price entered ÷ basic units per entered unit (callers round money). */
export function pricePerBasicUnit(price: DecimalInput, unitsPerEnteredUnit: DecimalInput): Decimal {
  return new Decimal(price).div(unitsPerEnteredUnit);
}
