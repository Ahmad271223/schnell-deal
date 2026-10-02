import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { CompanyType, LegalKind } from '@sd/shared';
import { db, schema, type DbOrTx } from '../../core/db/client';

export type LegalDoc = typeof schema.legalDocuments.$inferSelect;

/** Aktuell gültige Version je Rechtstext-Art (neueste mit active_from <= jetzt). */
export async function activeLegalDocuments(tx: DbOrTx = db, kinds?: LegalKind[]): Promise<LegalDoc[]> {
  const rows = await tx
    .selectDistinctOn([schema.legalDocuments.kind])
    .from(schema.legalDocuments)
    .where(
      and(
        lte(schema.legalDocuments.activeFrom, sql`now()`),
        kinds ? inArray(schema.legalDocuments.kind, kinds) : undefined,
      ),
    )
    .orderBy(schema.legalDocuments.kind, desc(schema.legalDocuments.activeFrom), desc(schema.legalDocuments.createdAt));
  return rows;
}

export function requiredLegalKinds(companyType: CompanyType | null): LegalKind[] {
  if (companyType === 'DEALER') return ['TERMS', 'PRIVACY', 'BIDDER_TERMS'];
  return ['TERMS', 'PRIVACY'];
}

/** Rechtstexte, denen der Benutzer in der aktuell gültigen Version noch nicht zugestimmt hat. */
export async function pendingLegalDocuments(tx: DbOrTx, userId: string, companyType: CompanyType | null): Promise<LegalDoc[]> {
  const active = await activeLegalDocuments(tx, requiredLegalKinds(companyType));
  if (active.length === 0) return [];
  const accepted = await tx
    .select({ id: schema.legalAcceptances.legalDocumentId })
    .from(schema.legalAcceptances)
    .where(
      and(
        eq(schema.legalAcceptances.userId, userId),
        inArray(
          schema.legalAcceptances.legalDocumentId,
          active.map((d) => d.id),
        ),
      ),
    );
  const acceptedIds = new Set(accepted.map((a) => a.id));
  return active.filter((d) => !acceptedIds.has(d.id));
}

export async function recordAcceptances(
  tx: DbOrTx,
  params: { userId: string; companyId: string | null; docIds: string[]; ip: string | null; userAgent: string | null },
): Promise<void> {
  if (params.docIds.length === 0) return;
  await tx
    .insert(schema.legalAcceptances)
    .values(
      params.docIds.map((id) => ({
        userId: params.userId,
        companyId: params.companyId,
        legalDocumentId: id,
        ip: params.ip,
        userAgent: params.userAgent?.slice(0, 300) ?? null,
      })),
    )
    .onConflictDoNothing();
}

/** Hat der Benutzer der aktuell gültigen Bieterbedingung zugestimmt? (Pflicht vor jedem Gebot) */
export async function hasAcceptedCurrentBidderTerms(tx: DbOrTx, userId: string): Promise<boolean> {
  const pending = await pendingLegalDocuments(tx, userId, 'DEALER');
  return pending.length === 0;
}
