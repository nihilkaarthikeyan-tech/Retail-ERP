// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 1".
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SYSTEM_ROLES } from 'shared';
import { AuditService } from '../../src/audit/audit.service.js';
import { FinancialYearsService } from '../../src/financial-years/financial-years.service.js';
import { NumberingService } from '../../src/numbering/numbering.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  type Agent,
  createTestApp,
  login,
  OWNER,
  resetDatabase,
  roleId,
  SETUP_INPUT,
  setUpCompany,
  storeId,
} from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function createUser(
  by: Agent,
  user: { firstName: string; email: string; password: string; roles: string[]; stores?: string[]; allStores?: boolean },
) {
  const roleIds = await Promise.all(user.roles.map((code) => roleId(prisma, code)));
  const storeIds = await Promise.all((user.stores ?? []).map((code) => storeId(prisma, code)));
  const res = await by
    .post('/users')
    .send({
      firstName: user.firstName,
      email: user.email,
      temporaryPassword: user.password,
      roleIds,
      allStores: user.allStores ?? false,
      storeIds,
      defaultStoreId: storeIds[0] ?? null,
    })
    .expect(201);
  return res.body as { id: string };
}

/** Logs in with a temporary password and completes the forced change. */
async function loginAndChange(email: string, temporary: string, fresh: string): Promise<Agent> {
  const a = await login(app, email, temporary);
  await a.post('/auth/change-password').send({ currentPassword: temporary, newPassword: fresh }).expect(204);
  return a;
}

describe('1.1 First-time setup', () => {
  beforeAll(async () => {
    await resetDatabase(prisma);
  });

  it('creates owner, company, year and store, then refuses a second run', async () => {
    expect((await request(app.getHttpServer()).get('/setup/status').expect(200)).body).toEqual({ needed: true });
    await request(app.getHttpServer()).post('/setup').send(SETUP_INPUT).expect(201);
    expect((await request(app.getHttpServer()).get('/setup/status').expect(200)).body).toEqual({ needed: false });

    owner = await login(app, OWNER.email, OWNER.password);
    const me = (await owner.get('/auth/me').expect(200)).body;
    expect(me.isOwnerAdmin).toBe(true);
    expect(me.mustChangePassword).toBe(false);

    const company = (await owner.get('/company').expect(200)).body;
    expect(company.code).toBe('RRPL');

    const years = (await owner.get('/financial-years').expect(200)).body;
    expect(years).toHaveLength(1);
    expect(years[0]).toMatchObject({ name: '2026-27', status: 'open', isIrregular: false });

    const stores = (await owner.get('/stores').expect(200)).body;
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({ code: 'MAIN', active: true, gstRegistration: { gstin: '33AAACR1234A1ZV' } });

    await request(app.getHttpServer()).post('/setup').send(SETUP_INPUT).expect(409);

    const history = (await owner.get('/audit').expect(200)).body.rows as { entityType: string; action: string; user: { email: string } | null }[];
    const created = history.filter((h) => h.action === 'create').map((h) => h.entityType).sort();
    expect(created).toEqual(['company', 'financial_year', 'gst_registration', 'store', 'user']);
    expect(history.every((h) => h.user?.email === OWNER.email)).toBe(true);
  });
});

