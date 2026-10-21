// Copyright (c) 2026, Rademics. All rights reserved.
// Document number patterns (blueprint 02, process 4). Pure functions so the
// web app can preview numbers and the API can allocate them.

/** FYS: the financial year in four digits ("2026-27" → "2627"), for numbers that must stay short (GST: 16 characters). */
export const NUMBER_PATTERN_TOKENS = ['YYYY', 'YY', 'MM', 'DD', 'FY', 'FYS', 'STORE', 'COMPANY'] as const;
export type NumberPatternToken = (typeof NUMBER_PATTERN_TOKENS)[number];

export interface PatternContext {
  /** ISO date the number is for (today, or the document date). */
  date: string;
  financialYearName: string;
  storeCode?: string;
  companyCode: string;
}

const TOKEN_RE = /\{([A-Z]+)\}/g;

/** Returns the tokens used in a pattern, or throws on an unknown one. */
export function patternTokens(pattern: string): NumberPatternToken[] {
  const found: NumberPatternToken[] = [];
  for (const m of pattern.matchAll(TOKEN_RE)) {
    const token = m[1];
    if (!(NUMBER_PATTERN_TOKENS as readonly string[]).includes(token)) {
      throw new Error(`Unknown token {${token}} in number pattern`);
    }
    found.push(token as NumberPatternToken);
  }
  return found;
}

export function patternUsesStore(pattern: string): boolean {
  return patternTokens(pattern).includes('STORE');
}

/** Replaces every token with its value for this context. */
export function fillPattern(pattern: string, ctx: PatternContext): string {
  patternTokens(pattern); // validate first
  const [year, month, day] = ctx.date.split('-');
  return pattern.replace(TOKEN_RE, (_whole, token: string) => {
    switch (token as NumberPatternToken) {
      case 'YYYY':
        return year;
      case 'YY':
        return year.slice(-2);
      case 'MM':
        return month;
      case 'DD':
        return day;
      case 'FY':
        return ctx.financialYearName;
      case 'FYS': {
        const m = /^(\d{4})-(\d{2}|\d{4})$/.exec(ctx.financialYearName.trim());
        return m ? `${m[1].slice(2)}${m[2].slice(-2)}` : ctx.financialYearName.replace(/[^0-9]/g, '').slice(-4);
      }
      case 'STORE':
        if (!ctx.storeCode) throw new Error('Pattern uses {STORE} but no store was given');
        return ctx.storeCode;
      case 'COMPANY':
        return ctx.companyCode;
    }
  });
}

/** Prefix + counter padded with zeros to the chosen length (longer counters are not cut). */
export function formatNumber(filledPrefix: string, counter: number, counterLength: number): string {
  if (!Number.isInteger(counter) || counter < 1) throw new Error('Counter must be a positive integer');
  return filledPrefix + String(counter).padStart(counterLength, '0');
}
