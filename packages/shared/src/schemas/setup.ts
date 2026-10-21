// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §3: input of the step-by-step first-time setup. Each step is checked
// on its own when it is saved, and all of them together when setup finishes.
// The owner's password is never part of the saved answers; it is typed on the
// last step and sent only with "Finish".
import { z } from 'zod';
import { panFromGstin } from '../company.js';
import { endsAfterStart } from '../financial-year.js';
import { FILING_FREQUENCIES, GST_SCHEMES, TURNOVER_BANDS } from '../gst-core.js';
import { isModuleKey, MODULE_KEYS, type ModuleKey, SHOP_TYPE_KEYS, type ShopTypeKey } from '../modules.js';
import { SETUP_LAST_STEP } from '../setup.js';
import { checkedGstin } from './gst-core.js';
import { addressFields, email, isoDate, pan, shortCode, stateCode } from './index.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

/** Step 1, "You". */
export const setupYouSchema = z.object({
  firstName: trimmed(60),
  lastName: optionalText(60),
  email,
});
export type SetupYou = z.infer<typeof setupYouSchema>;

/** Step 2, "Your business". The first financial year defaults to the current Indian one. */
export const setupBusinessSchema = z.object({
  legalName: trimmed(160),
  tradeName: optionalText(160),
  pan: pan.optional().nullable(),
  ...addressFields,
  stateCode,
  phone: optionalText(20),
  email: email.optional().nullable(),
  financialYear: z
    .object({ startDate: isoDate, endDate: isoDate })
    .refine((y) => endsAfterStart(y), { message: 'The year must end after it starts', path: ['endDate'] })
    .optional(),
});
export type SetupBusiness = z.infer<typeof setupBusinessSchema>;

/**
 * Step 3, "GST": registered (GSTIN checked with its check character) or "not registered yet".
 * Rules from the law, not settings:
 * - quarterly returns (QRMP scheme) only up to ₹5 crore turnover (CBIC notification 84/2020-Central Tax; https://www.gst.gov.in, "QRMP scheme");
 * - the composition scheme only for small turnovers (section 10 of the CGST Act, limit ₹1.5 crore) and its returns are quarterly (CMP-08).
 */
export const setupGstSchema = z.discriminatedUnion('registered', [
  z.object({ registered: z.literal(false) }),
  z
    .object({
      registered: z.literal(true),
      gstin: checkedGstin,
      legalNameOnCertificate: optionalText(160),
      scheme: z.enum(GST_SCHEMES),
      filingFrequency: z.enum(FILING_FREQUENCIES),
      turnoverBand: z.enum(TURNOVER_BANDS),
    })
    .superRefine((g, ctx) => {
      if (g.turnoverBand !== 'up_to_5cr' && g.filingFrequency === 'quarterly') {
        ctx.addIssue({ code: 'custom', path: ['filingFrequency'], message: 'Quarterly returns are only for a turnover up to ₹5 crore; choose monthly' });
      }
      if (g.scheme === 'composition' && g.turnoverBand !== 'up_to_5cr') {
        ctx.addIssue({ code: 'custom', path: ['scheme'], message: 'The composition scheme is only for a small turnover (up to ₹1.5 crore)' });
      }
      if (g.scheme === 'composition' && g.filingFrequency !== 'quarterly') {
        ctx.addIssue({ code: 'custom', path: ['filingFrequency'], message: 'Under the composition scheme returns are quarterly' });
      }
    }),
]);
export type SetupGst = z.infer<typeof setupGstSchema>;

/** Step 4, "Your first shop": its name, short code and how many tills to make. */
export const setupShopSchema = z.object({
  name: trimmed(120),
  code: shortCode,
  tills: z.number().int('A whole number of tills').min(0, 'No fewer than 0 tills').max(20, 'At most 20 tills here; add more later'),
});
export type SetupShop = z.infer<typeof setupShopSchema>;

/** Every optional module on or off; a module not mentioned is off. Unknown modules are refused. */
const moduleTicks = z
  .record(z.string(), z.boolean())
  .superRefine((m, ctx) => {
    for (const key of Object.keys(m)) if (!isModuleKey(key)) ctx.addIssue({ code: 'custom', path: [key], message: `Unknown module ${key}` });
  })
  .transform((m) => Object.fromEntries(MODULE_KEYS.map((k) => [k, m[k] === true])) as Record<ModuleKey, boolean>);

/** Step 5, "What do you sell?": the shop type and the modules to switch on. */
export const setupSellSchema = z.object({
  shopType: z.enum(SHOP_TYPE_KEYS as [ShopTypeKey, ...ShopTypeKey[]]),
  modules: moduleTicks,
});
export type SetupSell = z.infer<typeof setupSellSchema>;

type Sections = { business?: { pan?: string | null } | undefined; gst?: SetupGst | undefined };

/** The GSTIN carries the PAN in its 3rd to 12th characters (GST portal, "GSTIN" help page). */
function panMatchesGstin(s: Sections, ctx: z.RefinementCtx) {
  const p = s.business?.pan;
  if (p && s.gst?.registered && panFromGstin(s.gst.gstin) !== p) {
    ctx.addIssue({ code: 'custom', path: ['gst', 'gstin'], message: `This GSTIN belongs to PAN ${panFromGstin(s.gst.gstin)}, not to your PAN ${p}` });
  }
}

/** The answers saved so far: each step that is there must be complete and correct. */
export const setupDraftSchema = z
  .object({
    you: setupYouSchema.optional(),
    business: setupBusinessSchema.optional(),
    gst: setupGstSchema.optional(),
    shop: setupShopSchema.optional(),
    sell: setupSellSchema.optional(),
  })
  .superRefine(panMatchesGstin);
export type SetupDraft = z.infer<typeof setupDraftSchema>;

/** Every step answered: what "Finish" needs. */
export const setupAnswersSchema = z
  .object({
    you: setupYouSchema,
    business: setupBusinessSchema,
    gst: setupGstSchema,
    shop: setupShopSchema,
    sell: setupSellSchema,
  })
  .superRefine(panMatchesGstin);
export type SetupAnswers = z.infer<typeof setupAnswersSchema>;

/** PUT /setup/progress: the step to come back to and the answers so far. */
export const setupProgressSchema = z.object({
  step: z.number().int().min(1).max(SETUP_LAST_STEP),
  data: setupDraftSchema,
});
export type SetupProgressInput = z.infer<typeof setupProgressSchema>;

/** POST /setup/finish: only the password; the answers are the ones saved step by step. */
export const setupFinishSchema = z.object({
  password: z.string().min(1, 'Choose a password').max(200),
});
export type SetupFinishInput = z.infer<typeof setupFinishSchema>;

/** PUT /getting-started: the owner hides or shows the checklist. */
export const gettingStartedVisibilitySchema = z.object({ hidden: z.boolean() });
export type GettingStartedVisibilityInput = z.infer<typeof gettingStartedVisibilitySchema>;