describe('1.2 Creating a cashier limited to one store', () => {
  let priya: Agent;
  let mainId: string;
  let annaId: string;

  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
    await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
    mainId = await storeId(prisma, 'MAIN');
    annaId = await storeId(prisma, 'ANNA');
    await createUser(owner, {
      firstName: 'Priya',
      email: 'priya@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.CASHIER],
      stores: ['ANNA'],
    });
  });

  it('forces a password change before anything else', async () => {
    priya = await login(app, 'priya@rademics.test', 'Temp-pass-1234');
    const blocked = await priya.get('/stores').expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await priya
      .post('/auth/change-password')
      .send({ currentPassword: 'Temp-pass-1234', newPassword: 'Priya-own-pass-9' })
      .expect(204);
    expect((await priya.get('/auth/me').expect(200)).body.mustChangePassword).toBe(false);
  });

  it('has no back-office rights and cannot touch the other store', async () => {
    const me = (await priya.get('/auth/me').expect(200)).body;
    // Module 2 gives cashiers item and selling-price lookup only (decision 70).
    expect(me.permissions).toEqual(['catalogue.view', 'prices.view']);
    expect(me.stores.map((s: { code: string }) => s.code)).toEqual(['ANNA']);
    await priya.get('/users').expect(403);
    await priya.get(`/stores/${mainId}`).expect(403); // lacks stores.view at all
  });

  it('a store manager of ANNA cannot read MAIN', async () => {
    await createUser(owner, {
      firstName: 'Arun',
      email: 'arun@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.STORE_MANAGER],
      stores: ['ANNA'],
    });
    const arun = await loginAndChange('arun@rademics.test', 'Temp-pass-1234', 'Arun-own-pass-9');
    const list = (await arun.get('/stores').expect(200)).body;
    expect(list.map((s: { code: string }) => s.code)).toEqual(['ANNA']);
    await arun.get(`/stores/${annaId}`).expect(200);
    await arun.get(`/stores/${mainId}`).expect(403);
  });
});

describe('1.3 Wrong password lockout', () => {
  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
    await createUser(owner, {
      firstName: 'Priya',
      email: 'priya@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.CASHIER],
      stores: ['MAIN'],
    });
  });

  it('locks after 5 failures, refuses the right password, and unlocks after the time', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send({ email: 'priya@rademics.test', password: 'wrong' }).expect(401);
    }
    const locked = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'priya@rademics.test', password: 'Temp-pass-1234' })
      .expect(401);
    expect(locked.body.message).toMatch(/locked/i);

    const logins = (await owner.get('/audit/logins').expect(200)).body.rows as { action: string; user: { email: string } | null }[];
    const priyas = logins.filter((l) => l.user?.email === 'priya@rademics.test');
    expect(priyas.filter((l) => l.action === 'login_failed')).toHaveLength(5);
    expect(priyas.filter((l) => l.action === 'login_locked')).toHaveLength(1);

    // Fifteen minutes pass.
    await prisma.user.update({ where: { email: 'priya@rademics.test' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await login(app, 'priya@rademics.test', 'Temp-pass-1234');
  });
});

describe('1.4 Switching a user off', () => {
  it('blocks login, ends sessions, keeps history with the name', async () => {
    owner = await setUpCompany(app, prisma);
    const { id } = await createUser(owner, {
      firstName: 'Priya',
      email: 'priya@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.CASHIER],
      stores: ['MAIN'],
    });
    const priya = await loginAndChange('priya@rademics.test', 'Temp-pass-1234', 'Priya-own-pass-9');
    await priya.get('/auth/me').expect(200);

    await owner.patch(`/users/${id}`).send({ active: false }).expect(200);

    await priya.get('/auth/me').expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: 'priya@rademics.test', password: 'Priya-own-pass-9' }).expect(401);

    const history = (await owner.get(`/audit?userId=${id}`).expect(200)).body.rows as { user: { firstName: string } }[];
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => h.user.firstName === 'Priya')).toBe(true);
    const users = (await owner.get('/users').expect(200)).body as { email: string; active: boolean }[];
    expect(users.find((u) => u.email === 'priya@rademics.test')?.active).toBe(false);
  });
});

