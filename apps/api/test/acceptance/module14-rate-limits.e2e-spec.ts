// Copyright (c) 2026, Rademics. All rights reserved.
// Automated version of docs/acceptance-tests.md, scenario 14.9: rate limits
// on the doors a stranger can knock on (owner, 26 October 2026).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { RATE_LIMITS, TOO_MANY } from '../../src/auth/rate-limit.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { createTestApp, OWNER, resetDatabase, SETUP_INPUT } from '../helpers.js';

let app: INestApplication<App>;

beforeAll(async () => {
  app = await createTestApp();
  await resetDatabase(app.get(SystemPrisma));
  await request(app.getHttpServer()).post('/setup').send(SETUP_INPUT).expect(201);
  process.env.RATE_LIMIT = 'on';
});

afterAll(async () => {
  process.env.RATE_LIMIT = 'off';
  await app.close();
});

const http = () => request(app.getHttpServer());

describe('14.9 Rate limits', () => {
  it('too many logins from one connection are refused with a plain message, even with the right password', async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) await http().post('/auth/login').send({ email: 'nobody@nowhere.test', password: 'wrong-pass-123' }).expect(401);
    const refused = await http().post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(429);
    expect(refused.body.message).toBe(TOO_MANY);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('the contact form takes five messages an hour from one connection', async () => {
    for (let i = 0; i < RATE_LIMITS.contactForm.limit; i++) await http().post('/leads').send({ name: `Visitor ${i}`, phone: '9840012345' }).expect(201);
    await http().post('/leads').send({ name: 'One more', phone: '9840012345' }).expect(429);
  });

  it('one door being shut does not shut the others', async () => {
    await http().get('/health').expect(200);
    await http().post('/auth/forgot-password').send({ email: OWNER.email }).expect(200);
  });
});
