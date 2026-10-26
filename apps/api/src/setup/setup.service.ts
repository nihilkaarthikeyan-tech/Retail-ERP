// Copyright (c) 2026, Rademics. All rights reserved.
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  codeFromName,
  type CurrentUser,
  defaultHsnDigits,
  indianFinancialYear,
  type ModuleKey,
  SETUP_STEPS,
  SETUP_TILL_PAYMENT_METHODS,
  type SetupAnswers,
  setupAnswersSchema,
  type SetupDraft,
  setupDraftSchema,
  type SetupInput,
  type SetupProgressInput,
  setupTills,
  type ShopTypeKey,
  type SignupInput,
  SYSTEM_ROLES,
  withAllNeeds,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { AuthService, type LoginMeta, userAccessInclude } from '../auth/auth.service.js';
import { EmailLinksService } from '../auth/email-links.service.js';
import { hashPassword } from '../auth/password.js';
import type { Actor, AuthUser } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ensureGstSettings } from '../gst/gst-core.service.js';
import { applyShopType } from '../modules/shop-type.js';
import { ensurePosDefaults } from '../pos/pos-common.service.js';
import { PosSetupService } from '../pos/pos-setup.service.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { enterCompany } from '../prisma/tenancy.js';
import { StoresService } from '../stores/stores.service.js';
import { CompanyDefaults } from './company-defaults.service.js';

/** The owner of a new shop. */
interface Owner {
  firstName: string;
  lastName: string | null;
  email: string;
  password: string;
}

/** The business details: from the guided steps, or the one-step setup. */
interface ShopDetails {
  company: {
    legalName: string;
    tradeName: string | null;
    pan: string | null;
    stateCode: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    pincode: string | null;
    phone: string | null;
    email: string | null;
  };
  gst: { gstin: string; legalNameOnCertificate: string | null; settings: { scheme: string; filingFrequency: string; turnoverBand: string } | null } | null;
  financialYear: { startDate: string; endDate: string };
  store: { code: string; name: string; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; pincode?: string | null; phone?: string | null; email?: string | null };
  tills: number;
  /** Plan 12: the shop type and the modules chosen; none for the one-step setup (every module stays on). */
  shop: { type: ShopTypeKey; modules: Record<ModuleKey, boolean> } | null;
}

const ALREADY_SIGNED_UP = 'An account with this email already exists. Log in instead.';
/** Plan 14: the free trial of a shop that signs up (owner decision of 22 October 2026). */
const TRIAL_DAYS = 14;

