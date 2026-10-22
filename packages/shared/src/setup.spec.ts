// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { setupAnswersSchema, setupDraftSchema, setupGstSchema, setupProgressSchema, setupSellSchema, signupSchema } from './schemas/setup.js';
import { changeableHere, matchesSearch, SETTINGS, SETTINGS_SECTIONS, SETTINGS_SOURCES } from './settings-centre.js';
import { GETTING_STARTED_STEPS, indianFinancialYear, SETUP_STEPS, setupTills, suggestedModules, withAllNeeds } from './setup.js';

const GST = { registered: true, gstin: '33AAACR1234A1ZA', scheme: 'regular', filingFrequency: 'quarterly', turnoverBand: 'up_to_5cr' };

describe('guided setup rules (plan 12 §3)', () => {
  it('has six steps, the last one only a summary', () => {
    expect(SETUP_STEPS.map((s) => s.key)).toEqual(['business', 'gst', 'shop', 'sell', 'done']);
  });

  it('the current Indian financial year follows the Indian date, not UTC', () => {
    // 31 March 2027, 19:00 UTC is already 1 April 2027 in India: the new year.
    expect(indianFinancialYear(new Date('2027-03-31T19:00:00Z'))).toEqual({ startDate: '2027-04-01', endDate: '2028-03-31' });
    expect(indianFinancialYear(new Date('2027-03-31T18:00:00Z'))).toEqual({ startDate: '2026-04-01', endDate: '2027-03-31' });
  });

  it('plan 14: sign-up takes the owner and the shop name; the email is kept in small letters', () => {
    const s = signupSchema.parse({ firstName: 'Lakshmi', email: 'L@Fancy.test', mobile: '9840012345', password: 'secret-123456', shopName: ' Sri Lakshmi Fancy ' });
    expect(s).toEqual({ firstName: 'Lakshmi', email: 'l@fancy.test', mobile: '9840012345', password: 'secret-123456', shopName: 'Sri Lakshmi Fancy' });
    expect(signupSchema.safeParse({ ...s, mobile: '12345' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...s, shopName: '' }).success).toBe(false);
  });

  it('checks the GSTIN with its check character and the return rules for the turnover', () => {
    expect(setupGstSchema.safeParse(GST).success).toBe(true);
    expect(setupGstSchema.safeParse({ registered: false }).success).toBe(true);
    expect(setupGstSchema.safeParse({ ...GST, gstin: '33AAACR1234A1ZV' }).error?.issues[0].message).toMatch(/typing mistake/);
    expect(setupGstSchema.safeParse({ ...GST, turnoverBand: 'above_10cr' }).error?.issues[0].path).toEqual(['filingFrequency']);
    expect(setupGstSchema.safeParse({ ...GST, turnoverBand: 'above_10cr', filingFrequency: 'monthly' }).success).toBe(true);
    expect(setupGstSchema.safeParse({ ...GST, scheme: 'composition', filingFrequency: 'monthly' }).error?.issues[0].path).toEqual(['filingFrequency']);
  });

  it('a PAN given on step 2 must be the one inside the GSTIN', () => {
    const r = setupDraftSchema.safeParse({ business: { legalName: 'X', stateCode: '33', pan: 'ABCDE1234F' }, gst: GST });
    expect(r.error?.issues[0]).toMatchObject({ path: ['gst', 'gstin'], message: 'This GSTIN belongs to PAN AAACR1234A, not to your PAN ABCDE1234F' });
  });

  it('step 5 keeps every module, off unless ticked, and refuses unknown ones', () => {
    const sell = setupSellSchema.parse({ shopType: 'fancy', modules: { offers: true } });
    expect(sell.modules.offers).toBe(true);
    expect(sell.modules.variants).toBe(false);
    expect(setupSellSchema.safeParse({ shopType: 'fancy', modules: { rockets: true } }).success).toBe(false);
    expect(setupSellSchema.safeParse({ shopType: 'bakery', modules: {} }).success).toBe(false);
  });

  it('suggests the shop type’s modules, with e-invoice above ₹5 crore, and adds what a ticked module needs', () => {
    expect(suggestedModules('fancy').einvoice).toBe(false);
    expect(suggestedModules('fancy', '5cr_to_10cr').einvoice).toBe(true);
    const m = withAllNeeds({ ...suggestedModules('general'), alterations: true });
    expect(m.salesperson).toBe(true);
  });

  it('makes tills T1, T2…', () => {
    expect(setupTills(2)).toEqual([
      { code: 'T1', name: 'Till 1' },
      { code: 'T2', name: 'Till 2' },
    ]);
    expect(setupTills(0)).toEqual([]);
  });

  it('progress is a step from 1 to 5 with checked answers; finishing needs every step', () => {
    expect(setupProgressSchema.safeParse({ step: 6, data: {} }).success).toBe(false);
    expect(setupProgressSchema.safeParse({ step: 2, data: { gst: { registered: false } } }).success).toBe(true);
    expect(setupAnswersSchema.safeParse({ gst: { registered: false } }).success).toBe(false);
  });

  it('the checklist has the eight steps of plan 12 §4, each with its screen', () => {
    expect(GETTING_STARTED_STEPS.map((s) => s.key)).toEqual(['tills', 'items', 'opening_stock', 'staff', 'letterhead', 'gst_rates', 'test_bill', 'go_live']);
    for (const s of GETTING_STARTED_STEPS) expect(s.href).toMatch(/^\//);
  });
});

describe('settings centre list (plan 12 §5)', () => {
  it('every setting has a unique id, a section, a source, a label, an explanation and a default in words', () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set<string>(SETTINGS_SECTIONS.map((s) => s.key));
    for (const s of SETTINGS) {
      expect(sections.has(s.section), s.id).toBe(true);
      expect(SETTINGS_SOURCES[s.source], s.id).toBeTruthy();
      expect(s.id).toBe(`${s.source}.${s.field}`);
      expect(s.label.length).toBeGreaterThan(3);
      expect(s.help.length).toBeGreaterThan(10);
      expect(s.defaultText.length).toBeGreaterThan(0);
      if (s.kind === 'choice') expect(s.choices?.some((c) => c.value === s.default), s.id).toBe(true);
    }
  });

  it('only settings with a save API and no special screen are changed in the centre', () => {
    expect(changeableHere(SETTINGS.find((s) => s.id === 'pos.liveAllowed')!)).toBe(false);
    expect(changeableHere(SETTINGS.find((s) => s.id === 'security.minPasswordLength')!)).toBe(false);
    expect(changeableHere(SETTINGS.find((s) => s.id === 'pos.printReceiptCopies')!)).toBe(true);
  });

  it('search matches every word typed, in the label, the explanation or the area', () => {
    const copies = SETTINGS.find((s) => s.id === 'pos.printReceiptCopies')!;
    expect(matchesSearch(copies, 'receipt')).toBe(true);
    expect(matchesSearch(copies, 'RECEIPT copies')).toBe(true);
    expect(matchesSearch(copies, 'billing counter')).toBe(true);
    expect(matchesSearch(copies, 'receipt paper')).toBe(false);
    expect(matchesSearch(copies, '  ')).toBe(true);
  });
});
