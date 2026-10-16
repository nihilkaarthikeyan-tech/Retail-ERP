// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable } from '@nestjs/common';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Any Prisma client: the main one or a transaction client. */
export type Db = Prisma.TransactionClient;

export type AuditAction =
  | 'create'
  | 'update'
  | 'login'
  | 'login_failed'
  | 'login_locked'
  | 'logout'
  | 'password_change'
  | 'password_reset'
  | 'sessions_ended'
  | 'counter_change'
  | 'setup'
  /** A report downloaded for Excel (blueprint 14: every export is logged). */
  | 'export'
  /** A document printed (blueprint 16: every print is logged). */
  | 'print';

export const LOGIN_ACTIONS: AuditAction[] = ['login', 'login_failed', 'login_locked', 'logout'];

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  changes?: Prisma.InputJsonValue | null;
  reason?: string | null;
}

export type FieldChanges = Record<string, { old: unknown; new: unknown }>;

/** Fields never written to the history, whatever the record. */
const HIDDEN_FIELDS = new Set(['passwordHash', 'tokenHash', 'logo', 'updatedAt', 'updatedById']);

/**
 * Compares two plain records and returns only the fields whose value changed.
 * Dates are compared by their ISO form so a reload does not look like a change.
 */
export function diffRecords(before: Record<string, unknown>, after: Record<string, unknown>): FieldChanges {
  const changes: FieldChanges = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (HIDDEN_FIELDS.has(key)) continue;
    const oldValue = normalise(before[key]);
    const newValue = normalise(after[key]);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { old: oldValue, new: newValue };
    }
  }
  return changes;
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one history row. Pass the transaction client so the row is saved
   * in the same transaction as the change it describes (reliability rule 5).
   */
  async record(db: Db, actor: Actor, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        changes: entry.changes ?? undefined,
        reason: entry.reason ?? null,
      },
    });
  }

  /** Convenience for changes outside a transaction (e.g. login attempts). */
  async recordNow(actor: Actor, entry: AuditEntry): Promise<void> {
    await this.record(this.prisma, actor, entry);
  }

  /** Records an update only if something actually changed. */
  async recordUpdate(
    db: Db,
    actor: Actor,
    entityType: string,
    entityId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    reason?: string | null,
  ): Promise<FieldChanges> {
    const changes = diffRecords(before, after);
    if (Object.keys(changes).length > 0) {
      await this.record(db, actor, {
        action: 'update',
        entityType,
        entityId,
        changes: changes as Prisma.InputJsonValue,
        reason,
      });
    }
    return changes;
  }
}
