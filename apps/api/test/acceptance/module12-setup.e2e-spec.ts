// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 12":
// 12.6 guided setup, 12.7 getting-started checklist, 12.8 settings centre.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Decimal, financialYearName, indianFinancialYear, MODULE_KEYS, SETTINGS, SETTINGS_SOURCES, type SettingDef, suggestedModules } from 'shared';
import { type Sheet, writeXlsx } from '../../src/imports/spreadsheet.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, resetDatabase, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

/** A fresh browser: no cookies, nothing remembered. */
const browser = () => request(app.getHttpServer());

const PASSWORD = 'Lakshmi-pass-2026';
const YOU = { firstName: 'Lakshmi', lastName: 'Narayanan', email: 'lakshmi@fancy.test' };
const BUSINESS = { legalName: 'Lakshmi Fancy Stores', tradeName: 'Lakshmi Fancy', pan: 'AAACR1234A', stateCode: '33', addressLine1: '12 Second Avenue', city: 'Chennai', pincode: '600040', phone: '9840012345', email: 'shop@fancy.test' };
// The check character of this GSTIN is right (shared gstinCheckCharacter).
const GST = { registered: true, gstin: '33AAACR1234A1ZA', scheme: 'regular', filingFrequency: 'monthly', turnoverBand: '5cr_to_10cr' };
const SHOP = { name: 'Anna Nagar', code: 'ANNA', tills: 2 };

