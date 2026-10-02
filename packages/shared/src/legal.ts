import { LEGAL_KINDS, type LegalKind } from './enums';

/** Kennzeichnung der mitgelieferten Rechtstext-Vorlagen (Spec §61): Version „…-vorlage“ oder Inhalt beginnt mit „[VORLAGE“. */
export function isLegalTemplate(doc: { version: string; content: string }): boolean {
  return doc.version.toLowerCase().endsWith('-vorlage') || doc.content.trimStart().toUpperCase().startsWith('[VORLAGE');
}

/** Rechtstexte, die vor dem ersten echten Handel ersetzt sein müssen. Das Impressum braucht keine Zustimmung, aber einen echten Inhalt. */
export const LEGAL_KINDS_REQUIRED_FOR_LIVE: readonly LegalKind[] = LEGAL_KINDS;

/**
 * Welche Rechtstext-Arten noch nicht live-fähig sind: fehlende Dokumente und solche, deren aktuelle Fassung eine Vorlage ist.
 * `active` = je Art die aktuell gültige Fassung.
 */
export function legalTemplateKinds(active: { kind: LegalKind; version: string; content: string }[]): LegalKind[] {
  return LEGAL_KINDS_REQUIRED_FOR_LIVE.filter((kind) => {
    const doc = active.find((d) => d.kind === kind);
    return !doc || isLegalTemplate(doc);
  });
}
