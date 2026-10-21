// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12: switching optional modules on and off, and applying a shop type.
import { z } from 'zod';
import { SHOP_TYPE_KEYS } from '../modules.js';

export const switchModuleSchema = z.object({
  enabled: z.boolean(),
  /** Switch off even though things are still in use (after seeing the warnings). */
  confirm: z.boolean().optional(),
});
export type SwitchModuleInput = z.infer<typeof switchModuleSchema>;

export const applyShopTypeSchema = z.object({
  type: z.enum(SHOP_TYPE_KEYS as [string, ...string[]]),
  /** Apply it (after seeing what changes); without it nothing changes. */
  confirm: z.boolean().optional(),
});
export type ApplyShopTypeInput = z.infer<typeof applyShopTypeSchema>;