describe('12.6 Guided setup', () => {
  beforeAll(async () => {
    await resetDatabase(prisma);
  });

  it('saves each step; after closing the browser it comes back at step 4 with the answers kept, and never stores the password', async () => {
    expect((await browser().get('/setup/progress').expect(200)).body).toMatchObject({ step: 1, data: {} });
    // A password sent with the answers is dropped, never stored.
    await browser().put('/setup/progress').send({ step: 2, data: { you: { ...YOU, password: PASSWORD } } }).expect(200);
    await browser().put('/setup/progress').send({ step: 3, data: { you: YOU, business: BUSINESS } }).expect(200);
    await browser().put('/setup/progress').send({ step: 4, data: { you: YOU, business: BUSINESS, gst: GST } }).expect(200);

    // The browser is closed; a new one opens the setup again.
    const back = (await browser().get('/setup/progress').expect(200)).body;
    expect(back.step).toBe(4);
    expect(back.data.you).toEqual({ ...YOU });
    expect(back.data.business).toMatchObject(BUSINESS);
    expect(back.data.gst).toEqual(GST);
    const row = await prisma.setupProgress.findUniqueOrThrow({ where: { id: 1 } });
    expect(JSON.stringify(row.data)).not.toContain(PASSWORD);
    expect(JSON.stringify(row.data)).not.toContain('password');
    expect(await prisma.company.count()).toBe(0);
  });

  it('checks each step as it is saved: GSTIN typing mistakes, quarterly returns above ₹5 crore, a GSTIN of another PAN', async () => {
    const bad = (gst: Record<string, unknown>) => browser().put('/setup/progress').send({ step: 4, data: { you: YOU, business: BUSINESS, gst: { ...GST, ...gst } } });
    const typo = (await bad({ gstin: '33AAACR1234A1ZV' }).expect(400)).body;
    expect(typo.errors).toContainEqual({ path: 'data.gst.gstin', message: 'The GSTIN has a typing mistake: its last character does not match' });
    const quarterly = (await bad({ filingFrequency: 'quarterly' }).expect(400)).body;
    expect(quarterly.errors[0]).toMatchObject({ path: 'data.gst.filingFrequency', message: expect.stringMatching(/only for a turnover up to ₹5 crore/) });
    const otherPan = (await bad({ gstin: '33ABCDE1234F1Z7' }).expect(400)).body;
    expect(otherPan.errors[0]).toMatchObject({ path: 'data.gst.gstin', message: 'This GSTIN belongs to PAN ABCDE1234F, not to your PAN AAACR1234A' });
    await browser().put('/setup/progress').send({ step: 9, data: {} }).expect(400);
    // Nothing bad was kept: the answers are still the good ones.
    expect((await browser().get('/setup/progress').expect(200)).body.data.gst).toEqual(GST);
  });

  it('will not finish before every step is answered, and says which step is missing', async () => {
    const res = (await browser().post('/setup/finish').send({ password: PASSWORD }).expect(400)).body;
    expect(res.message).toMatch(/^Step 4, “Your first shop”, is not finished/);
    expect(res.step).toBe(4);
    expect(await prisma.company.count()).toBe(0);
  });

  it('finishing creates the owner, company, GST registration and settings, the year, the first shop and its tills, and switches on the chosen modules', async () => {
    // Step 5: fancy and gift, without home delivery, with alterations (which brings salesperson).
    const modules = { ...suggestedModules('fancy', GST.turnoverBand), delivery: false, alterations: true };
    expect(modules.einvoice).toBe(true);
    await browser().put('/setup/progress').send({ step: 5, data: { you: YOU, business: BUSINESS, gst: GST, shop: SHOP } }).expect(200);
    await browser().put('/setup/progress').send({ step: 6, data: { you: YOU, business: BUSINESS, gst: GST, shop: SHOP, sell: { shopType: 'fancy', modules } } }).expect(200);
    expect((await browser().get('/setup/progress').expect(200)).body.step).toBe(6);

    // A weak password is refused and nothing is made; the answers stay.
    expect((await browser().post('/setup/finish').send({ password: 'short' }).expect(400)).body.message).toMatch(/at least 10/);
    expect(await prisma.company.count()).toBe(0);

    await browser().post('/setup/finish').send({ password: PASSWORD }).expect(201);
    expect((await browser().get('/setup/status').expect(200)).body).toEqual({ needed: false });
    await browser().get('/setup/progress').expect(409);
    await browser().put('/setup/progress').send({ step: 2, data: {} }).expect(409);
    await browser().post('/setup/finish').send({ password: PASSWORD }).expect(409);
    // The saved answers are gone once setup is done.
    expect(await prisma.setupProgress.count()).toBe(0);

    const owner = await login(app, YOU.email, PASSWORD);
    const me = (await owner.get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ firstName: 'Lakshmi', isOwnerAdmin: true, mustChangePassword: false, allStores: true });

    const company = (await owner.get('/company').expect(200)).body;
    expect(company).toMatchObject({ legalName: 'Lakshmi Fancy Stores', tradeName: 'Lakshmi Fancy', pan: 'AAACR1234A', stateCode: '33', code: 'LFS', shopType: 'fancy', checklistHidden: false });

    const registrations = (await owner.get('/company/gst-registrations').expect(200)).body;
    expect(registrations).toEqual([expect.objectContaining({ gstin: '33AAACR1234A1ZA', stateCode: '33', isDefault: true })]);
    const gst = (await owner.get('/gst/settings').expect(200)).body;
    expect(gst).toMatchObject({ scheme: 'regular', filingFrequency: 'monthly', turnoverBand: '5cr_to_10cr', hsnDigits: 6, eInvoiceApplies: true });

    const years = (await owner.get('/financial-years').expect(200)).body;
    expect(years).toEqual([expect.objectContaining({ name: financialYearName(indianFinancialYear()), status: 'open' })]);

    const stores = (await owner.get('/stores').expect(200)).body;
    expect(stores).toEqual([expect.objectContaining({ code: 'ANNA', name: 'Anna Nagar', city: 'Chennai', gstRegistration: expect.objectContaining({ gstin: '33AAACR1234A1ZA' }) })]);

    const tills = (await owner.get('/pos/tills').expect(200)).body as { code: string; name: string; active: boolean; paymentMethods: { paymentMethodId: string; isDefault: boolean }[] }[];
    expect(tills.map((t) => [t.code, t.name, t.active])).toEqual([
      ['T1', 'Till 1', true],
      ['T2', 'Till 2', true],
    ]);
    const methods = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { id: string; code: string }) => [m.id, m.code]));
    for (const t of tills) {
      expect(t.paymentMethods.map((p) => String(methods[p.paymentMethodId])).sort((a, b) => a.localeCompare(b))).toEqual(['CARD', 'CASH', 'UPI']);
      expect(t.paymentMethods.filter((p) => p.isDefault).map((p) => methods[p.paymentMethodId])).toEqual(['CASH']);
    }

    const saved = Object.fromEntries((await prisma.companyModule.findMany()).map((m) => [m.moduleKey, m.enabled]));
    // In the order of MODULE_KEYS: the fancy shop's modules without home delivery, with alterations (and salesperson) and e-invoice.
    expect(MODULE_KEYS.filter((k) => saved[k] !== false)).toEqual(['purchase_orders', 'transfers', 'alterations', 'salesperson', 'offers', 'einvoice']);
    // The fancy shop's starting item groups were made too (plan 12 §2).
    expect(await prisma.itemGroup.count({ where: { name: { in: ['Fashion jewellery', 'Gift articles', 'Stationery'] } } })).toBe(3);

    const history = (await owner.get('/audit').expect(200)).body.rows as { entityType: string; action: string }[];
    expect(history.filter((h) => h.action === 'create').map((h) => h.entityType)).toEqual(expect.arrayContaining(['user', 'company', 'gst_registration', 'gst_settings', 'financial_year', 'store', 'till']));
    expect(history.some((h) => h.action === 'setup' && h.entityType === 'company')).toBe(true);
  });

  it('"Not registered yet" makes no GST registration; the shop and its tills are made the same way', async () => {
    await resetDatabase(prisma);
    const data = { you: YOU, business: { ...BUSINESS, pan: null }, gst: { registered: false }, shop: { name: 'Main Shop', code: 'MAIN', tills: 0 }, sell: { shopType: 'general', modules: suggestedModules('general') } };
    await browser().put('/setup/progress').send({ step: 6, data }).expect(200);
    await browser().post('/setup/finish').send({ password: PASSWORD }).expect(201);
    const owner = await login(app, YOU.email, PASSWORD);
    expect((await owner.get('/company/gst-registrations').expect(200)).body).toEqual([]);
    expect((await owner.get('/stores').expect(200)).body).toEqual([expect.objectContaining({ code: 'MAIN', gstRegistration: null })]);
    expect((await owner.get('/pos/tills').expect(200)).body).toEqual([]);
    expect((await owner.get('/company').expect(200)).body.shopType).toBe('general');
  });
});

