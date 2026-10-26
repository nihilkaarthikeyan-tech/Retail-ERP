// Copyright (c) 2026, Rademics. All rights reserved.
import type { PermissionKey } from './permissions.js';

/** What the web app knows about the logged-in user (GET /auth/me). */
export interface CurrentUser {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  isOwnerAdmin: boolean;
  permissions: PermissionKey[];
  allStores: boolean;
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  mustChangePassword: boolean;
  /** False while the person has not yet confirmed their email by its link (owner, 26 October 2026). */
  emailConfirmed?: boolean;
  roles: { id: string; code: string; name: string }[];
}

export function hasPermission(user: CurrentUser | null, key: PermissionKey): boolean {
  if (!user) return false;
  return user.isOwnerAdmin || user.permissions.includes(key);
}
