import pg from 'pg';

/** Setzt die E2E-Datenbank vollständig zurück (nur schnelldeal_e2e!). */
const url = process.env.DATABASE_URL;
if (!url || !url.endsWith('/schnelldeal_e2e')) {
  console.error('Abbruch: reset-db.mjs darf nur auf der Datenbank schnelldeal_e2e laufen.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE');
await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
await client.query('CREATE SCHEMA public');
await client.end();
console.log('E2E-Datenbank zurückgesetzt.');
