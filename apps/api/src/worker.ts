import { pool } from './core/db/client';
import { createWorker } from './jobs/handlers';

/** Separater Worker-Prozess (WORKER_MODE=separate): E-Mails, PDFs, Bildverarbeitung, Push. */
process.on('unhandledRejection', (reason) => console.error('[worker] Unbehandelte Promise-Ablehnung:', reason instanceof Error ? reason.stack : reason));
process.on('uncaughtException', (err) => {
  console.error('[worker] Unbehandelte Ausnahme:', err instanceof Error ? err.stack : err);
  process.exit(1);
});

const worker = createWorker();
worker.start();
console.log('[worker] gestartet');

const shutdown = async () => {
  console.log('[worker] beende nach laufenden Jobs …');
  await worker.stop();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
