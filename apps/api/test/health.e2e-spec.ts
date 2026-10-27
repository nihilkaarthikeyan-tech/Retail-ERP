// Copyright (c) 2026, Rademics. All rights reserved.
// End-to-end check against the real test database (docker compose up -d).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './helpers.js';

describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reaches PostgreSQL through Prisma without logging in', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
    // Code audit, 27 October 2026: anyone may ask, so nothing about the database server is told.
    expect(res.body.database).toEqual({ connected: true });
  });
});
