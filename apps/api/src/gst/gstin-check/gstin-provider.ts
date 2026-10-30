// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 15 (owner, 28 October 2026): asking the GST network about a GSTIN through a provider.
// One small interface, so the provider can be swapped by a setting without touching the screens.

export type GstinNetworkStatus = 'active' | 'cancelled' | 'suspended' | 'inactive' | 'not_found';

export interface GstinFacts {
  status: GstinNetworkStatus;
  legalName: string | null;
  tradeName: string | null;
  stateCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
  taxpayerType: string | null;
}

/** "Could not ask just now": no key, out of credits, the provider or the GST network down. */
export class GstinCheckUnavailable extends Error {
  constructor(
    message: string,
    readonly reason: 'not_configured' | 'out_of_credits' | 'busy' | 'down' | 'refused',
  ) {
    super(message);
  }
}

export interface GstinProvider {
  readonly name: string;
  /**
   * The facts, or `not_found`; throws GstinCheckUnavailable when it cannot say. `patient` (the nightly
   * re-check) tries three times for 15 s each; a person waiting gets one try of 6 s (audit 8).
   */
  lookup(gstin: string, patient?: boolean): Promise<GstinFacts>;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDay = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
};

function statusOf(v: unknown): GstinNetworkStatus {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('suspend')) return 'suspended';
  if (s.includes('active') && !s.includes('inactive')) return 'active';
  return 'inactive';
}

/**
 * gstinapi.in (https://www.gstinapi.in/docs): GET /v1/gstin/{gstin} with the x-api-key header.
 * 200 found (1 credit), 400 bad format, 401/403 key or account, 402 out of credits, 404 not
 * registered (free), 429 rate limit, 502 provider down (free). Only 429 and 502 are retried.
 */
export class GstinApiProvider implements GstinProvider {
  readonly name = 'gstinapi.in';

  constructor(
    private readonly key: string | undefined,
    private readonly baseUrl = 'https://www.gstinapi.in',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async lookup(gstin: string, patient = false): Promise<GstinFacts> {
    const tries = patient ? 3 : 1;
    if (!this.key) throw new GstinCheckUnavailable('GSTIN checks are not set up on this server yet', 'not_configured');
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/v1/gstin/${encodeURIComponent(gstin)}`, { headers: { 'x-api-key': this.key, accept: 'application/json' }, signal: AbortSignal.timeout(patient ? 15_000 : 6_000) });
      } catch {
        if (attempt < tries) {
          await pause(attempt);
          continue;
        }
        throw new GstinCheckUnavailable('The GST network could not be reached just now', 'down');
      }
      if (res.status === 404) return { ...EMPTY, status: 'not_found' };
      if ((res.status === 429 || res.status === 502) && attempt < tries) {
        await pause(attempt);
        continue;
      }
      if (res.status === 402) throw new GstinCheckUnavailable('No GSTIN check credits are left; Rademics will top them up', 'out_of_credits');
      if (res.status === 429) throw new GstinCheckUnavailable('Too many GSTIN checks at once; it will be checked again shortly', 'busy');
      if (res.status === 401 || res.status === 403 || res.status === 400) throw new GstinCheckUnavailable('The GSTIN check service refused the request', 'refused');
      if (!res.ok) throw new GstinCheckUnavailable('The GST network is not answering just now', 'down');
      const body = (await res.json()) as { data?: Record<string, unknown> };
      return factsFrom(body.data ?? {});
    }
  }
}

const EMPTY: Omit<GstinFacts, 'status'> = { legalName: null, tradeName: null, stateCode: null, addressLine1: null, addressLine2: null, city: null, pincode: null, registeredOn: null, cancelledOn: null, taxpayerType: null };

/** The provider's record in our words; the address split as its own parts give it. */
export function factsFrom(d: Record<string, unknown>): GstinFacts {
  const parts = (d.address_details ?? {}) as Record<string, unknown>;
  const line1 = [parts.building_number, parts.building_name, parts.floor].map(text).filter(Boolean).join(', ');
  const line2 = [parts.street, parts.locality, parts.landmark].map(text).filter(Boolean).join(', ');
  return {
    status: statusOf(d.status),
    legalName: text(d.legal_name),
    tradeName: text(d.trade_name),
    stateCode: text(d.state_code),
    addressLine1: line1 || text(d.address),
    addressLine2: line2 || null,
    city: text(parts.city) ?? text(d.city),
    pincode: text(parts.pincode) ?? text(d.pincode),
    registeredOn: isoDay(d.registration_date),
    cancelledOn: isoDay(d.cancellation_date),
    taxpayerType: text(d.taxpayer_type),
  };
}

function pause(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
}

/**
 * For the automated tests (GSTIN_PROVIDER=fake): no network, no credits. The PAN part decides:
 * CANCL… cancelled, SUSPN… suspended, NOTFD… not found, DOWNN… provider down; anything else active.
 */
export class FakeGstinProvider implements GstinProvider {
  readonly name = 'fake';
  calls = 0;

  async lookup(gstin: string): Promise<GstinFacts> {
    this.calls++;
    const pan = gstin.slice(2, 12);
    if (pan.startsWith('DOWNN')) throw new GstinCheckUnavailable('The GST network is not answering just now', 'down');
    if (pan.startsWith('NOTFD')) return { ...EMPTY, status: 'not_found' };
    const status: GstinNetworkStatus = pan.startsWith('CANCL') ? 'cancelled' : pan.startsWith('SUSPN') ? 'suspended' : 'active';
    return {
      ...EMPTY,
      status,
      legalName: `TEST BUSINESS ${pan} PRIVATE LIMITED`,
      tradeName: `Test Business ${pan}`,
      stateCode: gstin.slice(0, 2),
      addressLine1: '12, Test Building',
      addressLine2: 'Test Street',
      city: 'Chennai',
      pincode: '600017',
      registeredOn: '2020-04-01',
      cancelledOn: status === 'cancelled' ? '2026-03-12' : null,
      taxpayerType: 'Regular',
    };
  }
}
