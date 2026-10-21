// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  codeFromName,
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
  SYSTEM_ROLES,
  withAllNeeds,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { CatalogueSettingsService } from '../catalogue/catalogue-settings.service.js';
import type { Actor } from '../common/request-context.js';
import { CompanyService } from '../company/company.service.js';
import { FinancialYearsService } from '../financial-years/financial-years.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ensureGstSettings } from '../gst/gst-core.service.js';
import { applyShopType } from '../modules/shop-type.js';
import { PartySettingsService } from '../parties/party-settings.service.js';
import { ensurePosDefaults } from '../pos/pos-common.service.js';
import { PosSetupService } from '../pos/pos-setup.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RolesService } from '../roles/roles.service.js';
import { StoresService } from '../stores/stores.service.js';

/** Everything first-time setup makes, from the one-page input or the guided steps. */
interface Founding {
  admin: { firstName: string; lastName: string | null; email: string; passwordHash: string };
  company: {
    code: string;
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
  /** Plan 12: the shop type and the modules chosen on step 5; none for the one-page setup (every module stays on). */
  shop: { type: ShopTypeKey; modules: Record<ModuleKey, boolean> } | null;
}

const PROGRESS_ID = 1;

/**
 * First-time setup (blueprint 02, process 1; plan 12 §3): the owner's login,
 * the company, its GSTIN and GST settings, the first financial year, the first
 * shop and its tills, and the modules for the kind of shop — all in one
 * transaction. Refused once a company exists.
 *
 * The guided setup saves its answers step by step (SetupProgress) so closing
 * the browser loses nothing; the owner's password is never saved there — it is
 * typed on the last step and sent only with "Finish".
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly roles: RolesService,
    private readonly company: CompanyService,
    private readonly years: FinancialYearsService,
    private readonly stores: StoresService,
    private readonly catalogueSettings: CatalogueSettingsService,
    private readonly partySettings: PartySettingsService,
    private readonly posSetup: PosSetupService,
  ) {}

  async status(): Promise<{ needed: boolean }> {
    return { needed: (await this.prisma.company.count()) === 0 };
  }

  private async assertNotSetUp(db: Db = this.prisma) {
    if ((await db.company.count()) > 0) throw new ConflictException('Setup has already been completed');
  }

  // ---- Guided setup: answers saved step by step ----

  /** Where the guided setup stands: the step to show and the answers so far. */
  async progress(): Promise<{ step: number; data: SetupDraft; updatedAt: Date | null }> {
    await this.assertNotSetUp();
    const row = await this.prisma.setupProgress.findUnique({ where: { id: PROGRESS_ID } });
    if (!row) return { step: 1, data: {}, updatedAt: null };
    // Answers saved by an older version that no longer pass are dropped step by step, never the whole lot.
    const data = cleanDraft(row.data);
    return { step: row.step, data, updatedAt: row.updatedAt };
  }

  /** Saves the answers so far and the step to come back to. Only checked answers are kept. */
  async saveProgress(input: SetupProgressInput): Promise<{ step: number; data: SetupDraft; updatedAt: Date }> {
    await this.assertNotSetUp();
    const data = input.data as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.setupProgress.upsert({
      where: { id: PROGRESS_ID },
      create: { id: PROGRESS_ID, step: input.step, data },
      update: { step: input.step, data },
    });
    return { step: row.step, data: input.data, updatedAt: row.updatedAt };
  }

  /** "Finish": every step answered, the password typed now; creates everything at once. */
  async finish(password: string, ipAddress: string | null): Promise<{ companyId: string; userId: string }> {
    await this.assertNotSetUp();
    const row = await this.prisma.setupProgress.findUnique({ where: { id: PROGRESS_ID } });
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
    await this.auth.assertPasswordAllowed(password);
    return this.found(foundingFromAnswers(parsed.data, await hashPassword(password)), ipAddress, true);
  }

  // ---- One-page setup (kept for the API and the tests) ----