describe('1.4b The last Owner/Admin cannot be removed', () => {
  it('refuses removing the role from, or switching off, the only owner; allows it once another owner exists', async () => {
    owner = await setUpCompany(app, prisma);
    const me = (await owner.get('/auth/me').expect(200)).body as { id: string };
    const accountant = await roleId(prisma, SYSTEM_ROLES.ACCOUNTANT);
    const ownerRole = await roleId(prisma, SYSTEM_ROLES.OWNER_ADMIN);

    const refused = await owner.patch(`/users/${me.id}`).send({ roleIds: [accountant] }).expect(400);
    expect(refused.body.message).toMatch(/only active Owner\/Admin/);
    await owner.patch(`/users/${me.id}`).send({ active: false }).expect(400); // also blocked as "own account"

    const { id: secondId } = await createUser(owner, {
      firstName: 'Second',
      email: 'second@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.OWNER_ADMIN],
      allStores: true,
    });
    await owner.patch(`/users/${secondId}`).send({ roleIds: [accountant] }).expect(200); // not the last owner
    await owner.patch(`/users/${secondId}`).send({ roleIds: [ownerRole] }).expect(200);
    await owner.patch(`/users/${me.id}`).send({ roleIds: [accountant] }).expect(200); // another owner exists now
  });
});

describe('1.4c Every endpoint checks permissions: a cashier is refused', () => {
  it('cannot list financial years, roles or permissions', async () => {
    owner = await setUpCompany(app, prisma);
    await createUser(owner, {
      firstName: 'Priya',
      email: 'priya@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.CASHIER],
      stores: ['MAIN'],
    });
    const priya = await loginAndChange('priya@rademics.test', 'Temp-pass-1234', 'Priya-own-pass-9');
    await priya.get('/financial-years').expect(403);
    await priya.get('/roles').expect(403);
    await priya.get('/permissions').expect(403);
    await priya.get('/company').expect(403);
    await priya.get('/stores').expect(403);
    await priya.get('/number-series').expect(403);
    await priya.get('/audit').expect(403);
    await priya.get('/auth/me').expect(200); // own details are always allowed

    await owner.get('/financial-years').expect(200);
    await owner.get('/roles').expect(200);
    await owner.get('/permissions').expect(200);
  });
});

describe('1.5 Store manager cannot change access rights', () => {
  it('refuses user creation and role changes, and nothing changes', async () => {
    owner = await setUpCompany(app, prisma);
    await createUser(owner, {
      firstName: 'Arun',
      email: 'arun@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.STORE_MANAGER],
      stores: ['MAIN'],
    });
    const arun = await loginAndChange('arun@rademics.test', 'Temp-pass-1234', 'Arun-own-pass-9');
    const cashierRole = await roleId(prisma, SYSTEM_ROLES.CASHIER);
    const usersBefore = await prisma.user.count();
    const cashierRightsBefore = await prisma.rolePermission.count({ where: { roleId: cashierRole } });

    await arun.get('/users').expect(200); // store managers may see the list
    await arun
      .post('/users')
      .send({ firstName: 'X', email: 'x@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [cashierRole] })
      .expect(403);
    await arun.patch(`/roles/${cashierRole}`).send({ permissions: ['users.manage'] }).expect(403);

    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.rolePermission.count({ where: { roleId: cashierRole } })).toBe(cashierRightsBefore);
    expect(await prisma.rolePermission.count({ where: { roleId: cashierRole, permissionKey: 'users.manage' } })).toBe(0);
  });
});

describe('1.6 Financial year rules', () => {
  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
  });

  it('refuses an overlapping year', async () => {
    const res = await owner.post('/financial-years').send({ startDate: '2027-01-01', endDate: '2027-12-31' }).expect(400);
    expect(res.body.message).toMatch(/overlaps/i);
  });

  it('refuses an irregular year unless marked as such', async () => {
    await owner.post('/financial-years').send({ startDate: '2027-04-01', endDate: '2027-12-31' }).expect(400);
  });

  it('creates the next year automatically three days before the end', async () => {
    const years = app.get(FinancialYearsService);
    expect(await years.createNextYearsIfDue('2027-03-27')).toHaveLength(0);
    const created = await years.createNextYearsIfDue('2027-03-28');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: '2027-28', createdAutomatically: true });
    expect(created[0].startDate.toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(created[0].endDate.toISOString().slice(0, 10)).toBe('2028-03-31');
    expect(await years.createNextYearsIfDue('2027-03-29')).toHaveLength(0); // not twice
  });

  it('only Accountant or Owner/Admin may lock a year', async () => {
    const [year] = (await owner.get('/financial-years').expect(200)).body as { id: string; name: string }[];
    await createUser(owner, {
      firstName: 'Priya',
      email: 'priya@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.CASHIER],
      stores: ['MAIN'],
    });
    await createUser(owner, {
      firstName: 'Meena',
      email: 'meena@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.ACCOUNTANT],
      allStores: true,
    });
    const priya = await loginAndChange('priya@rademics.test', 'Temp-pass-1234', 'Priya-own-pass-9');
    await priya.patch(`/financial-years/${year.id}`).send({ status: 'locked' }).expect(403);
    const meena = await loginAndChange('meena@rademics.test', 'Temp-pass-1234', 'Meena-own-pass-9');
    const locked = await meena.patch(`/financial-years/${year.id}`).send({ status: 'locked' }).expect(200);
    expect(locked.body.status).toBe('locked');
  });
});

