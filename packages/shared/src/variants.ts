// Copyright (c) 2026, Rademics. All rights reserved.
// Styles with variants (blueprint 03, process 2; decision 10).

export const MAX_VARIANTS_PER_REQUEST = 500;

export interface AttributeValueChoice {
  attributeId: string;
  /** Values ticked for this attribute, in list order. */
  values: { value: string; shortCode: string }[];
}

export interface VariantCombination {
  values: { attributeId: string; value: string; shortCode: string }[];
  code: string;
  name: string;
}

/** Variant code = parent code + dash + short codes in attribute order. */
export function variantCode(parentCode: string, shortCodes: string[]): string {
  return [parentCode, ...shortCodes].join('-').toUpperCase();
}

export function variantName(parentName: string, values: string[]): string {
  return [parentName, ...values].join(' ');
}

export function combinationCount(choices: AttributeValueChoice[]): number {
  return choices.reduce((n, c) => n * c.values.length, 1);
}

/** Every combination of the ticked values, in attribute order. Throws above the limit. */
export function variantCombinations(parentCode: string, parentName: string, choices: AttributeValueChoice[]): VariantCombination[] {
  if (choices.length === 0 || choices.some((c) => c.values.length === 0)) {
    throw new Error('Tick at least one value for every attribute');
  }
  const count = combinationCount(choices);
  if (count > MAX_VARIANTS_PER_REQUEST) {
    throw new Error(`${count} combinations is more than the limit of ${MAX_VARIANTS_PER_REQUEST} at a time`);
  }
  let partial: VariantCombination['values'][] = [[]];
  for (const choice of choices) {
    partial = partial.flatMap((prefix) =>
      choice.values.map((v) => [...prefix, { attributeId: choice.attributeId, value: v.value, shortCode: v.shortCode }]),
    );
  }
  return partial.map((values) => ({
    values,
    code: variantCode(parentCode, values.map((v) => v.shortCode)),
    name: variantName(parentName, values.map((v) => v.value)),
  }));
}

/** A key that identifies a set of values regardless of order or case, to detect duplicates. */
export function variantValuesKey(values: { attributeId: string; value: string }[]): string {
  return values
    .map((v) => `${v.attributeId}=${v.value.toLowerCase()}`)
    .sort()
    .join('|');
}

/** Numeric attribute: valid if start ≤ value ≤ end and (value − start) is a whole number of steps. */
export function numericValueProblem(value: number, range: { start: number; end: number; step: number }): string | null {
  if (!(range.start < range.end)) return 'Range start must be below its end';
  if (!(range.step > 0)) return 'Step must be above zero';
  if (value < range.start || value > range.end) return `Value must be between ${range.start} and ${range.end}`;
  const steps = (value - range.start) / range.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) return `Value must be a multiple of ${range.step} from ${range.start}`;
  return null;
}

// ---- Size × colour grid (plan 11 C2, C3; owner decision of 16 October 2026) ----

export interface GridVariant {
  id: string;
  values: { attributeId: string; value: string }[];
}

export interface VariantGrid<T extends GridVariant> {
  /** The attribute across the top: the style's last one (sizes, in codes like SHIRT-RED-M). */
  acrossAttributeId: string;
  /** The attribute(s) down the side; null when the style varies by one attribute only (one row). */
  downAttributeIds: string[];
  across: string[];
  /** Row labels; [null] for a single-attribute style. Several attributes are joined with " / ". */
  down: (string | null)[];
  cell(down: string | null, across: string): T | null;
}

/**
 * Lays a style's variants out as a grid: its last attribute across, the others
 * down. Values follow each attribute's own list order when given, then the
 * order they were first seen (numbers in ascending order).
 */
export function variantGrid<T extends GridVariant>(attributeIds: string[], variants: T[], valueOrder: Record<string, string[]> = {}): VariantGrid<T> {
  if (!attributeIds.length) throw new Error('The style does not vary by any attribute');
  const acrossId = attributeIds[attributeIds.length - 1];
  const downIds = attributeIds.slice(0, -1);
  const valueOf = (v: T, attributeId: string) => v.values.find((x) => x.attributeId === attributeId)?.value ?? '';
  const downOf = (v: T) => (downIds.length ? downIds.map((id) => valueOf(v, id)).join(' / ') : null);
  const ordered = (attributeId: string, seen: string[]) => {
    const order = (valueOrder[attributeId] ?? []).map((x) => x.toLowerCase());
    const allNumbers = seen.every((s) => s !== '' && Number.isFinite(Number(s)));
    return [...seen].sort((a, b) => {
      const ia = order.indexOf(a.toLowerCase());
      const ib = order.indexOf(b.toLowerCase());
      if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      return allNumbers ? Number(a) - Number(b) : seen.indexOf(a) - seen.indexOf(b);
    });
  };
  const distinct = <V>(xs: V[]) => [...new Set(xs)];
  const across = ordered(acrossId, distinct(variants.map((v) => valueOf(v, acrossId))));
  let down: (string | null)[] = [null];
  if (downIds.length) {
    // Rows sort by each down attribute in turn.
    const rows = distinct(variants.map((v) => downOf(v)!));
    const orders = downIds.map((id) => ordered(id, distinct(variants.map((v) => valueOf(v, id)))));
    down = rows.sort((a, b) => {
      const pa = a.split(' / ');
      const pb = b.split(' / ');
      for (let i = 0; i < orders.length; i++) {
        const d = orders[i].indexOf(pa[i]) - orders[i].indexOf(pb[i]);
        if (d) return d;
      }
      return 0;
    });
  }
  const cells = new Map(variants.map((v) => [`${downOf(v) ?? ''}|${valueOf(v, acrossId)}`, v]));
  return { acrossAttributeId: acrossId, downAttributeIds: downIds, across, down, cell: (d, a) => cells.get(`${d ?? ''}|${a}`) ?? null };
}
