// Copyright (c) 2026, Rademics. All rights reserved.
import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from 'shared';

export const IS_PUBLIC = 'isPublic';
/** Marks a route that needs no login: health, login, first-run setup. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_PASSWORD_CHANGE_PENDING = 'allowPasswordChangePending';
/** Routes a user may call while still required to change their password. */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/** The permission key a route needs. Owner/Admin always passes. */
export const RequirePermission = (key: PermissionKey) => SetMetadata(REQUIRED_PERMISSION, key);

export const OWNER_ADMIN_ONLY = 'ownerAdminOnly';
/** Routes only the Owner/Admin role may call (e.g. counter changes). */
export const OwnerAdminOnly = () => SetMetadata(OWNER_ADMIN_ONLY, true);
