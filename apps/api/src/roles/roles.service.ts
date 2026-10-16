// Copyright (c) 2026, Rademics. All rights reserved.
import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  type CreateRoleInput,
  PERMISSIONS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRoleCode,
  type UpdateRoleInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { inTransaction } from '../prisma/in-transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';

const roleInclude = { permissions: { select: { permissionKey: true } } } satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSystemRoles(this.prisma);
  }

  /**
   * Creates any of the six system roles that are missing (decision 71).
   * Existing roles are left alone so an admin's permission edits survive restarts.
   * Safe when called at the same moment: a role and its permissions are added in one
   * transaction, and only by the caller whose insert actually created the role.
   */
  async ensureSystemRoles(db: Db): Promise<void> {
    await inTransaction(db, async (tx) => {
      const codes = Object.values(SYSTEM_ROLES) as SystemRoleCode[];
      const created = await tx.role.createManyAndReturn({
        data: codes.map((code) => ({ code, name: SYSTEM_ROLE_NAMES[code], isSystem: true })),
        skipDuplicates: true,
        select: { id: true, code: true },
      });
      await tx.rolePermission.createMany({
        data: created.flatMap((r) => SYSTEM_ROLE_PERMISSIONS[r.code as SystemRoleCode].map((permissionKey) => ({ roleId: r.id, permissionKey }))),
      });
    });
  }

  listPermissions() {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description }));
  }

  async list() {
    const roles = await this.prisma.role.findMany({ include: roleInclude, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    return roles.map(toDto);
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: roleInclude });
    if (!role) throw new NotFoundException('Role not found');
    return toDto(role);
  }

  async create(input: CreateRoleInput, actor: Actor) {
    if (await this.prisma.role.findUnique({ where: { code: input.code } })) {
      throw new ConflictException(`A role with code "${input.code}" already exists`);
    }
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          permissions: { create: uniq(input.permissions).map((permissionKey) => ({ permissionKey })) },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        include: roleInclude,
      });
      await this.audit.record(tx, actor, {
        action: 'create',
        entityType: 'role',
        entityId: created.id,
        changes: { code: created.code, name: created.name, permissions: input.permissions },
      });
      return created;
    });
    return toDto(role);
  }

  async update(id: string, input: UpdateRoleInput, actor: Actor) {
    const before = await this.prisma.role.findUnique({ where: { id }, include: roleInclude });
    if (!before) throw new NotFoundException('Role not found');
    if (before.isSystem && input.active === false) {
      throw new BadRequestException('System roles cannot be switched off');
    }
    if (before.code === SYSTEM_ROLES.OWNER_ADMIN && input.permissions) {
      throw new BadRequestException('The Owner/Admin role always has every right');
    }
    const role = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          active: input.active,
          updatedById: actor.userId,
          ...(input.permissions
            ? {
                permissions: {
                  deleteMany: {},
                  create: uniq(input.permissions).map((permissionKey) => ({ permissionKey })),
                },
              }
            : {}),
        },
        include: roleInclude,
      });
      await this.audit.recordUpdate(tx, actor, 'role', id, flatten(before), flatten(updated));
      if (input.permissions) {
        const oldKeys = before.permissions.map((p) => p.permissionKey).sort();
        const newKeys = updated.permissions.map((p) => p.permissionKey).sort();
        if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys)) {
          await this.audit.record(tx, actor, {
            action: 'update',
            entityType: 'role_permissions',
            entityId: id,
            changes: { permissions: { old: oldKeys, new: newKeys } },
          });
        }
      }
      return updated;
    });
    return toDto(role);
  }
}

function uniq(keys: string[]): string[] {
  return [...new Set(keys)];
}

function flatten(role: RoleRow): Record<string, unknown> {
  const { permissions: _p, ...rest } = role;
  return rest;
}

function toDto(role: RoleRow) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    active: role.active,
    permissions: role.permissions.map((p) => p.permissionKey).sort(),
  };
}
