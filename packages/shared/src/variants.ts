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
