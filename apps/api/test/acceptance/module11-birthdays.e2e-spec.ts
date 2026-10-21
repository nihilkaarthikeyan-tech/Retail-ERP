// Copyright (c) 2026, Rademics. All rights reserved.
// Automated version of docs/acceptance-tests.md scenario 11.19 (plan 11 C10)
// for the two places added last: the customers Excel import and export, and a
// customer added at the till (sent with the bill, online or offline).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { excelSerialToIso } from 'shared';
import { readXlsx, type Sheet, writeXlsx } from '../../src/imports/spreadsheet.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, OWNER, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let customerGroups: Record<string, string>;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  owner = await setUpCompany(app, prisma);
  customerGroups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
});

afterAll(async () => {
  await app.close();
});

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Uploads a sheet for preview, runs it and waits for it to finish. */
async function importSheet(rows: Sheet, mode = 'add', textColumns: number[] = []) {
  const file = writeXlsx('Import', rows, { textColumns });
  const preview = (await owner.post('/imports/preview').attach('file', file, 'customers.xlsx').field('options', JSON.stringify({ kind: 'customers', mode })).expect(200)).body;
  await owner.post(`/imports/${preview.jobId}/run`).expect(200);
  for (let i = 0; i < 100; i++) {
    const s = (await owner.get(`/imports/${preview.jobId}`).expect(200)).body;
    if (s.status !== 'running') return { preview, status: s };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The import did not finish');
}

const dates = (mobile: string) => prisma.customer.findFirstOrThrow({ where: { mobile }, select: { birthday: true, birthYear: true, anniversary: true, anniversaryYear: true } });

describe('11.19 birthdays and anniversaries in the customers import and export', () => {
  it('customers (not suppliers) have optional Birthday and Anniversary columns, in the template too', async () => {
    const kinds = (await owner.get('/imports/kinds').expect(200)).body as { kind: string; fields: { label: string; type: string }[] }[];
    const labels = (k: string) => kinds.find((x) => x.kind === k)!.fields.map((f) => f.label);
    expect(labels('customers').slice(-2)).toEqual(['Birthday', 'Anniversary']);
    expect(labels('suppliers')).not.toContain('Birthday');
    const template = readXlsx((await owner.get('/imports/templates/customers').buffer(true).parse(binary as never).expect(200)).body as Buffer);
    expect(template[0].slice(-2)).toEqual(['Birthday', 'Anniversary']);
    expect(template[1].slice(-2)).toEqual(['15-08-1990', '20-11']);
  });

  it('a full date gives the day, month and year; a day and month alone gives no year; a wrong date fails its row', async () => {
    const r = await importSheet(
      [
        ['Name', 'Mobile', 'Customer group code', 'Birthday', 'Anniversary'],
        ['Meena R', '9840070001', 'RETAIL', '15-08-1990', '20-11'],
        ['Kumar S', '9840070002', 'RETAIL', '31-02', ''],
        ['Ravi K', '9840070003', 'RETAIL', '', '15/08/2030'],
        ['Divya P', '9840070004', 'RETAIL', 33100, '29 Feb'],
        ['Anand V', '9840070005', 'RETAIL', '', ''],
      ],
      'add',
      [1, 2],
    );
    expect(r.preview).toMatchObject({ rows: 5, ready: 3 });
    expect(r.preview.problems).toEqual([
      { rowNumber: 3, problems: ['Birthday "31-02": not a real day and month'] },
      { rowNumber: 4, problems: [expect.stringMatching(/^Anniversary "15\/08\/2030": the year must be between 1900 and \d{4}$/)] },
    ]);
    expect(r.status).toMatchObject({ added: 3, failed: 2 });
    expect(await dates('9840070001')).toEqual({ birthday: '08-15', birthYear: 1990, anniversary: '11-20', anniversaryYear: null });
    const serial = excelSerialToIso(33100);
    expect(await dates('9840070004')).toEqual({ birthday: serial.slice(5), birthYear: Number(serial.slice(0, 4)), anniversary: '02-29', anniversaryYear: null });
    expect(await dates('9840070005')).toEqual({ birthday: null, birthYear: null, anniversary: null, anniversaryYear: null });
    expect(await prisma.customer.count({ where: { mobile: { in: ['9840070002', '9840070003'] } } })).toBe(0);
  });

  it('in change mode an empty cell leaves the saved date alone; a given one replaces it', async () => {
    const c = (
      await owner
        .post('/customers')
        .send({ name: 'Lakshmi N', customerGroupId: customerGroups.RETAIL, mobile: '9840070011', birthday: '03-12', birthYear: 1985, anniversary: '06-01', anniversaryYear: 2010 })
        .expect(201)
    ).body;
    const r = await importSheet(
      [
        ['Customer code', 'Birthday', 'Anniversary'],
        [c.code, '', '02-06-2012'],
      ],
      'change',
      [0],
    );
    expect(r.status).toMatchObject({ changed: 1, failed: 0 });
    expect(await dates('9840070011')).toEqual({ birthday: '03-12', birthYear: 1985, anniversary: '06-02', anniversaryYear: 2012 });
    const again = await importSheet(
      [
        ['Customer code', 'Birthday'],
        [c.code, '12-03-1985'],
      ],
      'change',
      [0],
    );
    expect(again.status).toMatchObject({ unchanged: 1, failed: 0 });
  });

  it('the export writes the dates day first, and imports back with nothing to change', async () => {
    const rows = readXlsx((await owner.get('/exports/customers').buffer(true).parse(binary as never).expect(200)).body as Buffer);
    expect(rows[0].slice(-2)).toEqual(['Birthday', 'Anniversary']);
    const meena = rows.find((r) => r[2] === '9840070001')!;
    expect(meena.slice(-2)).toEqual(['15-08-1990', '20-11']);
    const textColumns = rows[0].flatMap((h, i) => (['Customer code', 'Mobile', 'Customer group code', 'GSTIN', 'State code', 'Payment terms code', 'PIN code', 'Birthday', 'Anniversary'].includes(String(h)) ? [i] : []));
    const r = await importSheet(rows, 'change', textColumns);
    expect(r.status).toMatchObject({ status: 'done', added: 0, changed: 0, failed: 0, unchanged: rows.length - 1 });
  });
});

describe('11.19 birthdays and anniversaries of a customer added at the till', () => {
  let tillId: string;
  let tillToken: string;
  let shiftClientId: string;
  let cashId: string;
  let soapId: string;
  let n = 0;
  const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
  const charged = { listPrice: '100', price: '100', discountAmount: '0', gstRate: '18', lineTotal: '100' };

  beforeAll(async () => {
    const MAIN = await storeId(prisma, 'MAIN');
    const loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
    const pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
    const listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
    await owner.post('/pos/gst-rates').send({ hsnCode: '3401', rate: '18', effectiveFrom: '2026-04-01' }).expect(201);
    const groupId = (await owner.post('/catalogue/item-groups').send({ code: 'SOAP', name: 'Soap' }).expect(201)).body.id;
    soapId = (await owner.post('/items').send({ name: 'Bath soap', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '3401' }).expect(201)).body.id;
    await owner.post('/prices').send({ priceListId: listId, itemId: soapId, price: '100', startDate: '2026-04-01' }).expect(201);
    const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: soapId, countedQuantity: '50', unitCost: '60' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
    const pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    cashId = pm.CASH;
    tillId = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: cashId, isDefault: true }] }).expect(201)).body.id;
    tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
    await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
    shiftClientId = randomUUID();
    await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: cashId, amount: '2000' }] }).expect(201);
  });

  function bill(newCustomer: Record<string, unknown>, offline: boolean) {
    const line = { lineNo: 1, itemId: soapId, quantity: '1', ...(offline ? { charged } : {}) };
    return {
      clientId: randomUUID(),
      tillId,
      soldAt: new Date(Date.now() - (offline ? 60_000 : 0)).toISOString(),
      sale: { number: `MAT1/2627/${String(++n).padStart(6, '0')}`, lines: [line] },
      payments: [{ paymentMethodId: cashId, amount: '100' }],
      newCustomer: { clientId: randomUUID(), ...newCustomer },
      ...(offline ? { offline: true, shiftClientId } : { expectedTotal: '100.00' }),
    };
  }

  it('online and offline, the dates given at the till are saved on the new customer', async () => {
    const online = (await T(owner.post('/pos/bills')).send(bill({ name: 'Priya S', mobile: '9840080001', birthday: '08-15', birthYear: 1990, anniversary: '11-20', anniversaryYear: null }, false)).expect(201)).body;
    expect(online.sale.checkFlags ?? []).not.toContain('customer_dates_left_out');
    expect(await dates('9840080001')).toEqual({ birthday: '08-15', birthYear: 1990, anniversary: '11-20', anniversaryYear: null });
    await T(owner.post('/pos/bills')).send(bill({ name: 'Arun K', mobile: '9840080002', anniversary: '02-29', anniversaryYear: 2012 }, true)).expect(201);
    expect(await dates('9840080002')).toEqual({ birthday: null, birthYear: null, anniversary: '02-29', anniversaryYear: 2012 });
    // Without dates, as before.
    await T(owner.post('/pos/bills')).send(bill({ name: 'Kavya M', mobile: '9840080003' }, true)).expect(201);
    expect(await dates('9840080003')).toEqual({ birthday: null, birthYear: null, anniversary: null, anniversaryYear: null });
  });

  it('a date that is not real never refuses the bill: it is left out and the bill is marked for checking', async () => {
    const res = (await T(owner.post('/pos/bills')).send(bill({ name: 'Sanjay T', mobile: '9840080004', birthday: '02-29', birthYear: 2023, anniversary: '05-10' }, true)).expect(201)).body;
    expect(res.sale.checkFlags).toContain('customer_dates_left_out');
    expect(await dates('9840080004')).toEqual({ birthday: null, birthYear: null, anniversary: '05-10', anniversaryYear: null });
    // A badly shaped date is refused by the shape check, as any other bad field.
    await T(owner.post('/pos/bills')).send(bill({ name: 'Bad Shape', mobile: '9840080005', birthday: '8/15' }, true)).expect(400);
    n--;
  });
});