  async run(input: SetupInput, ipAddress: string | null): Promise<{ companyId: string; userId: string }> {
    await this.assertNotSetUp();
    await this.auth.assertPasswordAllowed(input.admin.password);
    const passwordHash = await hashPassword(input.admin.password);
    return this.found(
      {
        admin: { firstName: input.admin.firstName, lastName: input.admin.lastName ?? null, email: input.admin.email, passwordHash },
        company: {
          code: input.company.code ?? codeFromName(input.company.legalName),
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
      },
      ipAddress,
      false,
    );
  }

  // ---- Creating everything, in one transaction ----

  private async found(f: Founding, ipAddress: string | null, guided: boolean): Promise<{ companyId: string; userId: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        // Two "Finish" clicks at once: the second waits here, then finds the company.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('first-time-setup'))`;
        await this.assertNotSetUp(tx);
        await this.roles.ensureSystemRoles(tx);
        const ownerRole = await tx.role.findUniqueOrThrow({ where: { code: SYSTEM_ROLES.OWNER_ADMIN } });

        const admin = await tx.user.create({
          data: {
            email: f.admin.email,
            firstName: f.admin.firstName,
            lastName: f.admin.lastName,
            passwordHash: f.admin.passwordHash,
            mustChangePassword: false,
            allStores: true,
            roles: { create: [{ roleId: ownerRole.id }] },
          },
        });
        await tx.user.update({ where: { id: admin.id }, data: { createdById: admin.id, updatedById: admin.id } });
        const actor: Actor = { userId: admin.id, ipAddress };
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'user',
          entityId: admin.id,
          changes: { email: admin.email, roles: [SYSTEM_ROLES.OWNER_ADMIN], allStores: true },
        });

        if (await tx.company.findUnique({ where: { code: f.company.code } })) {
          throw new ConflictException(`Company code ${f.company.code} is already used`);
        }
        const company = await tx.company.create({
          data: { ...f.company, shopType: f.shop?.type ?? null, createdById: admin.id, updatedById: admin.id },
        });
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'company',
          entityId: company.id,
          changes: { code: company.code, legalName: company.legalName, stateCode: company.stateCode, ...(f.shop ? { shopType: f.shop.type } : {}) },
        });

        let gstRegistrationId: string | null = null;
        if (f.gst) {
          const registration = await this.company.createGstRegistrationIn(tx, company.id, { gstin: f.gst.gstin, legalNameOnCertificate: f.gst.legalNameOnCertificate, isDefault: true }, actor);
          gstRegistrationId = registration.id;
        }
        if (f.gst?.settings) await this.setGstSettings(tx, company.id, f.gst.settings, actor);

        await this.years.createIn(
          tx,
          company.id,
          { ...f.financialYear, isIrregular: true /* a short first year is allowed */ },
          actor,
          false,
        );

        const store = await this.stores.createIn(tx, company.id, { ...f.store, gstRegistrationId }, actor);
        await this.catalogueSettings.ensureCompanyDefaults(tx, company.id);
        await this.partySettings.ensureStandardMasters(tx);
        await this.partySettings.ensureCompanyDefaults(tx, company.id);

        if (f.tills > 0) await this.makeTills(tx, company.id, store, f.tills, !!f.shop?.modules.credit_sales, actor);
        if (f.shop) await this.chooseModules(tx, company.id, f.shop, actor);

        await this.audit.record(tx, actor, {
          action: 'setup',
          entityType: 'company',
          entityId: company.id,
          ...(guided ? { changes: { guided: true, tills: f.tills, shopType: f.shop?.type ?? null } } : {}),
        });
        // The saved answers held names and numbers only while setup was under way.
        await tx.setupProgress.deleteMany({});
        return { companyId: company.id, userId: admin.id };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  }

  /** GST settings from step 3, with the usual HSN digits and e-invoicing for the turnover band (plan 08 §5). */
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
   * The shop type's starting lists, and exactly the modules ticked on step 5 with what they need
   * (applyShopType of the modules service writes every switch and its history).
   */
  private async chooseModules(tx: Db, companyId: string, shop: { type: ShopTypeKey; modules: Record<ModuleKey, boolean> }, actor: Actor) {
    await applyShopType(tx, companyId, shop.type, actor, withAllNeeds(shop.modules));
  }
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

function foundingFromAnswers(a: SetupAnswers, passwordHash: string): Founding {
  const b = a.business;
  return {
    admin: { firstName: a.you.firstName, lastName: a.you.lastName ?? null, email: a.you.email, passwordHash },
    company: {
      code: codeFromName(b.legalName) || 'CO',
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
