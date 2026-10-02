import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../../config';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migrationen laufen auf einer eigenen Verbindung ohne Abfrage-Zeitlimit:
 * Schemaänderungen (z. B. Indexaufbau) dürfen länger dauern als eine normale Anfrage.
 */
export async function runMigrations(): Promise<void> {
  const folder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../../../drizzle');
  const client = new pg.Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS, application_name: 'schnelldeal-migrate' });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}
