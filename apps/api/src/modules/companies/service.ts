import { and, eq, sql } from 'drizzle-orm';
import { assertTransition, COMPANY_DOCUMENT_KINDS, type CompanyDocumentKind, type CompanyStatus } from '@sd/shared';
import { schema, type DbOrTx } from '../../core/db/client';
import { audit, type Actor } from '../../core/audit';
import { AppError, notFound } from '../../core/errors';
import { DOCUMENT_MIME, newStorageKey, putObject, validateUpload } from '../../core/storage';
import { revokeCompanySessions } from '../../core/auth';
import { notifyAdmins, notifyCompany } from '../notifications/service';

export type Company = typeof schema.companies.$inferSelect;

export async function getCompany(tx: DbOrTx, id: string): Promise<Company> {
  const [c] = await tx.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1);
  if (!c) throw notFound('Unternehmen');
  return c;
}

export async function lockCompany(tx: DbOrTx, id: string): Promise<Company> {
  const [c] = await tx.select().from(schema.companies).where(eq(schema.companies.id, id)).for('update').limit(1);
  if (!c) throw notFound('Unternehmen');
  return c;
}

export async function setCompanyStatus(
  tx: DbOrTx,
  actor: Actor,
  company: Company,
  to: CompanyStatus,
  note: string | null,
): Promise<void> {
  assertTransition('company', company.status, to);
  await tx
    .update(schema.companies)
    .set({
      status: to,
      reviewNote: note,
      reviewedBy: actor.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.companies.id, company.id));
  await audit(tx, actor, {
    event: 'COMPANY_STATUS_CHANGED',
    entityType: 'company',
    entityId: company.id,
    oldValue: { status: company.status },
    newValue: { status: to, note },
  });

  if (to === 'APPROVED') {
    if (company.type === 'DEALER') {
      // Geprüfte Händler dürfen bieten; der Admin kann dies jederzeit einschränken.
      const [v] = await tx.select().from(schema.dealerVerifications).where(eq(schema.dealerVerifications.companyId, company.id));
      if (!v || v.biddingStatus === 'VIEW_ONLY') {
        await tx
          .insert(schema.dealerVerifications)
          .values({ companyId: company.id, biddingStatus: 'CAN_BID', reviewedBy: actor.userId, reviewedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.dealerVerifications.companyId,
            set: { biddingStatus: 'CAN_BID', reviewedBy: actor.userId, reviewedAt: new Date(), updatedAt: new Date() },
          });
        await audit(tx, actor, {
          event: 'BIDDING_STATUS_CHANGED',
          entityType: 'company',
          entityId: company.id,
          oldValue: { biddingStatus: v?.biddingStatus ?? null },
          newValue: { biddingStatus: 'CAN_BID', reason: 'Freigabe' },
        });
      }
    }
    await notifyCompany(tx, company.id, {
      type: 'ACCOUNT_APPROVED',
      title: 'Ihr Unternehmenskonto wurde freigegeben',
      body: `${company.name} ist jetzt für die Plattform freigeschaltet.`,
      link: '/',
    });
  } else if (to === 'REJECTED') {
    await notifyCompany(tx, company.id, {
      type: 'ACCOUNT_REJECTED',
      title: 'Ihre Registrierung wurde abgelehnt',
      body: note ? `Begründung: ${note}` : 'Bitte wenden Sie sich an den Plattformbetreiber.',
    });
  } else if (to === 'DOCUMENTS_MISSING') {
    await notifyCompany(tx, company.id, {
      type: 'ACCOUNT_DOCUMENTS_MISSING',
      title: 'Unterlagen fehlen',
      body: note ? `Bitte reichen Sie folgende Unterlagen nach: ${note}` : 'Bitte laden Sie Ihren Gewerbenachweis hoch.',
      link: '/registrierung/status',
    });
  } else if (to === 'BLOCKED') {
    await deactivateMaxBids(tx, actor, company.id, 'Unternehmen gesperrt');
    await notifyCompany(tx, company.id, {
      type: 'ACCOUNT_BLOCKED',
      title: 'Ihr Unternehmenskonto wurde gesperrt',
      body: note ? `Begründung: ${note}` : 'Bitte wenden Sie sich an den Plattformbetreiber.',
    });
    await revokeCompanySessions(tx, company.id);
  }
}

/** Bietagenten eines gesperrten Händlers stoppen; bereits abgegebene Gebote bleiben verbindlich. */
export async function deactivateMaxBids(tx: DbOrTx, actor: Actor, companyId: string, reason: string): Promise<void> {
  const res = await tx
    .update(schema.maximumBids)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(schema.maximumBids.companyId, companyId), eq(schema.maximumBids.active, true)))
    .returning({ id: schema.maximumBids.id, auctionId: schema.maximumBids.auctionId });
  if (res.length) {
    await audit(tx, actor, {
      event: 'MAX_BID_REMOVED',
      entityType: 'company',
      entityId: companyId,
      newValue: { reason, auctions: res.map((r) => r.auctionId) },
    });
  }
}

export async function storeCompanyDocument(
  tx: DbOrTx,
  actor: Actor,
  company: Company,
  kindRaw: string | undefined,
  file: { buffer: Buffer; fileName: string },
): Promise<{ id: string }> {
  const kind = (COMPANY_DOCUMENT_KINDS as readonly string[]).includes(kindRaw ?? '')
    ? (kindRaw as CompanyDocumentKind)
    : null;
  if (!kind) throw new AppError(400, 'INVALID_KIND', 'Ungültige Dokumentart.');
  const v = await validateUpload(file.buffer, DOCUMENT_MIME);
  const key = newStorageKey(`companies/${company.id}`, v.ext);
  await putObject(key, file.buffer, v.mime);
  const [doc] = await tx
    .insert(schema.companyDocuments)
    .values({
      companyId: company.id,
      kind,
      fileName: file.fileName,
      storageKey: key,
      mime: v.mime,
      sizeBytes: v.size,
      sha256: v.sha256,
      uploadedBy: actor.userId,
    })
    .returning({ id: schema.companyDocuments.id });
  await audit(tx, actor, {
    event: 'COMPANY_DOCUMENT_UPLOADED',
    entityType: 'company',
    entityId: company.id,
    newValue: { documentId: doc!.id, kind, fileName: file.fileName, sha256: v.sha256 },
  });
  if (kind === 'TRADE_LICENSE' && (company.status === 'REGISTRATION_STARTED' || company.status === 'DOCUMENTS_MISSING')) {
    await setCompanyStatus(tx, actor, company, 'IN_REVIEW', null);
    await notifyAdmins(tx, {
      type: 'COMPANY_REGISTERED',
      title: `Neue Registrierung zur Prüfung: ${company.name}`,
      body: `${company.type === 'DEALER' ? 'Händler' : 'Autohaus'} ${company.name} (${company.zip} ${company.city}) wartet auf Prüfung.`,
      link: `/admin/unternehmen/${company.id}`,
    });
  }
  return { id: doc!.id };
}

export async function hasTradeLicense(tx: DbOrTx, companyId: string): Promise<boolean> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.companyDocuments)
    .where(and(eq(schema.companyDocuments.companyId, companyId), eq(schema.companyDocuments.kind, 'TRADE_LICENSE')));
  return (r?.n ?? 0) > 0;
}