/**
 * Plan 14: a new shop on the shared system.
 *
 * Sign-up makes the shop with its owner's login and every default (roles, units,
 * groups, settings), and logs the owner in. The owner then goes through the
 * guided setup (business, GST, first shop, what you sell), saved step by step so
 * closing the browser loses nothing; "Finish" fills in the shop in one
 * transaction. The one-step setup makes a complete shop in a single call (the
 * API and the automated tests). Every shop is made for itself only: the request
 * switches to the new shop before anything is written.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly company: CompanyService,
    private readonly years: FinancialYearsService,
    private readonly stores: StoresService,
    private readonly posSetup: PosSetupService,
    private readonly defaults: CompanyDefaults,
    private readonly links: EmailLinksService,
  ) {}

  /** For the logged-in person: does their shop still need the guided setup? */
  async status(): Promise<{ needed: boolean }> {
    const company = await this.prisma.company.findFirstOrThrow({ select: { setupCompletedAt: true } });
    return { needed: !company.setupCompletedAt };
  }

  // ---- Sign-up ----

  async signup(input: SignupInput, meta: LoginMeta): Promise<{ token: string; user: CurrentUser; sessionMaxHours: number }> {
    if (await this.system.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ConflictException(ALREADY_SIGNED_UP);
    const companyId = randomUUID();
    const code = await this.freeCompanyCode(input.shopName);
    enterCompany(companyId);
    const owner = { firstName: input.firstName, lastName: input.lastName ?? null, email: input.email, password: input.password };
    const userId = await this.prisma.$transaction(
      async (tx) => {
        const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
        const company = await tx.company.create({ data: { id: companyId, code, legalName: input.shopName, stateCode: '', phone: input.mobile ?? null, email: input.email, trialEndsAt } });
        const admin = await this.createOwner(tx, company.id, owner, meta.ipAddress);
        await this.audit.record(tx, { userId: admin, ipAddress: meta.ipAddress }, { action: 'create', entityType: 'company', entityId: company.id, changes: { code, legalName: company.legalName, signup: true } });
        return admin;
      },
      { timeout: 60_000, maxWait: 15_000 },
    ).catch(alreadySignedUp);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userAccessInclude });
    const settings = await this.auth.securitySettings();
    const session = await this.auth.openSession(user, meta, { userId, ipAddress: meta.ipAddress }, settings);
    // "Confirm your email" goes out in the background; sign-up never waits on the mail server.
    void this.links.sendConfirmation(user, meta.ipAddress).catch(() => undefined);
    return { ...session, sessionMaxHours: settings.sessionMaxHours };
  }

  // ---- Guided setup: answers saved step by step, for the logged-in owner ----

  private assertOwner(user: AuthUser) {
    if (!user.isOwnerAdmin) throw new ForbiddenException('Only the owner sets up the shop');
  }

  private async assertNotSetUp(db: Db = this.prisma) {
    const company = await db.company.findFirstOrThrow({ select: { setupCompletedAt: true } });
    if (company.setupCompletedAt) throw new ConflictException('Setup has already been completed');
  }

  /** Where the guided setup stands: the step to show and the answers so far. */
  async progress(user: AuthUser): Promise<{ step: number; data: SetupDraft; updatedAt: Date | null }> {
    this.assertOwner(user);
    await this.assertNotSetUp();
    const row = await this.prisma.setupProgress.findFirst();
    if (!row) return { step: 1, data: {}, updatedAt: null };
    // Answers saved by an older version that no longer pass are dropped step by step, never the whole lot.
    return { step: row.step, data: cleanDraft(row.data), updatedAt: row.updatedAt };
  }

  /** Saves the answers so far and the step to come back to. Only checked answers are kept. */
  async saveProgress(user: AuthUser, input: SetupProgressInput): Promise<{ step: number; data: SetupDraft; updatedAt: Date }> {
    this.assertOwner(user);
    await this.assertNotSetUp();
    const data = input.data as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.setupProgress.upsert({
      where: { companyId: user.companyId },
      create: { step: input.step, data },
      update: { step: input.step, data },
    });
    return { step: row.step, data: input.data, updatedAt: row.updatedAt };
  }

  /** "Finish": every step answered; fills in the shop in one go. */
  async finish(user: AuthUser, ipAddress: string | null): Promise<{ companyId: string }> {
    this.assertOwner(user);
    await this.assertNotSetUp();
    const row = await this.prisma.setupProgress.findFirst();
    const parsed = setupAnswersSchema.safeParse(row?.data ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const stepKey = String(first.path[0] ?? '');
      const step = SETUP_STEPS.findIndex((s) => s.key === stepKey);
      throw new BadRequestException({
        message: step >= 0 ? `Step ${step + 1}, “${SETUP_STEPS[step].title}”, is not finished: ${first.message}` : `Setup is not finished: ${first.message}`,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        step: step >= 0 ? step + 1 : 1,
      });
    }
    const actor: Actor = { userId: user.id, ipAddress };
    await this.prisma.$transaction(
      async (tx) => {
        // Two "Finish" clicks at once: the second waits here, then finds the shop set up.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('setup-' || ${user.companyId}))`;
        await this.assertNotSetUp(tx);
        await this.fillIn(tx, user.companyId, detailsFromAnswers(parsed.data), actor, true);
        await tx.setupProgress.deleteMany({});
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
    return { companyId: user.companyId };
  }

  // ---- One-step setup: a complete shop in a single call (the API and the tests) ----

  async run(input: SetupInput, ipAddress: string | null): Promise<{ companyId: string; userId: string }> {
    if (await this.system.user.findUnique({ where: { email: input.admin.email }, select: { id: true } })) throw new ConflictException(ALREADY_SIGNED_UP);
    const companyId = randomUUID();
    const code = input.company.code ?? (await this.freeCompanyCode(input.company.legalName));
    if (input.company.code && (await this.system.company.findUnique({ where: { code }, select: { id: true } }))) {
      throw new ConflictException(`Company code ${code} is already used`);
    }
    enterCompany(companyId);
    const details: ShopDetails = {
      company: {
        legalName: input.company.legalName,
        tradeName: input.company.tradeName ?? null,
        pan: input.company.pan ?? null,
        stateCode: input.company.stateCode,
        addressLine1: input.company.addressLine1 ?? null,
        addressLine2: input.company.addressLine2 ?? null,
        city: input.company.city ?? null,
        pincode: input.company.pincode ?? null,
        phone: input.company.phone ?? null,
        email: input.company.email ?? null,
      },
      gst: input.gstRegistration ? { gstin: input.gstRegistration.gstin, legalNameOnCertificate: input.gstRegistration.legalNameOnCertificate ?? null, settings: null } : null,
      financialYear: input.financialYear,
      store: input.store,
      tills: 0,
      shop: null,
    };
    return this.prisma
      .$transaction(
        async (tx) => {
          await tx.company.create({ data: { id: companyId, code, legalName: details.company.legalName, stateCode: details.company.stateCode } });
          const userId = await this.createOwner(tx, companyId, { ...input.admin, lastName: input.admin.lastName ?? null }, ipAddress);
          await this.audit.record(tx, { userId, ipAddress }, { action: 'create', entityType: 'company', entityId: companyId, changes: { code, legalName: details.company.legalName, stateCode: details.company.stateCode } });
          await this.fillIn(tx, companyId, details, { userId, ipAddress }, false);
          return { companyId, userId };
        },
        { timeout: 60_000, maxWait: 15_000 },
      )
      .catch(alreadySignedUp);
  }

  // ---- The parts ----

  /** A company code no other shop uses: from the name, with a number added when taken. */
  private async freeCompanyCode(name: string): Promise<string> {
    const base = (codeFromName(name) || 'SHOP').slice(0, 8);
    const taken = new Set((await this.system.company.findMany({ where: { code: { startsWith: base } }, select: { code: true } })).map((c) => c.code));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }

  /** The shop's defaults and its owner, who may do everything in all its shops. */
  private async createOwner(tx: Db, companyId: string, owner: Owner, ipAddress: string | null): Promise<string> {
    await this.defaults.ensureAll(tx, companyId);
    await this.auth.assertPasswordAllowed(owner.password, tx);
    const ownerRole = await tx.role.findFirstOrThrow({ where: { code: SYSTEM_ROLES.OWNER_ADMIN } });
    const admin = await tx.user.create({
      data: {
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        passwordHash: await hashPassword(owner.password),
        mustChangePassword: false,
        allStores: true,
        roles: { create: [{ roleId: ownerRole.id }] },
      },
    });
    await tx.user.update({ where: { id: admin.id }, data: { createdById: admin.id, updatedById: admin.id } });
    await tx.company.update({ where: { id: companyId }, data: { createdById: admin.id, updatedById: admin.id } });
    await this.audit.record(tx, { userId: admin.id, ipAddress }, {
      action: 'create',
      entityType: 'user',
      entityId: admin.id,
      changes: { email: admin.email, roles: [SYSTEM_ROLES.OWNER_ADMIN], allStores: true },
    });
    return admin.id;
  }

  /** The business details, GST, first financial year, first shop and its tills, and the modules. */
  private async fillIn(tx: Db, companyId: string, d: ShopDetails, actor: Actor, guided: boolean): Promise<void> {
    const company = await tx.company.update({
      where: { id: companyId },
      data: { ...d.company, shopType: d.shop?.type ?? null, setupCompletedAt: new Date(), updatedById: actor.userId },
    });
    // The guided setup fills in a shop made at sign-up; the one-step setup made it just now (already in the history).
    if (guided) {
      await this.audit.record(tx, actor, {
        action: 'update',
        entityType: 'company',
        entityId: company.id,
        changes: { legalName: company.legalName, stateCode: company.stateCode, ...(d.shop ? { shopType: d.shop.type } : {}) },
      });
    }

    let gstRegistrationId: string | null = null;
    if (d.gst) {
      const registration = await this.company.createGstRegistrationIn(tx, companyId, { gstin: d.gst.gstin, legalNameOnCertificate: d.gst.legalNameOnCertificate, isDefault: true }, actor);
      gstRegistrationId = registration.id;
    }
    if (d.gst?.settings) await this.setGstSettings(tx, companyId, d.gst.settings, actor);

    await this.years.createIn(tx, companyId, { ...d.financialYear, isIrregular: true /* a short first year is allowed */ }, actor, false);

    const store = await this.stores.createIn(tx, companyId, { ...d.store, gstRegistrationId }, actor);
    await this.defaults.ensureAll(tx, companyId);

    if (d.tills > 0) await this.makeTills(tx, companyId, store, d.tills, !!d.shop?.modules.credit_sales, actor);
    if (d.shop) await this.chooseModules(tx, companyId, d.shop, actor);

    await this.audit.record(tx, actor, {
      action: 'setup',
      entityType: 'company',
      entityId: companyId,
      ...(guided ? { changes: { guided: true, tills: d.tills, shopType: d.shop?.type ?? null } } : {}),
    });
  }

  /** GST settings from the GST step, with the usual HSN digits and e-invoicing for the turnover band (plan 08 §5). */
  private async setGstSettings(tx: Db, companyId: string, s: { scheme: string; filingFrequency: string; turnoverBand: string }, actor: Actor) {
    await ensureGstSettings(tx, companyId);
    const data = {
      scheme: s.scheme,
      filingFrequency: s.filingFrequency,
      turnoverBand: s.turnoverBand,
      hsnDigits: defaultHsnDigits(s.turnoverBand),
      // E-invoicing applies above ₹5 crore aggregate turnover (CBIC notification 10/2023-Central Tax); never under composition.
      eInvoiceApplies: s.scheme === 'regular' && s.turnoverBand !== 'up_to_5cr',
    };
    await tx.gstSettings.update({ where: { companyId }, data: { ...data, updatedById: actor.userId } });
    await this.audit.record(tx, actor, { action: 'create', entityType: 'gst_settings', entityId: companyId, changes: data });
  }

  /** The first tills: T1, T2… selling from the shop floor at the standard selling prices, taking cash, card and UPI. */
  private async makeTills(tx: Db, companyId: string, store: { id: string; code: string }, count: number, onAccount: boolean, actor: Actor) {
    await ensurePosDefaults(tx, companyId);
    const codes = [...SETUP_TILL_PAYMENT_METHODS, ...(onAccount ? ['ACCOUNT'] : [])];
    const methods = await tx.paymentMethod.findMany({ where: { companyId, code: { in: codes } } });
    const location = await tx.stockLocation.findUniqueOrThrow({ where: { companyId_code: { companyId, code: `${store.code}-FLOOR` } } });
    const list = await tx.priceList.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'STD-SELL' } } });
    const paymentMethods = codes.flatMap((code) => {
      const m = methods.find((x) => x.code === code);
      return m ? [{ paymentMethodId: m.id, isDefault: code === 'CASH' }] : [];
    });
    for (const t of setupTills(count)) {
      await this.posSetup.createTillIn(tx, companyId, { storeId: store.id, code: t.code, name: t.name, locationId: location.id, priceListId: list.id, paymentMethods }, actor);
    }
  }

  /**
   * The shop type's starting lists, and exactly the modules ticked on the last step with what they need
   * (applyShopType of the modules service writes every switch and its history).
   */
  private async chooseModules(tx: Db, companyId: string, shop: { type: ShopTypeKey; modules: Record<ModuleKey, boolean> }, actor: Actor) {
    await applyShopType(tx, companyId, shop.type, actor, withAllNeeds(shop.modules));
  }
}

