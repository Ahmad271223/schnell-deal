import { and, eq, inArray } from 'drizzle-orm';
import type { NotificationType } from '@sd/shared';
import { schema, type DbOrTx } from '../../core/db/client';
import { publish, channels } from '../../core/realtime';
import { enqueue } from '../../core/jobs';
import { config } from '../../config';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  data?: Record<string, unknown>;
  /** E-Mail zusätzlich versenden (Standard: true). */
  email?: boolean;
}

/**
 * Legt In-App-Benachrichtigungen an, sendet sie per WebSocket an den Benutzer und reiht
 * E-Mail- und Push-Versand als Jobs ein. Alles in der aufrufenden Transaktion → atomar.
 */
export async function notifyUsers(tx: DbOrTx, userIds: string[], n: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const users = await tx
    .select({ id: schema.users.id, email: schema.users.email, isActive: schema.users.isActive })
    .from(schema.users)
    .where(inArray(schema.users.id, unique));
  for (const u of users) {
    if (!u.isActive) continue;
    const wantEmail = n.email ?? true;
    const [row] = await tx
      .insert(schema.notifications)
      .values({
        userId: u.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        data: n.data ?? null,
        emailStatus: wantEmail ? 'QUEUED' : null,
      })
      .returning({ id: schema.notifications.id, createdAt: schema.notifications.createdAt });
    await publish(tx, channels.user(u.id), 'notification', {
      id: row!.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      createdAt: row!.createdAt.toISOString(),
    });
    if (wantEmail) {
      await enqueue(tx, 'email.send', {
        notificationId: row!.id,
        to: u.email,
        subject: n.title,
        text: `${n.body}${n.link ? `\n\n${config.PUBLIC_WEB_URL}${n.link}` : ''}`,
      });
    }
    if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
      await enqueue(tx, 'push.send', { userId: u.id, title: n.title, body: n.body, link: n.link ?? null }, { maxAttempts: 2 });
    }
  }
}

export async function companyUserIds(tx: DbOrTx, companyId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.companyUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.companyUsers.userId))
    .where(and(eq(schema.companyUsers.companyId, companyId), eq(schema.users.isActive, true)));
  return rows.map((r) => r.id);
}

export async function notifyCompany(tx: DbOrTx, companyId: string, n: NotificationInput): Promise<void> {
  await notifyUsers(tx, await companyUserIds(tx, companyId), n);
}

export async function adminUserIds(tx: DbOrTx): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.platformRole, ['ADMIN', 'SUPERADMIN']), eq(schema.users.isActive, true)));
  return rows.map((r) => r.id);
}

export async function notifyAdmins(tx: DbOrTx, n: NotificationInput): Promise<void> {
  await notifyUsers(tx, await adminUserIds(tx), n);
}
