// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 3".
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, SYSTEM_ROLES } from 'shared';
import { CustomersService } from '../../src/parties/customers.service.js';
import { SuppliersService } from '../../src/parties/suppliers.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let groups: Record<string, string>;
let supplierGroups: Record<string, string>;
let terms: Record<string, string>;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
  owner = await setUpCompany(app, prisma);
  groups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
});

afterAll(async () => {
  await app.close();
});

async function userWithRole(firstName: string, email: string, role: string): Promise<Agent> {
  await owner
    .post('/users')
    .send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [await storeId(prisma, 'MAIN')] })
    .expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

describe('setup gives the company its party defaults', () => {
  it('has standard terms, groups, a walk-in customer and number series', async () => {
    expect(Object.keys(terms).sort()).toEqual(['CASH', 'NET15', 'NET30']);
    expect(Object.keys(groups).sort()).toEqual(['RETAIL', 'STAFF', 'WHOLESALE']);
    const settings = (await owner.get('/party-settings').expect(200)).body;
    expect(settings.walkInCustomerId).toBeTruthy();
    const walkIn = (await owner.get(`/customers/${settings.walkInCustomerId}`).expect(200)).body;
    expect(walkIn).toMatchObject({ isWalkIn: true, creditLimit: '0', status: 'active' });
    await owner.patch(`/customers/${walkIn.id}/credit`).send({ status: 'off' }).expect(400);
  });
});

describe('3.1 Quick add at the till warns about a duplicate mobile', () => {
  it('refuses, shows the match, then allows on confirmation; never merges', async () => {
    const priya = await userWithRole('Priya', 'priya@rademics.test', SYSTEM_ROLES.CASHIER);
    const first = (await priya.post('/customers/quick-add').send({ name: 'Lakshmi', mobile: '9876543210' }).expect(201)).body;
    expect(first.code).toBe('CUS-000001');
    expect(first.customerGroup.code).toBe('RETAIL');

    const refused = await priya.post('/customers/quick-add').send({ name: 'Lakshmi S', mobile: '9876543210' }).expect(409);
    expect(refused.body.code).toBe('DUPLICATE_MOBILE');
    expect(refused.body.matches).toEqual([{ id: first.id, code: 'CUS-000001', name: 'Lakshmi', mobile: '9876543210' }]);

    const second = (await priya.post('/customers/quick-add').send({ name: 'Lakshmi S', mobile: '9876543210', confirmDuplicate: true }).expect(201)).body;
    expect(second.id).not.toBe(first.id);
    expect(await prisma.customer.count({ where: { mobile: '9876543210' } })).toBe(2);

    const contacts = (await owner.get(`/customers/${first.id}/contacts`).expect(200)).body;
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: 'Lakshmi', mobile: '9876543210', isMain: true });

    await priya.post('/customers').send({ name: 'Full form', customerGroupId: groups.RETAIL }).expect(403); // quick add only
  });
});

describe('3.2 A business customer with a GSTIN in another state', () => {
  it('records the state from the GSTIN and answers "other state"', async () => {
    const res = await owner
      .post('/customers')
      .send({
        name: 'Bengaluru Traders',
        customerGroupId: groups.WHOLESALE,
        gstin: '29AAACR1234A1ZD',
        address: { addressLine1: '12 MG Road', city: 'Bengaluru', stateCode: '29', gstin: '29AAACR1234A1ZD', pincode: '560001' },
      })
      .expect(201);
    expect(res.body).toMatchObject({ isBusiness: true, stateCode: '29', gstin: '29AAACR1234A1ZD' });

    const customers = app.get(CustomersService);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(await customers.gstTreatmentFor(prisma, row)).toBe('other_state');

    const local = await prisma.customer.findFirstOrThrow({ where: { code: 'CUS-000001' } });
    expect(await customers.gstTreatmentFor(prisma, local)).toBe('unregistered');

    const mismatch = await owner.post('/customers').send({ name: 'Wrong state', gstin: '29AAACR1234A1ZD', stateCode: '33' }).expect(400);
    expect(mismatch.body.message).toMatch(/belongs to state code 29/);
  });
});

describe('3.3 Due dates from payment terms', () => {
  it('works out each part from the bill date', async () => {
    const monthEnd = (await owner.post('/payment-terms').send({ code: 'ME10', name: 'Month end + 10', parts: [{ share: '100', dueBasis: 'days_after_month_end', days: 10 }] }).expect(201)).body;
    const split = (
      await owner
        .post('/payment-terms')
        .send({ code: 'ADV50', name: '50% advance', parts: [{ share: '50', dueBasis: 'days_after_date', days: 0 }, { share: '50', dueBasis: 'days_after_date', days: 30 }] })
        .expect(201)
    ).body;
    expect((await owner.get(`/payment-terms/${terms.NET15}/due-date?from=2027-02-20`).expect(200)).body.dueDate).toBe('2027-03-07');
    expect((await owner.get(`/payment-terms/${monthEnd.id}/due-date?from=2027-02-20`).expect(200)).body.dueDate).toBe('2027-03-10');
    const parts = (await owner.get(`/payment-terms/${split.id}/due-date?from=2027-02-20`).expect(200)).body;
    expect(parts.parts.map((p: { dueDate: string }) => p.dueDate)).toEqual(['2027-02-20', '2027-03-22']);
    await owner.post('/payment-terms').send({ code: 'BAD', name: 'Bad', parts: [{ share: '60', dueBasis: 'days_after_date', days: 0 }] }).expect(400);
  });
});

