import type { AuditEvent } from '@sd/shared';
import { schema, type DbOrTx } from './db/client';

export interface Actor {
  userId: string | null;
  role: string | null;
  companyId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null, role: 'SYSTEM', companyId: null };

export interface AuditEntry {
  event: AuditEvent;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Schreibt einen Audit-Eintrag. Immer innerhalb derselben Transaktion wie die fachliche Änderung
 * aufrufen, damit Änderung und Protokoll atomar sind. Die Tabelle ist per Trigger append-only.
 */
export async function audit(tx: DbOrTx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorCompanyId: actor.companyId,
    event: entry.event,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValue: sanitize(entry.oldValue),
    newValue: sanitize(entry.newValue),
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ? actor.userAgent.slice(0, 300) : null,
  });
}

const SECRET_KEYS = new Set(['password', 'passwordHash', 'password_hash', 'tokenHash', 'token']);

function sanitize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k) ? '[entfernt]' : sanitize(v);
  }
  return out;
}

/** Liefert nur die geänderten Felder (für kompakte alt/neu-Einträge). */
export function diff<T extends Record<string, unknown>>(before: T, changes: Partial<T>): { old: Partial<T>; new: Partial<T> } {
  const o: Partial<T> = {};
  const n: Partial<T> = {};
  for (const key of Object.keys(changes) as (keyof T)[]) {
    const a = before[key];
    const b = changes[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      o[key] = a;
      n[key] = b as T[keyof T];
    }
  }
  return { old: o, new: n };
}
