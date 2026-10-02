import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { config } from '../../config';

// BIGINT (int8) als number parsen: Beträge in Cent bleiben weit unter 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC als number (Koordinaten, Profiltiefe, Spannung).
pg.types.setTypeParser(1700, (v) => Number(v));

/*
 * Keine stillen Hänger (Spezifikation §50): Jede Verbindung hat Zeitlimits.
 * - connectionTimeoutMillis: Warten auf eine freie Pool-Verbindung bricht ab, statt ewig zu blockieren.
 * - statement_timeout (serverseitig) und query_timeout (clientseitig, greift auch bei halb offenen TCP-Verbindungen):
 *   eine hängende Abfrage bricht mit Fehler ab; Gebote sind über clientRequestId idempotent und können wiederholt werden.
 * - idle_in_transaction_session_timeout: eine Transaktion, die nicht mehr fortgesetzt wird, hält keine Sperren mehr.
 * - keepAlive: abgerissene Verbindungen werden erkannt statt still zu warten.
 * Migrationen laufen bewusst ohne diese Limits (siehe migrate.ts).
 */
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
  statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
  query_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS + 5_000,
  idle_in_transaction_session_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: `schnelldeal-${process.env.WORKER_MODE === 'separate' && process.argv[1]?.includes('worker') ? 'worker' : 'api'}`,
});

pool.on('error', (err) => {
  console.error('[db] Unerwarteter Pool-Fehler', err);
});

export const db = drizzle(pool, { schema, casing: undefined });
export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;
export { schema };
