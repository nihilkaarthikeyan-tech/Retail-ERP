// Copyright (c) 2026, Rademics. All rights reserved.
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUser } from 'shared';
import { PermissionGuard } from './permission.guard.js';
import { OwnerAdminOnly, RequirePermission } from './decorators.js';
import { allowedStoreIds, assertStoreAccess } from './store-access.js';

function user(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    id: 'u1',
    firstName: 'Priya',
    lastName: null,
    email: 'priya@example.com',
    isOwnerAdmin: false,
    permissions: [],
    allStores: false,
    stores: [],
    mustChangePassword: false,
    roles: [],
    ...overrides,
  };
}

function contextFor(handler: () => void, reqUser: CurrentUser | undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: reqUser }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  const guard = new PermissionGuard(new Reflector());

  // Handlers are only used as metadata carriers here, never called.
  const manageUsers = RequirePermission('users.manage')(function manageUsers(this: void) {}) as () => void;
  const counter = OwnerAdminOnly()(function counter(this: void) {}) as () => void;
  const open = function open(this: void) {};

  it('allows routes without a permission', () => {
    expect(guard.canActivate(contextFor(open, user({})))).toBe(true);
  });

  it('refuses a user without the right and allows one with it', () => {
    expect(() => guard.canActivate(contextFor(manageUsers, user({})))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextFor(manageUsers, user({ permissions: ['users.manage'] })))).toBe(true);
  });

  it('Owner/Admin bypasses permission checks', () => {
    expect(guard.canActivate(contextFor(manageUsers, user({ isOwnerAdmin: true })))).toBe(true);
  });

  it('Owner/Admin-only routes refuse everyone else, even with every permission', () => {
    expect(() => guard.canActivate(contextFor(counter, user({ permissions: ['numbering.manage'] })))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(contextFor(counter, user({ isOwnerAdmin: true })))).toBe(true);
  });
});

describe('store access', () => {
  const anna = { id: 's-anna', code: 'ANNA', name: 'Anna Nagar', isDefault: true };

  it('limits a user to their own stores', () => {
    const priya = user({ stores: [anna] });
    expect(() => assertStoreAccess(priya, 's-anna')).not.toThrow();
    expect(() => assertStoreAccess(priya, 's-main')).toThrow(ForbiddenException);
    expect(allowedStoreIds(priya)).toEqual(['s-anna']);
  });

  it('a user with all stores is not filtered', () => {
    const owner = user({ allStores: true });
    expect(() => assertStoreAccess(owner, 's-main')).not.toThrow();
    expect(allowedStoreIds(owner)).toBeUndefined();
  });
});
