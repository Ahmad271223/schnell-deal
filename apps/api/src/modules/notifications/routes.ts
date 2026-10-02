import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { uuidSchema } from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { parse } from '../../core/errors';
import { getAuth, requireAuth } from '../../core/auth';
import { config } from '../../config';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/notifications', async (req) => {
    const u = getAuth(req);
    const q = parse(z.object({ unread: z.enum(['1']).optional() }), req.query);
    const items = await db
      .select({
        id: schema.notifications.id,
        type: schema.notifications.type,
        title: schema.notifications.title,
        body: schema.notifications.body,
        link: schema.notifications.link,
        readAt: schema.notifications.readAt,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, u.userId), q.unread ? isNull(schema.notifications.readAt) : undefined))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(100);
    const [unread] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, u.userId), isNull(schema.notifications.readAt)));
    return { items, unreadCount: unread?.n ?? 0 };
  });

  app.post('/notifications/read', async (req) => {
    const u = getAuth(req);
    const input = parse(z.object({ ids: z.array(uuidSchema).max(200).optional(), all: z.boolean().optional() }), req.body);
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, u.userId),
          isNull(schema.notifications.readAt),
          input.all ? undefined : inArray(schema.notifications.id, input.ids ?? []),
        ),
      );
    return { ok: true };
  });

  app.get('/notifications/push-key', async () => ({ publicKey: config.VAPID_PUBLIC_KEY ?? null }));

  app.post('/notifications/push-subscribe', async (req) => {
    const u = getAuth(req);
    const input = parse(
      z.object({
        endpoint: z.string().url().max(1000),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
      }),
      req.body,
    );
    await db
      .insert(schema.pushSubscriptions)
      .values({ userId: u.userId, endpoint: input.endpoint, keys: input.keys })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId: u.userId, keys: input.keys } });
    return { ok: true };
  });
}