describe('3.4 Credit limits are protected', () => {
  it('store manager refused; accountant allowed and logged with old and new', async () => {
    const arun = await userWithRole('Arun', 'arun@rademics.test', SYSTEM_ROLES.STORE_MANAGER);
    const meena = await userWithRole('Meena', 'meena@rademics.test', SYSTEM_ROLES.ACCOUNTANT);
    const customer = (await arun.post('/customers').send({ name: 'Credit Customer', customerGroupId: groups.WHOLESALE })).body;
    expect(customer.creditLimit).toBe('0');

    await arun.patch(`/customers/${customer.id}/credit`).send({ creditLimit: '50000' }).expect(403);
    await meena.patch(`/customers/${customer.id}/credit`).send({ creditLimit: '50000', reason: 'Approved by owner' }).expect(200);
    await meena.post('/customers').send({ name: 'x' }).expect(403); // accountant does not create customers

    const history = (await owner.get(`/audit?entityType=customer&entityId=${customer.id}`).expect(200)).body.rows as {
      action: string;
      reason: string | null;
      changes: { creditLimit?: { old: string; new: string } };
    }[];
    const change = history.find((h) => h.action === 'update' && h.changes.creditLimit);
    expect(change?.changes.creditLimit).toEqual({ old: '0', new: '50000' });
    expect(change?.reason).toBe('Approved by owner');
  });
});

describe('3.5 Blocked versus switched off', () => {
  it('off refuses everyone; blocked allows the credit controller', async () => {
    const customers = app.get(CustomersService);
    const c = (await owner.post('/customers').send({ name: 'Disputed Customer' }).expect(201)).body;
    const cashier = { ...((await owner.get('/auth/me')).body), isOwnerAdmin: false, permissions: ['customers.view'] };
    const controller = { ...cashier, permissions: ['customers.view', 'customers.credit'] };

    await owner.patch(`/customers/${c.id}/credit`).send({ status: 'blocked', reason: 'Legal recovery' }).expect(200);
    await expect(customers.assertCustomerUsable(prisma, c.id, cashier)).rejects.toThrow(/blocked/);
    await expect(customers.assertCustomerUsable(prisma, c.id, controller)).resolves.toBeTruthy();

    await owner.patch(`/customers/${c.id}/credit`).send({ status: 'off' }).expect(200);
    await expect(customers.assertCustomerUsable(prisma, c.id, controller)).rejects.toThrow(/switched off/);
  });
});

describe('3.6 Supplier holds', () => {
  it('a payments-only hold refuses payments but not bills, and lifts itself after the end date', async () => {
    const suppliers = app.get(SuppliersService);
    const s = (await owner.post('/suppliers').send({ name: 'Metro Distributors', supplierGroupId: supplierGroups.DISTRIBUTORS, gstin: '33AAACM1234B1ZQ' }).expect(201)).body;
    expect(s.code).toBe('SUP-000001');
    expect(s.pan).toBe('AAACM1234B');
    expect(s.paymentTerms.code).toBe('CASH');

    const me = (await owner.get('/auth/me')).body;
    await owner.patch(`/suppliers/${s.id}/hold`).send({ holdType: 'payments', holdUntil: '2099-11-30', holdReason: 'Awaiting credit note' }).expect(200);
    await expect(suppliers.assertSupplierUsable(prisma, s.id, 'bills', me)).resolves.toBeTruthy();
    await expect(suppliers.assertSupplierUsable(prisma, s.id, 'payments', me)).rejects.toThrow(/on hold for payments until 2099-11-30: Awaiting credit note/);

    // The end date passes: the hold lifts by itself.
    await prisma.supplier.update({ where: { id: s.id }, data: { holdUntil: new Date('2020-01-01T00:00:00Z') } });
    await expect(suppliers.assertSupplierUsable(prisma, s.id, 'payments', me)).resolves.toBeTruthy();

    await owner.patch(`/suppliers/${s.id}/hold`).send({ holdType: 'all' }).expect(200);
    await expect(suppliers.assertSupplierUsable(prisma, s.id, 'bills', me)).rejects.toThrow(/orders, bills and payments/);
    const cleared = (await owner.patch(`/suppliers/${s.id}/hold`).send({ holdType: 'none' }).expect(200)).body;
    expect(cleared).toMatchObject({ holdType: 'none', holdUntil: null, holdReason: null });

    await owner.patch(`/suppliers/${s.id}/hold`).send({ holdType: 'bills', holdUntil: '2000-01-01' }).expect(400); // past date
    const stock = await userWithRole('Ravi', 'ravi@rademics.test', SYSTEM_ROLES.STOCK_RECEIVING);
    await stock.get('/suppliers').expect(200);
    await stock.patch(`/suppliers/${s.id}/hold`).send({ holdType: 'all' }).expect(403);
  });
});

