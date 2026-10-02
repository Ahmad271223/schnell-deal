import { pool } from '../core/db/client';
import { runMigrations } from '../core/db/migrate';

/** Migrationen ausführen (z. B. im Deployment vor dem Start neuer Instanzen). */
runMigrations()
  .then(async () => {
    console.log('Migrationen ausgeführt.');
    await pool.end();
  })
  .catch(async (err) => {
    console.error('Migration fehlgeschlagen:', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
