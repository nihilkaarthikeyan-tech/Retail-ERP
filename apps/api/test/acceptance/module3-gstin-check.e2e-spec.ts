// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 15 (owner, 28 October 2026): checking a GSTIN with the GST network. The tests use the fake
// provider (test-env.ts): no network, no credits. Its answer depends on the GSTIN's PAN part.
import type { INestApplication } from '@nestjs/common';
import { gstinCheckCharacter, SYSTEM_ROLES } from 'shared';
import type { App } from 'supertest/types.js';
import { FakeGstinProvider } from '../../src/gst/gstin-check/gstin-provider.js';
import { GstinCheckService } from '../../src/gst/gstin-check/gstin-check.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let fake: FakeGstinProvider;

/** A Tamil Nadu GSTIN with a correct check character for the given PAN. */
const gstin = (pan: string) => {
  const first14 = `33${pan}1Z`;
  return `${first14}${gstinCheckCharacter(first14)}`;
};
const ACTIVE = gstin('ACTVE1234A');
const CANCELLED = gstin('CANCL1234A');
const NOT_FOUND = gstin('NOTFD1234A');
const DOWN = gstin('DOWNN1234A');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  fake = app.get(GstinCheckService).provider as FakeGstinProvider;
});

afterAll(async () => {
  await app.close();
});

describe('plan 15: checking a GSTIN with the GST network', () => {
  it('an active GSTIN comes back with its legal name and address; asking again the same day costs nothing', async () => {
    const before = fake.calls;
    const r = (await owner.post('/gstin/check').send({ gstin: ACTIVE.toLowerCase() }).expect(200)).body;
    expect(r).toMatchObject({ gstin: ACTIVE, status: 'active', message: 'Active on the GST network.', facts: { legalName: 'TEST BUSINESS ACTVE1234A PRIVATE LIMITED', stateCode: '33', pincode: '600017' } });
    await owner.post('/gstin/check').send({ gstin: ACTIVE }).expect(200);
    expect(fake.calls).toBe(before + 1);
  });

  it('a cancelled GSTIN says so plainly, with the date', async () => {
    const r = (await owner.post('/gstin/check').send({ gstin: CANCELLED }).expect(200)).body;
    expect(r.status).toBe('cancelled');
    expect(r.message).toBe('This GSTIN was cancelled on 12 Mar 2026 on the GST portal. Check with the business before issuing a tax invoice to it.');
  });

  it('an unknown GSTIN, and a wrongly typed one', async () => {
    expect((await owner.post('/gstin/check').send({ gstin: NOT_FOUND }).expect(200)).body).toMatchObject({ status: 'not_found', message: 'The GST network has no such GSTIN. Check the number.' });
    // A typing mistake is caught by our own check character, before asking anyone.
    const typo = `${ACTIVE.slice(0, 14)}${ACTIVE[14] === 'A' ? 'B' : 'A'}`;
    const before = fake.calls;
    expect((await owner.post('/gstin/check').send({ gstin: typo }).expect(400)).body.message).toMatch(/typing mistake/);
    expect(fake.calls).toBe(before);
  });

  it('when the GST network cannot be asked, the customer is still saved and checked again later', async () => {
    expect((await owner.post('/gstin/check').send({ gstin: DOWN }).expect(200)).body).toMatchObject({ status: 'unavailable', message: expect.stringMatching(/Could not check with the GST network just now/) });
    const c = (await owner.post('/customers').send({ name: 'Down Traders', gstin: DOWN }).expect(201)).body;
    expect(c.gstinCheck).toBeNull();
    // The nightly re-check finds it again (still down: nothing changes, nothing is lost).
    expect(await app.get(GstinCheckService).recheckShop()).toBe(0);
  });

  it('saving a customer or supplier keeps what the GST network said', async () => {
    const c = (await owner.post('/customers').send({ name: 'Active Traders', gstin: ACTIVE }).expect(201)).body;
    expect(c.gstinCheck).toMatchObject({ status: 'active', legalName: 'TEST BUSINESS ACTVE1234A PRIVATE LIMITED' });
    const s = (await owner.post('/suppliers').send({ name: 'Gone Supplies', gstin: CANCELLED }).expect(201)).body;
    expect(s.gstinCheck).toMatchObject({ status: 'cancelled', cancelledOn: '2026-03-12' });
    // Removing the GSTIN removes the answer.
    const cleared = (await owner.patch(`/customers/${c.id}`).send({ gstin: null }).expect(200)).body;
    expect(cleared.gstinCheck).toBeNull();
  });

  it('the nightly job checks GSTINs again after the interval', async () => {
    const s = await prisma.supplier.findFirstOrThrow({ where: { name: 'Gone Supplies' } });
    await prisma.supplier.update({ where: { id: s.id }, data: { gstinCheckedAt: new Date('2025-01-01T00:00:00Z') } });
    await prisma.gstinCheck.updateMany({ where: { gstin: CANCELLED }, data: { createdAt: new Date('2025-01-01T00:00:00Z') } });
    const before = fake.calls;
    expect(await app.get(GstinCheckService).recheckShop()).toBeGreaterThanOrEqual(1);
    expect(fake.calls).toBeGreaterThan(before);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).gstinCheckedAt!.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
  });

  it('switched off in Settings, nothing is asked', async () => {
    await prisma.gstSettings.updateMany({ data: { gstinChecks: false } });
    const before = fake.calls;
    expect((await owner.post('/gstin/check').send({ gstin: gstin('OFFON1234A') }).expect(200)).body.status).toBe('off');
    expect(fake.calls).toBe(before);
    await prisma.gstSettings.updateMany({ data: { gstinChecks: true } });
  });

  it('only people who may change customers or suppliers can ask', async () => {
    await owner.post('/users').send({ firstName: 'Kavi', email: 'kavi@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, SYSTEM_ROLES.VIEWER_AUDITOR)], allStores: true }).expect(201);
    const kavi = await login(app, 'kavi@rademics.test', 'Temp-pass-1234');
    await kavi.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Kavi-own-pass-9' }).expect(204);
    await kavi.post('/gstin/check').send({ gstin: ACTIVE }).expect(403);
  });
});
