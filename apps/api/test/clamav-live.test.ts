import { describe, expect, it } from 'vitest';
import { clamdInstream, validateUpload, DOCUMENT_MIME } from '../src/core/storage';

/**
 * Prüfung gegen einen ECHTEN clamd (Compose-Dienst "clamav"). Läuft nur, wenn CLAMAV_HOST gesetzt ist:
 *   docker compose --profile scan up -d clamav   (erster Start lädt Signaturen, einige Minuten)
 *   CLAMAV_HOST=localhost pnpm --filter @sd/api exec vitest run test/clamav-live.test.ts
 */
const host = process.env.CLAMAV_HOST;
const port = Number(process.env.CLAMAV_PORT ?? 3310);
// EICAR-Testdatei: harmlose Standardzeichenkette, die jeder Virenscanner als Testsignatur erkennt.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const CLEAN_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

describe.skipIf(!host)('ClamAV live', () => {
  it('erkennt die EICAR-Testsignatur über den eingebauten INSTREAM-Client', async () => {
    const r = await clamdInstream(Buffer.from(EICAR), host!, port);
    expect(r.infected).toBe(true);
    expect(r.signature).toMatch(/eicar/i);
  }, 60_000);

  it('gibt eine saubere Datei frei', async () => {
    expect(await clamdInstream(CLEAN_PDF, host!, port)).toEqual({ infected: false });
  }, 60_000);

  it('lässt die vollständige Upload-Prüfung mit aktivem Scanner passieren', async () => {
    const v = await validateUpload(CLEAN_PDF, DOCUMENT_MIME);
    expect(v.mime).toBe('application/pdf');
  }, 60_000);
});