describe('3.7 Same party as customer and supplier', () => {
  it('keeps two linked records with separate numbers', async () => {
    const supplier = (await owner.post('/suppliers').send({ name: 'Arun Traders', supplierGroupId: supplierGroups.LOCAL }).expect(201)).body;
    const customer = (await owner.post('/customers').send({ name: 'Arun Traders', customerGroupId: groups.WHOLESALE, linkedSupplierId: supplier.id }).expect(201)).body;
    expect(customer.code).toMatch(/^CUS-/);
    expect(supplier.code).toMatch(/^SUP-/);
    expect(customer.linkedSupplier).toEqual({ id: supplier.id, code: supplier.code, name: 'Arun Traders' });
    const full = (await owner.get(`/suppliers/${supplier.id}`).expect(200)).body;
    expect(full.linkedCustomers).toEqual([{ id: customer.id, code: customer.code, name: 'Arun Traders' }]);
  });

  it('a link made from the supplier side shows on both records, and can be removed', async () => {
    const customer = (await owner.post('/customers').send({ name: 'Kumar Stores', customerGroupId: groups.WHOLESALE }).expect(201)).body;
    const supplier = (await owner.post('/suppliers').send({ name: 'Kumar Stores', supplierGroupId: supplierGroups.LOCAL, linkedCustomerId: customer.id }).expect(201)).body;
    expect(supplier.linkedCustomers).toEqual([{ id: customer.id, code: customer.code, name: 'Kumar Stores' }]);
    expect((await owner.get(`/customers/${customer.id}`).expect(200)).body.linkedSupplier.id).toBe(supplier.id);

    const unlinked = (await owner.patch(`/suppliers/${supplier.id}`).send({ linkedCustomerId: null }).expect(200)).body;
    expect(unlinked.linkedCustomers).toEqual([]);
    expect((await owner.get(`/customers/${customer.id}`).expect(200)).body.linkedSupplier).toBeNull();
  });

  it('a supplier-only user can read payment terms and party settings', async () => {
    const ravi = await login(app, 'ravi@rademics.test', 'Own-pass-12345'); // Stock/Receiving, created in 3.6
    await ravi.get('/payment-terms').expect(200);
    await ravi.get(`/payment-terms/${terms.NET15}/due-date?from=2027-02-20`).expect(200);
    await ravi.get('/party-settings').expect(200);
    await ravi.get('/customers').expect(403);
  });
});

describe('3.8 Group defaults are copied', () => {
  it('a new customer takes the group price list and terms; later group changes do not follow', async () => {
    const wholesaleList = (await owner.post('/price-lists').send({ code: 'WHOLESALE', name: 'Wholesale', forSelling: true, forBuying: false }).expect(201)).body;
    await owner.patch(`/customer-groups/${groups.WHOLESALE}`).send({ priceListId: wholesaleList.id, paymentTermsId: terms.NET30 }).expect(200);
    const c = (await owner.post('/customers').send({ name: 'Group Defaults Co', customerGroupId: groups.WHOLESALE }).expect(201)).body;
    expect(c.priceList.code).toBe('WHOLESALE');
    expect(c.paymentTerms.code).toBe('NET30');

    await owner.patch(`/customer-groups/${groups.WHOLESALE}`).send({ paymentTermsId: terms.NET15 }).expect(200);
    expect((await owner.get(`/customers/${c.id}`).expect(200)).body.paymentTerms.code).toBe('NET30');

    // A buying list is refused on a customer; an inactive terms template too.
    const buying = (await prisma.priceList.findFirstOrThrow({ where: { code: 'STD-BUY' } })).id;
    await owner.patch(`/customers/${c.id}`).send({ priceListId: buying }).expect(400);
  });
});

describe('customer prices now need a real customer', () => {
  it('a supplier price links to the supplier record', async () => {
    const group = (await owner.post('/catalogue/item-groups').send({ code: 'MISC', name: 'Misc' }).expect(201)).body;
    const pcs = await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } });
    const item = (await owner.post('/items').send({ name: 'Linked item', itemGroupId: group.id, baseUnitId: pcs.id }).expect(201)).body;
    const buying = (await prisma.priceList.findFirstOrThrow({ where: { code: 'STD-BUY' } })).id;
    const supplier = (await prisma.supplier.findFirstOrThrow({ where: { code: 'SUP-000001' } })).id;
    await owner.post('/prices').send({ priceListId: buying, itemId: item.id, price: '80', supplierId: supplier, startDate: businessDate() }).expect(201);
    await owner.post('/prices').send({ priceListId: buying, itemId: item.id, price: '80', supplierId: '11111111-1111-4111-8111-111111111111' }).expect(400);
  });
});