/** Two sign-ups with the same email at the same moment: the second gets the plain message. */
function alreadySignedUp(err: unknown): never {
  if ((err as { code?: string }).code === 'P2002' && JSON.stringify((err as { meta?: unknown }).meta ?? '').includes('email')) throw new ConflictException(ALREADY_SIGNED_UP);
  throw err;
}

/** The saved answers, keeping each step that still passes the checks. */
function cleanDraft(raw: unknown): SetupDraft {
  const parsed = setupDraftSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const bad = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')));
  const kept = Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).filter(([k]) => !bad.has(k)));
  const again = setupDraftSchema.safeParse(kept);
  return again.success ? again.data : {};
}

function detailsFromAnswers(a: SetupAnswers): ShopDetails {
  const b = a.business;
  return {
    company: {
      legalName: b.legalName,
      tradeName: b.tradeName ?? null,
      pan: b.pan ?? (a.gst.registered ? a.gst.gstin.slice(2, 12) : null),
      stateCode: b.stateCode,
      addressLine1: b.addressLine1 ?? null,
      addressLine2: b.addressLine2 ?? null,
      city: b.city ?? null,
      pincode: b.pincode ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
    },
    gst: a.gst.registered
      ? { gstin: a.gst.gstin, legalNameOnCertificate: a.gst.legalNameOnCertificate ?? null, settings: { scheme: a.gst.scheme, filingFrequency: a.gst.filingFrequency, turnoverBand: a.gst.turnoverBand } }
      : null,
    financialYear: b.financialYear ?? indianFinancialYear(),
    // The first shop starts at the business address; it can be changed on the shop's page.
    store: { code: a.shop.code, name: a.shop.name, addressLine1: b.addressLine1 ?? null, addressLine2: b.addressLine2 ?? null, city: b.city ?? null, pincode: b.pincode ?? null, phone: b.phone ?? null, email: b.email ?? null },
    tills: a.shop.tills,
    shop: { type: a.sell.shopType, modules: a.sell.modules },
  };
}