// ---------------------------------------------------------------------------

describe('12.7 Getting-started checklist', () => {
  let owner: Agent;
  let MAIN: string;
  let loc: Record<string, string>;
  let pm: Record<string, string>;
  let tillId: string;

  const step = async (key: string) => ((await owner.get('/getting-started').expect(200)).body.steps as { key: string; done: boolean; note: string | null }[]).find((s) => s.key === key)!;

  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
    MAIN = await storeId(prisma, 'MAIN');
    loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
    pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  });

  it('shows the open steps, each with its screen; only the owner sees it', async () => {
    const list = (await owner.get('/getting-started').expect(200)).body;
    expect(list).toMatchObject({ hidden: false, doneCount: 0, total: 8 });
    expect(list.steps.map((s: { key: string; href: string; done: boolean }) => [s.key, s.href, s.done])).toEqual([
      ['tills', '/pos/tills', false],
      ['items', '/imports', false],
      ['opening_stock', '/stock/counts/new', false],
      ['staff', '/users/new', false],
      ['letterhead', '/printing', false],
      ['gst_rates', '/pos/gst-rates', false],
      ['test_bill', '/till', false],
      ['go_live', '/go-live', false],
    ]);
    await owner.post('/users').send({ firstName: 'Arun', email: 'arun@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'cashier')], storeIds: [MAIN] }).expect(201);
    const cashier = await login(app, 'arun@rademics.test', 'Temp-pass-1234');
    await cashier.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await cashier.get('/getting-started').expect(403);
    await cashier.put('/getting-started').send({ hidden: true }).expect(403);
    // Adding the cashier ticked "staff".
    expect(await step('staff')).toMatchObject({ done: true, note: '1 person besides you' });
  });

  it('adding a till, importing items, loading stock, adding GST rates and making a test bill tick their steps', async () => {
    const list = (await owner.get('/price-lists').expect(200)).body.find((l: { code: string }) => l.code === 'STD-SELL');
    tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: list.id, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body.id;
    expect(await step('tills')).toMatchObject({ done: true, note: '1 till' });

    expect((await step('items')).done).toBe(false);
    await owner.post('/catalogue/item-groups').send({ code: 'GIFT', name: 'Gift articles' }).expect(201);
    const sheet: Sheet = [
      ['Item code', 'Item name', 'Item group code', 'Unit', 'HSN code', 'MRP', 'Selling price', 'Barcode', 'Second barcode', 'Pack unit', 'Pack size', 'Pack barcode'],
      ['', 'Photo frame 5x7', 'GIFT', 'PCS', '4414', 250, 240, '', '', '', null, ''],
      ['', 'Gift box small', 'GIFT', 'PCS', '4819', 60, 55, '', '', '', null, ''],
    ];
    const preview = (await owner.post('/imports/preview').attach('file', writeXlsx('Import', sheet, { textColumns: [0, 2, 3, 4, 7, 8, 9, 11] }), 'items.xlsx').field('options', JSON.stringify({ kind: 'items', mode: 'add' })).expect(200)).body;
    await owner.post(`/imports/${preview.jobId}/run`).expect(200);
    for (let i = 0; i < 100 && (await owner.get(`/imports/${preview.jobId}`).expect(200)).body.status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await step('items')).toMatchObject({ done: true, note: '2 items' });

    const frame = await prisma.item.findFirstOrThrow({ where: { name: 'Photo frame 5x7' } });
    expect((await step('opening_stock')).done).toBe(false);
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: frame.id, countedQuantity: '10', unitCost: '150' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    expect((await step('opening_stock')).done).toBe(true);

    // GST rates: done as soon as one rate is saved (no approval step since 22 Oct 2026).
    await owner.post('/pos/gst-rates').send({ hsnCode: '4414', rate: '12', effectiveFrom: '2026-04-01' }).expect(201);
    expect(await step('gst_rates')).toMatchObject({ done: true, note: expect.stringMatching(/^\d+ rates?$/) });

    // A test bill at the till.
    expect((await step('test_bill')).done).toBe(false);
    const token = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token as string;
    await owner.post('/pos/shifts').set('x-till-token', token).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
    const prefix = (await prisma.till.findUniqueOrThrow({ where: { id: tillId } })).seriesKind;
    await owner
      .post('/pos/bills')
      .set('x-till-token', token)
      .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: `${prefix}/2627/000001`, lines: [{ lineNo: 1, itemId: frame.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '240' }] })
      .expect(201);
    expect((await step('test_bill')).done).toBe(true);

    const all = (await owner.get('/getting-started').expect(200)).body;
    expect(all.steps.filter((s: { done: boolean }) => !s.done).map((s: { key: string }) => s.key)).toEqual(['letterhead', 'go_live']);
    expect(all.doneCount).toBe(6);
  });

  it('the owner can hide the checklist and bring it back; both are in the history', async () => {
    expect((await owner.put('/getting-started').send({ hidden: true }).expect(200)).body.hidden).toBe(true);
    expect((await owner.get('/company').expect(200)).body.checklistHidden).toBe(true);
    expect((await owner.put('/getting-started').send({ hidden: false }).expect(200)).body.hidden).toBe(false);
    await owner.put('/getting-started').send({ hidden: 'yes' }).expect(400);
    const changes = await prisma.auditLog.findMany({ where: { entityType: 'company', action: 'update' }, orderBy: { id: 'asc' } });
    expect(changes.map((c) => (c.changes as { checklistHidden?: { new: boolean } }).checklistHidden?.new)).toEqual([true, false]);
  });
});

