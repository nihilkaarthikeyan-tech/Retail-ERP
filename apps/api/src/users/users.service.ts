// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type CreateUserInput, type ResetPasswordInput, SYSTEM_ROLES, type UpdateUserInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { AuthService, userAccessInclude, type UserWithAccess } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import type { Actor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({ include: userAccessInclude, orderBy: [{ active: 'desc' }, { firstName: 'asc' }] });
    return users.map(toDto);
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userAccessInclude });
    if (!user) throw new NotFoundException('User not found');
    return toDto(user);
  }

  async create(input: CreateUserInput, actor: Actor) {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException(`A user with email ${input.email} already exists`);
    }
    await this.auth.assertPasswordAllowed(input.temporaryPassword);
    const passwordHash = await hashPassword(input.temporaryPassword);
    const access = await this.checkAccess(this.prisma, input.roleIds, input.allStores ?? false, input.storeIds ?? [], input.defaultStoreId ?? null);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          mobile: input.mobile ?? null,
          passwordHash,
          mustChangePassword: true,
          allStores: access.allStores,
          roles: { create: access.roleIds.map((roleId) => ({ roleId })) },
          stores: { create: access.stores },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: userAccessInclude,
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'user',
        entityId: created.id,
        changes: {
          email: created.email,
          firstName: created.firstName,
          roles: created.roles.map((r) => r.role.code),
          allStores: created.allStores,
          stores: created.stores.map((s) => s.store.code),
        },
      });
      return created;
    });
    return toDto(user);
  }

  async update(id: string, input: UpdateUserInput, actor: Actor) {
    const before = await this.prisma.user.findUnique({ where: { id }, include: userAccessInclude });
    if (!before) throw new NotFoundException('User not found');
    if (input.active === false && id === actor.userId) {
      throw new BadRequestException('You cannot switch off your own account');
    }
    if (input.email && input.email !== before.email) {
      if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
        throw new ConflictException(`A user with email ${input.email} already exists`);
      }
    }
    const accessChanged = input.roleIds !== undefined || input.allStores !== undefined || input.storeIds !== undefined || input.defaultStoreId !== undefined;
    const access = accessChanged
      ? await this.checkAccess(
          this.prisma,
          input.roleIds ?? before.roles.map((r) => r.roleId),
          input.allStores ?? before.allStores,
          input.storeIds ?? before.stores.map((s) => s.storeId),
          input.defaultStoreId !== undefined ? input.defaultStoreId : (before.stores.find((s) => s.isDefault)?.storeId ?? null),
        )
      : null;

    // The business must always keep at least one active Owner/Admin.
    const wasOwner = before.active && before.roles.some((r) => r.role.code === SYSTEM_ROLES.OWNER_ADMIN && r.role.active);
    if (wasOwner) {
      const ownerRole = await this.prisma.role.findFirstOrThrow({ where: { code: SYSTEM_ROLES.OWNER_ADMIN } });
      const staysOwner = input.active !== false && (!access || access.roleIds.includes(ownerRole.id));
      if (!staysOwner) {
        const otherOwners = await this.prisma.user.count({
          where: { id: { not: id }, active: true, roles: { some: { roleId: ownerRole.id } } },
        });
        if (otherOwners === 0) throw new BadRequestException('This is the only active Owner/Admin; give the role to someone else first');
      }
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const after = await tx.user.update({
        where: { id },
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          mobile: input.mobile,
          active: input.active,
          updatedById: actor.userId,
          ...(access
            ? {
                allStores: access.allStores,
                roles: { deleteMany: {}, create: access.roleIds.map((roleId) => ({ roleId })) },
                stores: { deleteMany: {}, create: access.stores },
              }
            : {}),
        },
        include: userAccessInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'user', id, summarise(before), summarise(after));
      if (input.active === false && before.active) {
        await this.auth.endAllSessions(tx, id, actor);
      }
      return after;
    });
    return toDto(user);
  }

  /** Sets a temporary password the user must change at next login; ends their sessions. */
  async resetPassword(id: string, input: ResetPasswordInput, actor: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.auth.assertPasswordAllowed(input.temporaryPassword);
    const passwordHash = await hashPassword(input.temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'password_reset', entityType: 'user', entityId: id });
      await this.auth.endAllSessions(tx, id, actor);
    });
  }

  async endSessions(id: string, actor: Actor) {
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw new NotFoundException('User not found');
    return this.prisma.$transaction((tx) => this.auth.endAllSessions(tx, id, actor));
  }

  private async checkAccess(db: Db, roleIds: string[], allStores: boolean, storeIds: string[], defaultStoreId: string | null) {
    const uniqueRoles = [...new Set(roleIds)];
    const roles = await db.role.findMany({ where: { id: { in: uniqueRoles } } });
    if (roles.length !== uniqueRoles.length) throw new BadRequestException('One or more roles do not exist');
    const uniqueStores = allStores ? [] : [...new Set(storeIds)];
    const stores = await db.store.findMany({ where: { id: { in: uniqueStores }, active: true } });
    if (stores.length !== uniqueStores.length) throw new BadRequestException('One or more stores do not exist or are switched off');
    if (defaultStoreId && !allStores && !uniqueStores.includes(defaultStoreId)) {
      throw new BadRequestException('The default store must be one of the user’s stores');
    }
    return {
      roleIds: uniqueRoles,
      allStores,
      stores: uniqueStores.map((storeId) => ({ storeId, isDefault: storeId === defaultStoreId })),
    };
  }
}

/** The fields the history compares for a user. */
function summarise(user: UserWithAccess): Record<string, unknown> {
  return {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    mobile: user.mobile,
    active: user.active,
    allStores: user.allStores,
    roles: user.roles.map((r) => r.role.code).sort(),
    stores: user.stores.map((s) => `${s.store.code}${s.isDefault ? '*' : ''}`).sort(),
  };
}

export function toDto(user: UserWithAccess) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    mobile: user.mobile,
    active: user.active,
    allStores: user.allStores,
    mustChangePassword: user.mustChangePassword,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    roles: user.roles.map((r) => ({ id: r.role.id, code: r.role.code, name: r.role.name, active: r.role.active })),
    stores: user.stores.map((s) => ({ id: s.store.id, code: s.store.code, name: s.store.name, isDefault: s.isDefault })),
    createdAt: user.createdAt,
  };
}
