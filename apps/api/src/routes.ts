import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from './core/db/client';
import { storageHealthy } from './core/storage';
import { hub } from './core/realtime';
import { config } from './config';
import { schedulerStatus } from './modules/auctions/scheduler';
import { authRoutes } from './modules/auth/routes';
import { companyRoutes } from './modules/companies/routes';
import { adminRoutes } from './modules/admin/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { inspectionRoutes } from './modules/inspections/routes';
import { vehicleRoutes } from './modules/vehicles/routes';
import { vinRecognitionRoutes } from './modules/vehicles/vin-recognition';
import { catalogRoutes } from './modules/catalogs/routes';
import { auctionRoutes } from './modules/auctions/routes';
import { dealRoutes } from './modules/deals/routes';
import { statsRoutes } from './modules/stats/routes';
import { realtimeRoutes } from './modules/realtime/routes';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const dbOk = await db
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false);
    const storageOk = await storageHealthy();
    // Auktionstakt: Nach der Startphase muss in dieser Instanz regelmäßig ein Takt gelingen, sonst enden Auktionen nicht.
    const lastTick = schedulerStatus.lastTickAt ? Date.parse(schedulerStatus.lastTickAt) : null;
    const schedulerStale = config.SCHEDULER_ENABLED && process.uptime() > 60 && (lastTick === null || Date.now() - lastTick > 60_000);
    const ok = dbOk && storageOk && !schedulerStale;
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      db: dbOk,
      storage: storageOk,
      scheduler: { enabled: config.SCHEDULER_ENABLED, lastTickAt: schedulerStatus.lastTickAt, stale: schedulerStale, lastError: schedulerStatus.lastError },
      websocketConnections: hub.connectionCount(),
      serverTime: new Date().toISOString(),
    });
  });

  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  await app.register(inspectionRoutes);
  await app.register(vehicleRoutes);
  await app.register(vinRecognitionRoutes);
  await app.register(catalogRoutes);
  await app.register(auctionRoutes);
  await app.register(dealRoutes);
  await app.register(statsRoutes);
  await app.register(realtimeRoutes);
}
