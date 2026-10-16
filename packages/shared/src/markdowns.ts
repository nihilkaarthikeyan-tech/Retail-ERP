// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C5 (owner decision of 16 October 2026): the markdown tool's new price.
// A percentage off is worked out from the price before the markdown; either
// rule is rounded to the rupee and never goes above the MRP.

import { Decimal, type DecimalInput, roundTo } from './rounding.js';

export interface MarkdownPriceResult {
  /** The new price per basic unit, in whole rupees, as "699.00". */
  price: string;
  /** True when the worked-out price was above the MRP and the MRP was used instead. */
  cappedAtMrp: boolean;
}

/**
 * The new selling price for one item. `oldPrice` is needed for a percentage
 * off; `mrp` (if the item has one) is the ceiling. Returns null when a
 * percentage cannot be applied because there is no old price.
 */
export function markdownPrice(rule: 'percent' | 'price', value: DecimalInput, oldPrice: DecimalInput | null, mrp: DecimalInput | null): MarkdownPriceResult | null {
  let price;
  if (rule === 'percent') {
    if (oldPrice === null) return null;
    price = roundTo(new Decimal(oldPrice).mul(new Decimal(100).sub(value)).div(100), 0);
  } else {
    price = roundTo(value, 0);
  }
  let cappedAtMrp = false;
  if (mrp !== null && price.gt(mrp)) {
    // The MRP may carry paise; a price is never above it, so it is rounded down to the rupee.
    price = new Decimal(mrp).floor();
    cappedAtMrp = true;
  }
  return { price: price.toFixed(2), cappedAtMrp };
}
