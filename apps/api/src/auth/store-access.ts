// Copyright (c) 2026, Rademics. All rights reserved.
import { ForbiddenException } from '@nestjs/common';
import type { CurrentUser } from 'shared';

/** Record restriction by store (blueprint 15): throws unless the user may work in this store. */
export function assertStoreAccess(user: CurrentUser, storeId: string): void {
  if (!canAccessStore(user, storeId)) {
    throw new ForbiddenException('You are not allowed to work in this store');
  }
}

export function canAccessStore(user: CurrentUser, storeId: string): boolean {
  return user.allStores || user.stores.some((s) => s.id === storeId);
}

/** For list queries: undefined = no filter, otherwise the allowed store ids. */
export function allowedStoreIds(user: CurrentUser): string[] | undefined {
  return user.allStores ? undefined : user.stores.map((s) => s.id);
}
