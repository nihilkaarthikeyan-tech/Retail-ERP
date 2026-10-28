// Copyright (c) 2026, Rademics. All rights reserved.
// Owner, 28 October 2026: the official HSN / SAC list of the GST portal, the same for every shop.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { OfficialHsnService } from '../../src/gst/official-hsn.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, setUpCompany } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
});

afterAll(async () => {
  await app.close();
});

describe('the official HSN / SAC list', () => {
  it('is loaded once from the GST portal file, and not again while the file is the same', async () => {
    expect(await prisma.officialHsnCode.count()).toBeGreaterThan(22_000);
    expect(await prisma.officialHsnCode.count({ where: { isService: true } })).toBeGreaterThan(600);
    expect(await app.get(OfficialHsnService).loadIfNew()).toBe(0);
  });

  it('finds codes by their first digits, headings first', async () => {
    const rows = (await owner.get('/catalogue/official-hsn?search=6106').expect(200)).body as { code: string; description: string }[];
    expect(rows[0]).toMatchObject({ code: '6106', description: expect.stringMatching(/BLOUSES/) });
    expect(rows.every((r) => r.code.startsWith('6106'))).toBe(true);
  });

  it('finds codes by words in the description', async () => {
    const rows = (await owner.get('/catalogue/official-hsn?search=beauty%20make-up').expect(200)).body as { code: string }[];
    expect(rows.map((r) => r.code)).toContain('3304');
  });

  it('says whether a code is in the official list', async () => {
    expect((await owner.get('/catalogue/official-hsn/5208').expect(200)).body).toMatchObject({ code: '5208', official: true, description: expect.stringMatching(/COTTON/) });
    expect((await owner.get('/catalogue/official-hsn/6199').expect(200)).body).toMatchObject({ code: '6199', official: false, description: null });
  });

  it('is only for people signed in with catalogue or GST rate rights', async () => {
    await request(app.getHttpServer()).get('/catalogue/official-hsn?search=6106').expect(401);
  });
});
