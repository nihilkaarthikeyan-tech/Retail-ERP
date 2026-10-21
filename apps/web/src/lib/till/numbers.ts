// Copyright (c) 2026, Rademics. All rights reserved.
// Bill numbers the till gives itself (pos-offline plan §3): the till's own
// series PREFIX/2627/000001, at most 16 characters as GST requires (plan 08;
// tills set up before keep STORE-TILL-FY-000001 until their prefix is set). The counter is saved BEFORE a number is used,
// so a crash can never hand out the same number twice, and it never goes
// below the last number the server has from this till.
import { tillNumberSeries } from "shared";
import type { KeyValueStore } from "./storage";
import type { TillSnapshot } from "./types";

const DIGITS = 6;

export function formatNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(DIGITS, "0")}`;
}

/** The running number at the end of a bill number of this series, or 0. */
export function numberPart(prefix: string, number: string | null | undefined): number {
  if (!number || !number.startsWith(prefix)) return 0;
  const tail = number.slice(prefix.length);
  return /^\d+$/.test(tail) ? Number(tail) : 0;
}

/** The series prefix for a business date: `${numberPrefix}/2627/` (shared tillNumberSeries). */
export function prefixFor(snapshot: TillSnapshot, date: string): { prefix: string; serverLast: string | null } {
  const year = snapshot.financialYears.find((y) => y.startDate <= date && date <= y.endDate);
  if (!year) throw new Error(`No open financial year covers ${date}; the accountant must open it`);
  const prefix = tillNumberSeries(snapshot.till.numberPrefix, year.name);
  const last = snapshot.lastNumbers.find((n) => n.prefix === prefix);
  return { prefix, serverLast: last?.lastNumber ?? null };
}

export class NumberCounter {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: KeyValueStore) {}

  private key(prefix: string): string {
    return `counter:${prefix}`;
  }

  /** The last number used on this till for the series (0 when none). */
  async last(prefix: string): Promise<number> {
    return (await this.store.get<number>(this.key(prefix))) ?? 0;
  }

  /**
   * Takes the next number. Calls are queued one after the other so two quick
   * bills never read the same counter; the new value is written before the
   * number is returned.
   */
  next(prefix: string, serverLast: string | null): Promise<string> {
    const run = async () => {
      const local = await this.last(prefix);
      const n = Math.max(local, numberPart(prefix, serverLast)) + 1;
      await this.store.set(this.key(prefix), n);
      return formatNumber(prefix, n);
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