// ---------------------------------------------------------------------------

describe('12.8 Settings centre', () => {
  let owner: Agent;
  const values: Record<string, Record<string, unknown>> = {};
  const lookups: Record<string, { id: string; code: string; children?: unknown[] }[]> = {};

  const flatten = (rows: { id: string; code: string; children?: unknown[] }[]): { id: string; code: string }[] => rows.flatMap((r) => [r, ...flatten((r.children ?? []) as { id: string; code: string; children?: unknown[] }[])]);

  /** The default a setting should have on a fresh company, as the API sends it. */
  async function expectedDefault(s: SettingDef): Promise<unknown> {
    if (s.kind === 'reference' && s.lookup?.defaultCode) {
      lookups[s.lookup.url] ??= (await owner.get(s.lookup.url).expect(200)).body;
      return flatten(lookups[s.lookup.url]).find((r) => r.code === s.lookup!.defaultCode)?.id;
    }
    return s.default;
  }

  const same = (s: SettingDef, actual: unknown, expected: unknown) => {
    if ((s.kind === 'money' || s.kind === 'percent') && actual !== null && expected !== null) return new Decimal(actual as string).eq(expected as string);
    return JSON.stringify(actual) === JSON.stringify(expected);
  };

  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
    for (const [key, source] of Object.entries(SETTINGS_SOURCES)) values[key] = (await owner.get(source.get).expect(200)).body;
  });

  it('every setting has a plain label, an explanation and its default; a new company starts on every default', async () => {
    expect(SETTINGS.length).toBeGreaterThan(50);
    for (const s of SETTINGS) {
      expect(s.label.length, s.id).toBeGreaterThan(3);
      expect(s.help.length, s.id).toBeGreaterThan(10);
      expect(s.defaultText.length, s.id).toBeGreaterThan(0);
      expect(Object.keys(values[s.source]), s.id).toContain(s.field);
      // The summary email's figures default to all of them (the API sends the full list).
      if (s.id === 'summaryEmail.figures') continue;
      expect(same(s, values[s.source][s.field], await expectedDefault(s)), `${s.id}: ${JSON.stringify(values[s.source][s.field])}`).toBe(true);
    }
  });

  it('"back to default" restores a setting through its own module’s settings API', async () => {
    const restore = async (id: string, changed: unknown) => {
      const s = SETTINGS.find((x) => x.id === id)!;
      const save = SETTINGS_SOURCES[s.source].save!;
      const send = async (value: unknown) => {
        const body = save.fields ? { ...Object.fromEntries(save.fields.map((f) => [f, values[s.source][f]])), [s.field]: value } : { [s.field]: value };
        values[s.source] = (await owner[save.method === 'PUT' ? 'put' : 'patch'](save.path).send(body).expect(200)).body;
      };
      await send(changed);
      expect(same(s, values[s.source][s.field], changed)).toBe(true);
      await send(await expectedDefault(s));
      expect(same(s, values[s.source][s.field], await expectedDefault(s)), id).toBe(true);
    };
    await restore('catalogue.blockSellingBelowCost', true);
    await restore('purchase.approvalLimit', '75000');
    await restore('pos.cashDifferenceApprovalAmount', '250');
    await restore('gst.hsnDigits', 6);
    await restore('print.paperSize', 'A5');
    await restore('stock.batchPickOrder', 'oldest_first');
    await restore('summaryEmail.sendAt', '07:30');
    const retail = await expectedDefault(SETTINGS.find((x) => x.id === 'parties.defaultCustomerGroupId')!);
    const other = flatten(lookups['/customer-groups']).find((g) => g.id !== retail)!.id;
    await restore('parties.defaultCustomerGroupId', other);
    // Every change went into the history.
    expect(await prisma.auditLog.count({ where: { entityType: { in: ['catalogue_settings', 'purchase_settings', 'pos_settings', 'gst_settings', 'print_settings', 'inventory_settings', 'party_settings', 'summary_email_settings'] } } })).toBeGreaterThanOrEqual(16);
  });

  it('the security settings are shown read only, to the owner only', async () => {
    expect(values.security).toMatchObject({ minPasswordLength: 10, lockoutAttempts: 5, lockoutSeconds: 900, sessionIdleMinutes: 30, sessionMaxHours: 12, singleSessionPerUser: false });
    await owner.put('/settings/security').send({ minPasswordLength: 6 }).expect(404);
    await owner.post('/users').send({ firstName: 'Meena', email: 'meena@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'store_manager')], storeIds: [await storeId(prisma, 'MAIN')] }).expect(201);
    const manager = await login(app, 'meena@rademics.test', 'Temp-pass-1234');
    await manager.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await manager.get('/settings/security').expect(403);
  });
});
