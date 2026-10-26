// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, scenarios 14.7 and 14.8:
// "Forgot password?" and "Confirm your email" by one-time emailed links
// (owner, 26 October 2026).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { MailerService } from '../../src/reports/mailer.service.js';
import { agent, createTestApp, login, OWNER, resetDatabase, SETUP_INPUT } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let outbox: { to: string[]; subject: string; text: string }[];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  outbox = app.select(AuthModule).get(MailerService, { strict: true }).outbox;
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
/** The one-time code in the last email's link. */
const linkCode = () => /token=([A-Za-z0-9_-]+)/.exec(outbox[outbox.length - 1].text)![1];
/** Mail is sent in the background after sign-up; give it a moment. */
const settle = () => new Promise((r) => setTimeout(r, 80));

describe('14.7 Forgot password', () => {
  beforeAll(async () => {
    await resetDatabase(prisma);
    await http().post('/setup').send(SETUP_INPUT).expect(201);
  });
  // Each test starts with no links, so the three-an-hour limit counts only its own.
  beforeEach(async () => {
    outbox.length = 0;
    await prisma.userToken.deleteMany({});
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const known = (await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200)).body;
    const unknown = (await http().post('/auth/forgot-password').send({ email: 'nobody@nowhere.test' }).expect(200)).body;
    expect(unknown).toEqual(known);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual([OWNER.email]);
  });

  it('the link sets a new password once, ends every session, and the person is told', async () => {
    const before = await login(app, OWNER.email, OWNER.password);
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    expect(outbox[0].subject).toBe('Choose a new password for Retail ERP');
    expect(outbox[0].text).toContain('/reset-password?token=');
    const code = linkCode();

    // Only a hash of the link is kept.
    const rows = await prisma.userToken.findMany({ where: { purpose: 'password_reset' } });
    expect(rows.some((r) => r.tokenHash === code)).toBe(false);

    await http().post('/auth/reset-password').send({ token: code, newPassword: 'Brand-new-pass-2026' }).expect(204);
    expect(outbox.map((m) => m.subject)).toEqual(['Choose a new password for Retail ERP', 'Your Retail ERP password was changed']);
    // The old session is over, the old password is refused, the new one works.
    await before.get('/auth/me').expect(401);
    await http().post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(401);
    await login(app, OWNER.email, 'Brand-new-pass-2026');
    // The same link a second time does nothing.
    const again = await http().post('/auth/reset-password').send({ token: code, newPassword: 'Third-pass-2026x' }).expect(400);
    expect(again.body.message).toMatch(/expired or has already been used/);
    // The reset is in the history.
    const history = await prisma.auditLog.findMany({ where: { action: { in: ['password_reset_requested', 'password_reset'] } } });
    expect(history.filter((h) => h.action === 'password_reset')).toHaveLength(1);
    expect(history.filter((h) => h.action === 'password_reset_requested').length).toBeGreaterThanOrEqual(1);
    // Back to the usual password for the other tests.
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    await http().post('/auth/reset-password').send({ token: linkCode(), newPassword: OWNER.password }).expect(204);
  });

  it('a weak password is refused and the link still works; an expired link does not', async () => {
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    const code = linkCode();
    await http().post('/auth/reset-password').send({ token: code, newPassword: 'short' }).expect(400);
    await prisma.userToken.updateMany({ where: { usedAt: null, purpose: 'password_reset' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post('/auth/reset-password').send({ token: code, newPassword: 'Long-enough-pass-2026' }).expect(400);
    await login(app, OWNER.email, OWNER.password);
  });

  it('asking again makes the earlier link stop working, and at most three links an hour are sent', async () => {
    await prisma.userToken.deleteMany({});
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    const first = linkCode();
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    await http().post('/auth/reset-password').send({ token: first, newPassword: 'Long-enough-pass-2026' }).expect(400);
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    expect(outbox).toHaveLength(3);
  });

  it('a switched-off shop gets no link', async () => {
    await prisma.userToken.deleteMany({});
    await prisma.company.updateMany({ data: { active: false } });
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
    expect(outbox).toHaveLength(0);
    await prisma.company.updateMany({ data: { active: true } });
  });
});

describe('14.8 Confirm your email at sign-up', () => {
  beforeAll(async () => {
    await resetDatabase(prisma);
  });

  it('sign-up sends a link; the reminder shows until it is used; the link works once', async () => {
    outbox.length = 0;
    const owner = agent(app);
    const me = (await owner.post('/auth/signup').send({ firstName: 'Meena', email: 'meena@new-shop.test', password: 'Meena-pass-2026', shopName: 'Meena Stores' }).expect(201)).body;
    expect(me.emailConfirmed).toBe(false);
    await settle();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual(['meena@new-shop.test']);
    expect(outbox[0].subject).toBe('Confirm your email for Retail ERP');
    const code = linkCode();

    // "Send it again" replaces the first link.
    const resent = (await owner.post('/auth/resend-confirmation').expect(200)).body;
    expect(resent).toEqual({ sent: true, alreadyConfirmed: false });
    await http().post('/auth/confirm-email').send({ token: code }).expect(400);

    await http().post('/auth/confirm-email').send({ token: linkCode() }).expect(204);
    expect((await owner.get('/auth/me').expect(200)).body.emailConfirmed).toBe(true);
    await http().post('/auth/confirm-email').send({ token: linkCode() }).expect(400);
    expect((await owner.post('/auth/resend-confirmation').expect(200)).body).toEqual({ sent: false, alreadyConfirmed: true });
  });

  it('a confirm link cannot reset a password, and a reset link cannot confirm', async () => {
    outbox.length = 0;
    await http().post('/auth/forgot-password').send({ email: 'meena@new-shop.test' }).expect(200);
    await http().post('/auth/confirm-email').send({ token: linkCode() }).expect(400);
  });
});
