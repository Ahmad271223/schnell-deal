import { sql } from 'drizzle-orm';
import { DEFAULT_SETTINGS, type LegalKind } from '@sd/shared';
import { schema, type DbOrTx } from '../core/db/client';
import { hashPassword } from '../core/auth';
import { getSettings, saveSettings } from '../core/settings';

/**
 * Rechtstexte sind bewusst NUR Vorlagen (Spec §61). Die finalen Texte werden juristisch
 * geprüft und anschließend im Admin-Bereich als neue Version veröffentlicht.
 */
const LEGAL_TEMPLATES: Record<LegalKind, { title: string; content: string }> = {
  TERMS: {
    title: 'Allgemeine Geschäftsbedingungen (Vorlage)',
    content:
      '[VORLAGE – NICHT RECHTSVERBINDLICH]\n\nDieser Text ist ein Platzhalter. Die Allgemeinen Geschäftsbedingungen werden vom Plattformbetreiber nach juristischer Prüfung im Administrationsbereich als neue Version hinterlegt.',
  },
  BIDDER_TERMS: {
    title: 'Bieter- und Auktionsbedingungen (Vorlage)',
    content:
      '[VORLAGE – NICHT RECHTSVERBINDLICH]\n\nMit Abgabe des Gebots geben Sie ein verbindliches Kaufangebot gemäß den geltenden Auktions- und Geschäftsbedingungen ab.\n\nDie vollständigen Bieterbedingungen werden vom Plattformbetreiber nach juristischer Prüfung im Administrationsbereich als neue Version hinterlegt.',
  },
  PRIVACY: {
    title: 'Datenschutzerklärung (Vorlage)',
    content:
      '[VORLAGE – NICHT RECHTSVERBINDLICH]\n\nDieser Text ist ein Platzhalter. Die Datenschutzerklärung wird vom Plattformbetreiber nach juristischer Prüfung im Administrationsbereich als neue Version hinterlegt.',
  },
};

export async function ensureLegalTemplates(tx: DbOrTx): Promise<void> {
  for (const [kind, t] of Object.entries(LEGAL_TEMPLATES) as [LegalKind, { title: string; content: string }][]) {
    await tx
      .insert(schema.legalDocuments)
      .values({ kind, version: '0.1-vorlage', title: t.title, content: t.content, activeFrom: new Date('2026-01-01T00:00:00Z') })
      .onConflictDoNothing();
  }
}

export async function ensureSettings(tx: DbOrTx): Promise<void> {
  const current = await getSettings(tx);
  await saveSettings(tx, { ...DEFAULT_SETTINGS, ...current }, null);
}

export async function ensureSuperadmin(tx: DbOrTx, email: string, password: string): Promise<string> {
  const existing = await tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
  if (existing[0]) return existing[0].id;
  const [u] = await tx
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword(password), firstName: 'Plattform', lastName: 'Admin', platformRole: 'SUPERADMIN' })
    .returning({ id: schema.users.id });
  return u!.id;
}
