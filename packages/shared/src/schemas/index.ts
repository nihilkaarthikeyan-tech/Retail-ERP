// Copyright (c) 2026, Rademics. All rights reserved.
// Input validation shared by the API (authoritative) and the web forms.
import { z } from 'zod';
import { PAN_RE } from '../company.js';
import { isIsoDate } from '../financial-year.js';
import { gstinProblem } from '../gst-core.js';
import { INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE, isStateCode } from '../india.js';
import { NUMBER_PATTERN_TOKENS } from '../numbering.js';
import { isPermissionKey } from '../permissions.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const isoDate = z.string().refine(isIsoDate, 'Choose a date');
export const stateCode = z.string().refine(isStateCode, 'Unknown GST state code');
export const email = z.string().trim().toLowerCase().email().max(254);
export const mobile = z
  .string()
  .trim()
  .regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE)
  .optional()
  .nullable();
/**
 * A GSTIN with its check character (plan 08 G4), everywhere one is typed: the company's own,
 * customers', suppliers'. Found in the launch check of 27 October 2026: only the set-up guide and
 * the till checked the last character, so a typing mistake elsewhere reached the GST return.
 */
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((v, ctx) => {
    const problem = gstinProblem(v, isStateCode);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
export const pan = z.string().trim().toUpperCase().regex(PAN_RE, 'Not a valid PAN');
export const shortCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Code must be 2–10 letters or digits');

export const addressFields = {
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(60),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits')
    .optional()
    .nullable(),
  stateCode: stateCode.optional().nullable(),
};

// ---- Auth ----

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** "Forgot password?" (owner, 26 October 2026): the email to send the link to. */
export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** The one-time code from an emailed link. */
const linkToken = z.string().trim().min(20).max(200);

export const newPasswordByLinkSchema = z.object({
  token: linkToken,
  newPassword: z.string().min(1).max(200),
});
export type NewPasswordByLinkInput = z.infer<typeof newPasswordByLinkSchema>;

export const confirmEmailSchema = z.object({ token: linkToken });
export type ConfirmEmailInput = z.infer<typeof confirmEmailSchema>;

// ---- Setup ----

export const setupSchema = z.object({
  admin: z.object({
    firstName: trimmed(60),
    lastName: optionalText(60),
    email,
    password: z.string().min(1).max(200),
  }),
  company: z.object({
    legalName: trimmed(160),
    tradeName: optionalText(160),
    code: shortCode.optional(),
    pan: pan.optional().nullable(),
    ...addressFields,
    stateCode,
    phone: optionalText(20),
    email: email.optional().nullable(),
  }),
  gstRegistration: z
    .object({
      gstin,
      legalNameOnCertificate: optionalText(160),
    })
    .optional()
    .nullable(),
  financialYear: z.object({
    startDate: isoDate,
    endDate: isoDate,
  }),
  store: z.object({
    code: shortCode,
    name: trimmed(120),
  }),
});
export type SetupInput = z.infer<typeof setupSchema>;

// ---- Company ----

export const updateCompanySchema = z.object({
  legalName: trimmed(160).optional(),
  tradeName: optionalText(160),
  pan: pan.optional().nullable(),
  ...addressFields,
  stateCode: stateCode.optional(),
  phone: optionalText(20),
  email: email.optional().nullable(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const createGstRegistrationSchema = z.object({
  gstin,
  legalNameOnCertificate: optionalText(160),
  ...addressFields,
  isDefault: z.boolean().optional(),
});
export type CreateGstRegistrationInput = z.infer<typeof createGstRegistrationSchema>;

export const updateGstRegistrationSchema = createGstRegistrationSchema
  .omit({ gstin: true })
  .extend({ active: z.boolean().optional() })
  .partial();
export type UpdateGstRegistrationInput = z.infer<typeof updateGstRegistrationSchema>;

// ---- Stores ----

export const createStoreSchema = z.object({
  code: shortCode,
  name: trimmed(120),
  ...addressFields,
  phone: optionalText(20),
  email: email.optional().nullable(),
  gstRegistrationId: z.uuid().optional().nullable(),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const updateStoreSchema = createStoreSchema
  .omit({ code: true })
  .extend({ active: z.boolean().optional() })
  .partial();
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

// ---- Financial years ----

export const createFinancialYearSchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
  isIrregular: z.boolean().optional(),
});
export type CreateFinancialYearInput = z.infer<typeof createFinancialYearSchema>;

export const updateFinancialYearSchema = z.object({
  status: z.enum(['open', 'locked']),
});
export type UpdateFinancialYearInput = z.infer<typeof updateFinancialYearSchema>;

// ---- Number series ----

const patternSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9\-/{}_]+$/i,'Pattern may contain letters, digits, - / _ and {TOKENS}')
  .refine((p) => {
    for (const m of p.matchAll(/\{([A-Z]+)\}/g)) {
      if (!(NUMBER_PATTERN_TOKENS as readonly string[]).includes(m[1])) return false;
    }
    return true;
  }, `Allowed tokens: ${NUMBER_PATTERN_TOKENS.map((t) => `{${t}}`).join(' ')}`);

export const createNumberSeriesSchema = z.object({
  documentKind: z
    .string()
    .trim()
    .regex(/^[a-z_]{3,40}$/, 'Document kind must be lower-case letters and underscores'),
  pattern: patternSchema,
  counterLength: z.number().int().min(3).max(10).optional(),
  storeId: z.uuid().optional().nullable(),
});
export type CreateNumberSeriesInput = z.infer<typeof createNumberSeriesSchema>;

export const updateNumberSeriesSchema = z
  .object({
    pattern: patternSchema,
    counterLength: z.number().int().min(3).max(10),
    active: z.boolean(),
  })
  .partial();
export type UpdateNumberSeriesInput = z.infer<typeof updateNumberSeriesSchema>;

export const changeCounterSchema = z.object({
  filledPrefix: z.string().min(1).max(60),
  nextNumber: z.number().int().min(1),
  reason: trimmed(200),
});
export type ChangeCounterInput = z.infer<typeof changeCounterSchema>;

// ---- Users ----

export const createUserSchema = z.object({
  firstName: trimmed(60),
  lastName: optionalText(60),
  email,
  mobile,
  temporaryPassword: z.string().min(1).max(200),
  roleIds: z.array(z.uuid()).min(0),
  allStores: z.boolean().optional(),
  storeIds: z.array(z.uuid()).optional(),
  defaultStoreId: z.uuid().optional().nullable(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: trimmed(60),
    lastName: optionalText(60),
    email,
    mobile,
    active: z.boolean(),
    roleIds: z.array(z.uuid()),
    allStores: z.boolean(),
    storeIds: z.array(z.uuid()),
    defaultStoreId: z.uuid().nullable(),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  temporaryPassword: z.string().min(1).max(200),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---- Roles ----

const permissionList = z.array(z.string().refine(isPermissionKey, 'Unknown permission'));

export const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{2,40}$/, 'Code must be lower-case letters, digits and underscores'),
  name: trimmed(60),
  description: optionalText(200),
  permissions: permissionList,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: trimmed(60),
    description: optionalText(200),
    permissions: permissionList,
    active: z.boolean(),
  })
  .partial();
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// ---- Audit ----

export const auditQuerySchema = z.object({
  userId: z.uuid().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  before: z.string().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
