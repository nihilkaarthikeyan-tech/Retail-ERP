// Copyright (c) 2026, Rademics. All rights reserved.
// Who may hand out which rights. Someone the owner trusts with "users.manage" or
// "roles.manage" must not be able to make themselves (or anyone) Owner, take over an
// Owner's login, or give rights they do not hold themselves. Found in the code audit
// of 27 October 2026 (privilege escalation).
import { ForbiddenException } from '@nestjs/common';
import { SYSTEM_ROLES } from 'shared';
import type { Db } from '../audit/audit.service.js';

export interface CallerRights {
  isOwner: boolean;
  rights: Set<string>;
}

/** The caller's own standing: Owner/Admin, and the rights of their active roles. */
export async function callerRights(db: Db, userId: string | null): Promise<CallerRights> {
  if (!userId) return { isOwner: false, rights: new Set() };
  const roles = await db.userRole.findMany({ where: { userId, role: { active: true } }, select: { role: { select: { code: true, permissions: { select: { permissionKey: true } } } } } });
  return {
    isOwner: roles.some((r) => r.role.code === SYSTEM_ROLES.OWNER_ADMIN),
    rights: new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permissionKey))),
  };
}

/** Refuses giving roles the caller could not give: the Owner role, or rights the caller lacks. */
export async function assertCanGiveRoles(db: Db, caller: CallerRights, roleIds: string[]): Promise<void> {
  if (caller.isOwner || !roleIds.length) return;
  const roles = await db.role.findMany({ where: { id: { in: roleIds } }, select: { name: true, code: true, permissions: { select: { permissionKey: true } } } });
  for (const r of roles) {
    if (r.code === SYSTEM_ROLES.OWNER_ADMIN) throw new ForbiddenException('Only an Owner / Admin can give the Owner / Admin role');
    const missing = r.permissions.map((p) => p.permissionKey).filter((k) => !caller.rights.has(k));
    if (missing.length) throw new ForbiddenException(`Only an Owner / Admin can give the role "${r.name}": it has rights you do not have yourself`);
  }
}

/** Refuses giving a role rights the caller lacks. */
export function assertCanGiveRights(caller: CallerRights, permissions: string[]): void {
  if (caller.isOwner) return;
  if (permissions.some((k) => !caller.rights.has(k))) throw new ForbiddenException('Only an Owner / Admin can give rights you do not have yourself');
}

/** Refuses changing, resetting or logging out an Owner unless the caller is an Owner too. */
export async function assertCanTouchUser(db: Db, caller: CallerRights, userId: string): Promise<void> {
  if (caller.isOwner) return;
  const owner = await db.userRole.count({ where: { userId, role: { code: SYSTEM_ROLES.OWNER_ADMIN } } });
  if (owner) throw new ForbiddenException('Only an Owner / Admin can change an Owner / Admin');
}
