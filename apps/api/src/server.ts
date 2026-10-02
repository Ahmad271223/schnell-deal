import { sql } from 'drizzle-orm';
import { buildApp } from './app';
import { config } from './config';
import { db, pool } from './core/db/client';
import { runMigrations } from './core/db/migrate';
import { hub } from './core/realtime';
import { createWorker } from './jobs/handlers';
import { AuctionScheduler } from './modules/auctions/scheduler';

async function migrateWithLock(): Promise<void> {
  // Advisory Lock verhindert parallele Migrationen bei mehreren Instanzen.
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(424242)');
    await runMigrations();
  } finally {
    await client.query('select pg_advisory_unlock(424242)').catch(() => undefined);
    client.release();
  }
}

// Keine stillen Abstürze: unbehandelte Ablehnungen werden protokolliert (der Prozess läuft weiter, da der
// gesamte Auktionszustand transaktional in der Datenbank liegt); echte Ausnahmen führen zu kontrolliertem Neustart.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[process] Unbehandelte Promise-Ablehnung:', reason instanceof Error ? reason.stack : reason, promise);
});
process.on('uncaughtException', (err, origin) => {
  console.error(`[process] Unbehandelte Ausnahme (${origin}):`, err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {
  await migrateWithLock();
  const app = await buildApp();
  await hub.start();

  const worker = config.WORKER_MODE === 'inline' ? createWorker() : null;
  worker?.start();

  const scheduler = config.SCHEDULER_ENABLED ? new AuctionScheduler() : null;
  scheduler?.start();

  await app.listen({ port: config.PORT, host: config.HOST });
  const [{ now }] = (await db.execute<{ now: string }>(sql`select now()::text as now`)).rows as [{ now: string }];
  app.log.info(`API bereit auf :${config.PORT} (DB-Zeit ${now}, Worker: ${config.WORKER_MODE}, Scheduler: ${config.SCHEDULER_ENABLED})`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.warn(`${signal} empfangen, fahre herunter …`);
    scheduler?.stop();
    await app.close();
    await worker?.stop();
    await hub.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
