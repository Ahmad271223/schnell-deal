import { describe, expect, it } from 'vitest';
import { db } from '../src/core/db/client';
import { config, productionConfigProblems } from '../src/config';
import { assertLegalReadyForAuctions, pendingLegalTemplates } from '../src/modules/legal/service';
import { api, createPlatformUser, json } from './helpers';

/** Schutz gegen Livegang mit Vorlagen (§61) und gegen Platzhalter in der Produktionskonfiguration. */
describe('Livegang-Schutz', () => {
  it('erkennt die mitgelieferten Rechtstext-Vorlagen inklusive Impressum und sperrt Auktionen nur bei erzwungener Prüfung', async () => {
    const kinds = await pendingLegalTemplates(db);
    expect(kinds).toEqual(expect.arrayContaining(['TERMS', 'BIDDER_TERMS', 'PRIVACY', 'IMPRINT']));
    await expect(assertLegalReadyForAuctions(db, false)).resolves.toBeUndefined();
    await expect(assertLegalReadyForAuctions(db, true)).rejects.toMatchObject({ statusCode: 409, code: 'LEGAL_TEMPLATES_ACTIVE' });

    const superadmin = await createPlatformUser('SUPERADMIN');
    const current = json(await api('GET', '/legal/current'));
    expect(current.map((d: { kind: string }) => d.kind).sort()).toEqual(['BIDDER_TERMS', 'IMPRINT', 'PRIVACY', 'TERMS']);
    const system = json(await api('GET', '/admin/system', { session: superadmin }));
    expect(system.legalTemplates).toEqual(expect.arrayContaining(['IMPRINT']));
    expect(system.legalEnforced).toBe(false);
    expect(system.environment).toBe(config.NODE_ENV);

    // Das Impressum braucht keine Zustimmung: es taucht nicht in der Zustimmungsliste auf.
    const me = json(await api('GET', '/auth/me', { session: superadmin }));
    expect((me.pendingLegal ?? []).map((d: { kind: string }) => d.kind)).not.toContain('IMPRINT');

    // Ein echtes Impressum löst die Vorlage ab (die übrigen Arten bleiben Vorlagen).
    const version = `1.${Date.now() % 1_000_000}`;
    const created = await api('POST', '/admin/legal', { session: superadmin, body: { kind: 'IMPRINT', version, title: 'Impressum', content: 'Beispiel GmbH, Musterstraße 1, 30159 Hannover.' } });
    expect(created.statusCode, created.body).toBe(201);
    try {
      expect(await pendingLegalTemplates(db)).not.toContain('IMPRINT');
      await expect(assertLegalReadyForAuctions(db, true)).rejects.toMatchObject({ details: { kinds: expect.not.arrayContaining(['IMPRINT']) } });
    } finally {
      // Testdatenbank wird je Lauf neu aufgesetzt; das Dokument bleibt bis dahin und stört andere Tests nicht.
    }
  });

  it('lehnt Platzhalter und Entwicklungswerte für den Produktionsbetrieb ab', () => {
    const problems = productionConfigProblems({
      ...config,
      CLAMAV_HOST: undefined,
      S3_ACCESS_KEY: 'ersetzen',
      S3_SECRET_KEY: 'ersetzen',
      DATABASE_URL: 'postgres://schnelldeal:schnelldeal@postgres:5432/schnelldeal',
      SMTP_HOST: 'smtp.example.de',
      SMTP_USER: 'ersetzen',
      SMTP_PASS: 'ersetzen',
      ALLOWED_ORIGINS: 'https://auktion.example.de',
      PUBLIC_WEB_URL: 'https://auktion.example.de',
      S3_PUBLIC_ENDPOINT: 'https://storage.example.de',
    });
    expect(problems).toHaveLength(6);
    expect(problems.join(' ')).toMatch(/CLAMAV_HOST/);

    const ok = productionConfigProblems({
      ...config,
      CLAMAV_HOST: 'clamav',
      S3_ACCESS_KEY: 'AKIA-echt',
      S3_SECRET_KEY: 'geheim-und-lang',
      DATABASE_URL: 'postgres://schnelldeal:ganz-anderes-passwort@postgres:5432/schnelldeal',
      SMTP_HOST: 'smtp.anbieter.de',
      SMTP_USER: 'konto',
      SMTP_PASS: 'kennwort',
      ALLOWED_ORIGINS: 'https://auktion.firma.de',
      PUBLIC_WEB_URL: 'https://auktion.firma.de',
      S3_PUBLIC_ENDPOINT: 'https://storage.firma.de',
    });
    expect(ok).toEqual([]);
  });
});