describe('1.7 Document numbering never repeats', () => {
  let numbering: NumberingService;
  let companyId: string;
  let mainId: string;
  let annaId: string;

  beforeAll(async () => {
    owner = await setUpCompany(app, prisma);
    numbering = app.get(NumberingService);
    companyId = (await prisma.company.findFirstOrThrow()).id;
    await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
    mainId = await storeId(prisma, 'MAIN');
    annaId = await storeId(prisma, 'ANNA');
    await owner.post('/number-series').send({ documentKind: 'sales_invoice', pattern: 'INV-{STORE}-{FY}-' }).expect(201);
  });

  const allocate = (storeId: string) =>
    prisma.$transaction((tx) => numbering.allocate(tx, { companyId, documentKind: 'sales_invoice', storeId, date: '2026-10-14' }));

  it('two tills asking at the same instant get different consecutive numbers', async () => {
    const numbers = (await Promise.all([allocate(mainId), allocate(mainId)])).sort();
    expect(numbers).toEqual(['INV-MAIN-2026-27-00001', 'INV-MAIN-2026-27-00002']);
    expect(await allocate(annaId)).toBe('INV-ANNA-2026-27-00001');
  });

  it('many parallel allocations stay unique', async () => {
    const numbers = await Promise.all(Array.from({ length: 20 }, () => allocate(annaId)));
    expect(new Set(numbers).size).toBe(20);
  });

  it('a number is not consumed when the transaction fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await numbering.allocate(tx, { companyId, documentKind: 'sales_invoice', storeId: mainId, date: '2026-10-14' });
        throw new Error('document failed to save');
      }),
    ).rejects.toThrow('document failed to save');
    expect(await allocate(mainId)).toBe('INV-MAIN-2026-27-00003');
  });

  it('a sale at 00:05 Indian time on 1 April is numbered in the new financial year (CLAUDE.md rule 15)', async () => {
    const years = app.get(FinancialYearsService);
    await years.createNextYearsIfDue('2027-03-28'); // 2027-28 now exists
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 31 March 2027 18:35 UTC = 1 April 2027 00:05 IST: no date passed, so "today" is used.
      vi.setSystemTime(new Date('2027-03-31T18:35:00Z'));
      const afterMidnight = await prisma.$transaction((tx) =>
        numbering.allocate(tx, { companyId, documentKind: 'sales_invoice', storeId: annaId }),
      );
      expect(afterMidnight).toBe('INV-ANNA-2027-28-00001');

      // Twenty minutes earlier (23:45 IST on 31 March) still belongs to 2026-27.
      vi.setSystemTime(new Date('2027-03-31T18:15:00Z'));
      const beforeMidnight = await prisma.$transaction((tx) =>
        numbering.allocate(tx, { companyId, documentKind: 'sales_invoice', storeId: annaId }),
      );
      expect(beforeMidnight).toMatch(/^INV-ANNA-2026-27-/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a date outside any financial year', async () => {
    await expect(
      prisma.$transaction((tx) =>
        numbering.allocate(tx, { companyId, documentKind: 'sales_invoice', storeId: mainId, date: '2030-01-01' }),
      ),
    ).rejects.toThrow(/No financial year/);
  });

  it('the nightly job uses the Indian date (runs last: it resets the company)', async () => {
    // Fresh company so no 2027-28 exists yet.
    owner = await setUpCompany(app, prisma);
    const years = app.get(FinancialYearsService);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 27 March 2027 20:30 UTC is already 28 March in India: three days before year end.
      vi.setSystemTime(new Date('2027-03-27T20:30:00Z'));
      await years.nightly();
      const names = (await prisma.financialYear.findMany()).map((y) => y.name).sort();
      expect(names).toEqual(['2026-27', '2027-28']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('1.8 Counter change is restricted and logged', () => {
  it('store manager refused; owner change applied and audited with reason', async () => {
    owner = await setUpCompany(app, prisma);
    const numbering = app.get(NumberingService);
    const companyId = (await prisma.company.findFirstOrThrow()).id;
    const mainId = await storeId(prisma, 'MAIN');
    const series = (await owner.post('/number-series').send({ documentKind: 'sales_invoice', pattern: 'INV-{STORE}-{FY}-' }).expect(201)).body;
    const allocate = () =>
      prisma.$transaction((tx) => numbering.allocate(tx, { companyId, documentKind: 'sales_invoice', storeId: mainId, date: '2026-10-14' }));
    await allocate();
    await allocate();
    await allocate(); // counter now at 4

    await createUser(owner, {
      firstName: 'Arun',
      email: 'arun@rademics.test',
      password: 'Temp-pass-1234',
      roles: [SYSTEM_ROLES.STORE_MANAGER],
      stores: ['MAIN'],
    });
    const arun = await loginAndChange('arun@rademics.test', 'Temp-pass-1234', 'Arun-own-pass-9');
    await arun
      .patch(`/number-series/${series.id}/counter`)
      .send({ filledPrefix: 'INV-MAIN-2026-27-', nextNumber: 100, reason: 'test' })
      .expect(403);

    await owner
      .patch(`/number-series/${series.id}/counter`)
      .send({ filledPrefix: 'INV-MAIN-2026-27-', nextNumber: 100, reason: 'Continuing from the old software' })
      .expect(200);
    expect(await allocate()).toBe('INV-MAIN-2026-27-00100');

    const history = (await owner.get(`/audit?entityType=number_series&entityId=${series.id}`).expect(200)).body.rows as {
      action: string;
      reason: string;
      changes: { nextNumber: { old: number; new: number } };
      user: { email: string };
    }[];
    const change = history.find((h) => h.action === 'counter_change');
    expect(change).toBeDefined();
    expect(change?.user.email).toBe(OWNER.email);
    expect(change?.reason).toBe('Continuing from the old software');
    expect(change?.changes.nextNumber).toEqual({ old: 4, new: 100 });
  });
});

describe('1.9 History cannot be edited', () => {
  it('the database refuses UPDATE and DELETE on history rows', async () => {
    owner = await setUpCompany(app, prisma);
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'x'`)).rejects.toThrow(/cannot be updated or deleted/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/cannot be updated or deleted/);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
  });
});

describe('1.10 Audit and change are saved together', () => {
  it('a failure after the store row is written rolls back both the store and its history row', async () => {
    owner = await setUpCompany(app, prisma);
    const audit = app.get(AuditService);
    const store = await prisma.store.findFirstOrThrow({ where: { code: 'MAIN' } });
    const rowsBefore = await prisma.auditLog.count();

    await expect(
      prisma.$transaction(async (tx) => {
        const after = await tx.store.update({ where: { id: store.id }, data: { name: 'Renamed Store' } });
        await audit.recordUpdate(tx, { userId: null, ipAddress: null }, 'store', store.id, store, after);
        throw new Error('simulated failure after writing');
      }),
    ).rejects.toThrow('simulated failure');

    expect((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).name).toBe('Main Store');
    expect(await prisma.auditLog.count()).toBe(rowsBefore);
  });
});
