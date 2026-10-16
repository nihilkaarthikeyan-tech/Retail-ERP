// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 part 2: customer orders with an advance, and alteration jobs
// (docs/plans/11-shop-extras-part2.md §1 and §2).
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { isIsoDate } from '../financial-year.js';
import { positiveDecimalString, nonNegativeDecimalString } from './catalogue.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().refine(isIsoDate, 'Must be a date in YYYY-MM-DD form');
const uuid = z.string().uuid();
const money = positiveDecimalString.refine((v) => !/\.\d{3,}$/.test(v), 'At most two digits after the point (paise)');
const mobile = z
  .string()
  .trim()
  .regex(/^[0-9]{10}$/, 'Phone number must be 10 digits');

// ---- Customer orders ----

export const CUSTOMER_ORDER_STATUSES = ['open', 'ready', 'collected', 'cancelled'] as const;
export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUSES)[number];
export const CUSTOMER_ORDER_STATUS_LABELS: Record<CustomerOrderStatus, string> = { open: 'Open', ready: 'Ready', collected: 'Collected', cancelled: 'Cancelled' };

export const customerOrderLineSchema = z.object({
  itemId: uuid,
  unitId: uuid.optional().nullable(),
  quantity: positiveDecimalString,
  /** The agreed price per unit, GST included. */
  price: nonNegativeDecimalString,
  remarks: optionalText(200),
});

export const customerOrderSchema = z.object({
  storeId: uuid,
  customerId: uuid,
  expectedOn: isoDate.optional().nullable(),
  remarks: optionalText(500),
  lines: z.array(customerOrderLineSchema).min(1, 'Add at least one item'),
});
export type CustomerOrderInput = z.infer<typeof customerOrderSchema>;

export const CUSTOMER_ORDER_VIEWS = ['open', 'ready', 'overdue', 'collected', 'cancelled', 'advances'] as const;
export type CustomerOrderView = (typeof CUSTOMER_ORDER_VIEWS)[number];

export const customerOrderQuerySchema = z.object({
  /** open, ready, collected, cancelled; overdue = open or ready past the expected date; advances = advance still held. */
  view: z.enum(CUSTOMER_ORDER_VIEWS).optional(),
  storeId: uuid.optional(),
  customerId: uuid.optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type CustomerOrderQuery = z.infer<typeof customerOrderQuerySchema>;

/** An advance at the till: by one of the till's payment methods (not on account). */
export const tillAdvanceSchema = z.object({
  /** Idempotency key: the same advance sent twice is saved once. */
  clientId: uuid,
  tillId: uuid,
  paymentMethodId: uuid,
  amount: money,
  reference: optionalText(60),
});
export type TillAdvanceInput = z.infer<typeof tillAdvanceSchema>;

/** An advance in the back office: into a cash or bank account. */
export const officeAdvanceSchema = z.object({
  accountId: uuid,
  amount: money,
  paymentDate: isoDate.optional(),
  reference: optionalText(60),
  referenceDate: isoDate.optional().nullable(),
  remark: optionalText(300),
});
export type OfficeAdvanceInput = z.infer<typeof officeAdvanceSchema>;

export const ADVANCE_OUTCOMES = ['refund', 'keep_credit'] as const;
export type AdvanceOutcome = (typeof ADVANCE_OUTCOMES)[number];

/** Cancelling in the back office: any advance stays as the customer's credit. */
export const cancelOrderSchema = z.object({ reason: trimmed(300) });
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/** Cancelling at the till: refund (manager PIN, a refund-allowed method) or keep the advance as credit. */
export const tillCancelOrderSchema = z
  .object({
    clientId: uuid,
    tillId: uuid,
    reason: trimmed(300),
    outcome: z.enum(ADVANCE_OUTCOMES),
    paymentMethodId: uuid.optional(),
    reference: optionalText(60),
    approvalToken: z.string().optional(),
  })
  .refine((v) => v.outcome !== 'refund' || !!v.paymentMethodId, { message: 'Choose how the advance is paid back', path: ['paymentMethodId'] });
export type TillCancelOrderInput = z.infer<typeof tillCancelOrderSchema>;

// ---- Alteration jobs ----

export const ALTERATION_STATUSES = ['received', 'with_tailor', 'ready', 'delivered', 'cancelled'] as const;
export type AlterationStatus = (typeof ALTERATION_STATUSES)[number];
export const ALTERATION_STATUS_LABELS: Record<AlterationStatus, string> = {
  received: 'Received',
  with_tailor: 'With the tailor',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
/** The next step of each status (cancelled and delivered are the end). */
export const ALTERATION_NEXT: Record<AlterationStatus, AlterationStatus | null> = { received: 'with_tailor', with_tailor: 'ready', ready: 'delivered', delivered: null, cancelled: null };

export const CHARGE_PAID_WITH = ['bill', 'collection'] as const;
export type ChargePaidWith = (typeof CHARGE_PAID_WITH)[number];

export const alterationJobSchema = z
  .object({
    storeId: uuid,
    /** A named customer, or a walk-in with a name and phone. */
    customerId: uuid.optional().nullable(),
    name: optionalText(120),
    phone: mobile.optional().nullable(),
    /** The till bill the garment was bought on. */
    billId: uuid.optional().nullable(),
    tailorStaffId: uuid.optional().nullable(),
    tailorName: optionalText(120),
    promisedOn: isoDate,
    charge: nonNegativeDecimalString.refine((v) => !/\.\d{3,}$/.test(v), 'At most two digits after the point (paise)'),
    chargePaidWith: z.enum(CHARGE_PAID_WITH),
    remarks: optionalText(500),
    lines: z
      .array(z.object({ itemId: uuid.optional().nullable(), garment: trimmed(120), work: trimmed(300) }))
      .min(1, 'Add the garment and the work to do'),
  })
  .refine((v) => v.customerId || v.name?.trim(), { message: 'Choose the customer, or type a name', path: ['name'] })
  .refine((v) => !(v.tailorStaffId && v.tailorName?.trim()), { message: 'Choose a tailor from the list or type a name, not both', path: ['tailorName'] });
export type AlterationJobInput = z.infer<typeof alterationJobSchema>;

export const ALTERATION_VIEWS = ['open', 'due_today', 'overdue', 'ready', 'delivered', 'cancelled', 'all'] as const;
export type AlterationView = (typeof ALTERATION_VIEWS)[number];

export const alterationQuerySchema = z.object({
  view: z.enum(ALTERATION_VIEWS).optional(),
  storeId: uuid.optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type AlterationQuery = z.infer<typeof alterationQuerySchema>;

export const alterationStatusSchema = z.object({
  status: z.enum(ALTERATION_STATUSES),
  remarks: optionalText(300),
});
export type AlterationStatusInput = z.infer<typeof alterationStatusSchema>;

// ---- Stock set aside (plan 11 part 2: ordered goods are set aside once ready) ----

/**
 * What is free to sell: on hand less what is set aside for customer orders
 * (other than the one being collected) less what is already on the bill.
 * Below zero, the till warns; it never refuses (decision 32).
 */
export function freeToSell(onHand: Decimal.Value, reserved: Decimal.Value, onBill: Decimal.Value): Decimal {
  return new Decimal(onHand).sub(new Decimal(reserved)).sub(new Decimal(onBill));
}
