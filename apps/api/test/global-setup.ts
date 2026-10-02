import pg from 'pg';
import { testEnv } from '../vitest.config';

/** Setzt die Testdatenbank vor jedem Testlauf komplett zurück und migriert sie neu. */
export default async function setup(): Promise<void> {
  Object.assign(process.env, testEnv);
  const client = new pg.Client({ connectionString: testEnv.DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
  const { runMigrations } = await import('../src/core/db/migrate');
  const { pool, db } = await import('../src/core/db/client');
  const { ensureLegalTemplates, ensureSettings } = await import('../src/scripts/seed-base');
  await runMigrations();
  await db.transaction(async (tx) => {
    await ensureLegalTemplates(tx);
    await ensureSettings(tx);
  });
  await pool.end();
}
