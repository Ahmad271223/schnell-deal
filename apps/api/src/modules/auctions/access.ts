import { and, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type DbOrTx } from '../../core/db/client';
import type { AuthUser } from '../../core/auth';

/**
 * Sichtbarkeit von Auktionen für Händler (serverseitig in jede Abfrage eingebaut):
 * - nur freigegebene Händlerfirmen
 * - geplante und laufende Auktionen der eigenen Händlergruppe (oder ohne Gruppenbeschränkung)
 * - beendete/abgebrochene Auktionen nur, wenn der Händler darauf geboten oder sie beobachtet hat
 * - Entwürfe nie
 */
export function dealerAuctionVisibility(user: AuthUser): SQL {
  const c = user.company;
  if (!c || c.type !== 'DEALER' || c.status !== 'APPROVED') return sql`false`;
  // Spalten in den Unterabfragen ausdrücklich mit Tabellennamen: Drizzle lässt ihn bei Abfragen über eine einzige
  // Tabelle weg, und ein unqualifiziertes "id"/"vehicle_id" würde dann an die innere Tabelle (bids, watchlist) binden.
  const a = schema.auctions;
  const groupOk = sql`(${a.dealerGroupId} IS NULL OR EXISTS (
    SELECT 1 FROM dealer_group_members m WHERE m.group_id = ${a}.dealer_group_id AND m.company_id = ${c.id}))`;
  const participated = sql`(EXISTS (SELECT 1 FROM bids b WHERE b.auction_id = ${a}.id AND b.company_id = ${c.id})
    OR EXISTS (SELECT 1 FROM watchlist w WHERE w.vehicle_id = ${a}.vehicle_id AND w.company_id = ${c.id}))`;
  return sql`(
    (${schema.auctions.status} IN ('SCHEDULED','ACTIVE') AND ${groupOk})
    OR (${schema.auctions.status} IN ('ENDED','CANCELLED') AND ${participated})
  )`;
}

/** Darf ein Händler Fotos/Dokumente eines Fahrzeugs sehen? (sichtbare Auktion oder gekauftes Fahrzeug) */
export async function buyerCanSeeVehicle(tx: DbOrTx, user: AuthUser, vehicleId: string): Promise<boolean> {
  const c = user.company;
  if (!c || c.type !== 'DEALER' || c.status !== 'APPROVED') return false;
  const [a] = await tx
    .select({ id: schema.auctions.id })
    .from(schema.auctions)
    .where(and(eq(schema.auctions.vehicleId, vehicleId), dealerAuctionVisibility(user)))
    .limit(1);
  if (a) return true;
  const [d] = await tx
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(and(eq(schema.deals.vehicleId, vehicleId), eq(schema.deals.buyerCompanyId, c.id)))
    .limit(1);
  return !!d;
}
