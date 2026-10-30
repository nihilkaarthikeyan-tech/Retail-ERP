// Copyright (c) 2026, Rademics. All rights reserved.
// Audit session 8 (speed and growth), 29 October 2026: the stock movement report worked out from
// today's stock (not by adding up every earlier movement), the daily email allowance, and the nightly
// clean-up of old sign-ins.
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate } from 'shared';
import { CleanupService } from '../../src/auth/cleanup.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { MailerService } from '../../src/reports/mailer.service.js';
import { type Agent, createTestApp, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
});

afterAll(async () => {
  delete process.env.MAIL_DAILY_LIMIT;
  await app.close();
});

describe('audit 8', () => {
  it('stock movement: opening, in, out and closing agree before, during and after the period', async () => {
    const MAIN = await storeId(prisma, 'MAIN');
    const floor = (await prisma.stockLocation.findFirstOrThrow({ where: { code: 'MAIN-FLOOR' } })).id;
    const pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'APP', name: 'Apparel' }).expect(201)).body;
    const shirt = (await owner.post('/items').send({ name: 'Cotton Shirt', itemGroupId: group.id, baseUnitId: pcs, hsnCode: '6205' }).expect(201)).body;
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: floor, lines: [{ itemId: shirt.id, countedQuantity: '20', unitCost: '500' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    const out = (await owner.post('/stock/documents').send({ kind: 'stock_out', storeId: MAIN, fromLocationId: floor, reason: 'damage', lines: [{ itemId: shirt.id, quantity: '2' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${out.id}/finalise`).expect(200);
    const today = businessDate();
    const row = async (from: string, to: string) => (await owner.get(`/reports/stock-movement?from=${from}&to=${to}`).expect(200)).body.rows.find((r: { itemId: string }) => r.itemId === shirt.id);
    // Today: nothing before, 20 in, 2 out.
    expect(await row(today, today)).toMatchObject({ openingQuantity: '0', inQuantity: '20', outQuantity: '2', closingQuantity: '18', openingValue: '0.00', inValue: '10000.00', outValue: '1000.00', closingValue: '9000.00' });
    // A later period: all of it is the opening.
    expect(await row(addDays(today, 1), addDays(today, 7))).toMatchObject({ openingQuantity: '18', inQuantity: '0', outQuantity: '0', closingQuantity: '18', openingValue: '9000.00' });
    // An earlier period: the movements after it do not count.
    expect(await row(addDays(today, -7), addDays(today, -1))).toBeUndefined();
  });

  it('the daily email allowance keeps room for password and sign-in emails', async () => {
    process.env.MAIL_DAILY_LIMIT = '27'; // 2 for other emails, 25 kept for account emails
    const mailer = app.get(MailerService);
    const msg = { to: ['owner@rademics.test'], subject: 'Daily summary', html: '<p>x</p>', text: 'x' };
    await mailer.send(msg);
    await mailer.send(msg);
    await expect(mailer.send(msg)).rejects.toThrow(/kept for password and sign-in emails/);
    // A password reset still goes out.
    await mailer.send({ ...msg, subject: 'Choose a new password' }, 'account');
    expect((await prisma.mailDay.findFirstOrThrow()).sent).toBe(3);
  });

  it('the nightly clean-up removes sign-ins that ended 90 days ago and keeps the rest', async () => {
    const live = await prisma.session.count();
    expect(live).toBeGreaterThan(0);
    const one = await prisma.session.findFirstOrThrow();
    const old = new Date(Date.now() - 100 * 86_400_000);
    await prisma.session.update({ where: { id: one.id }, data: { expiresAt: old } });
    const removed = await app.get(CleanupService).run();
    expect(removed.sessions).toBe(1);
    expect(await prisma.session.count()).toBe(live - 1);
  });
});
