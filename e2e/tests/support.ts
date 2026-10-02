import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E } from '../playwright.config';

export const PASSWORD = 'E2e-Passwort-2026';
const FIXTURES = path.join(process.cwd(), 'test-results', 'fixtures');

/** Kontrastreiches Test-JPEG (besteht die Qualitätsprüfung); jeder Seed ergibt ein anderes Bild. */
export async function photo(seed: number): Promise<string> {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const file = path.join(FIXTURES, `photo-${seed}.jpg`);
  if (fs.existsSync(file)) return file;
  const w = 800;
  const h = 600;
  const raw = Buffer.alloc(w * h * 3);
  let s = seed * 7919;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (((x >> 3) + (y >> 3) + seed) % 2 === 0 ? 70 : 190) + ((s >> 16) % 30) - 15;
      const i = (y * w + x) * 3;
      raw[i] = v;
      raw[i + 1] = Math.min(255, v + (seed % 40));
      raw[i + 2] = v;
    }
  }
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toFile(file);
  return file;
}

export function pdfFile(): string {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const file = path.join(FIXTURES, 'gewerbe.pdf');
  fs.writeFileSync(
    file,
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );
  return file;
}

/** Exakter Label-Treffer; erlaubt das optionale Pflichtfeld-Sternchen im Label-Text ("Straße *"). */
export function L(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\s*\\*)?$`);
}

export function uniq(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function login(browser: Browser, email: string, password: string, opts: { mobile?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(opts.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(L('E-Mail')).fill(email);
  await page.getByLabel(L('Passwort')).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { context, page };
}

/** Direkter API-Aufruf mit Session eines Browser-Kontexts (für Vorbedingungen außerhalb des getesteten Ablaufs). */
export async function apiAs(context: BrowserContext, method: string, url: string, body?: unknown) {
  const res = await context.request.fetch(`${E2E.web}/api/v1${url}`, {
    method,
    data: body,
    headers: { origin: E2E.web },
  });
  return res;
}

export async function expectNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return () => expect(errors, `Fehler in der Browser-Konsole: ${errors.join('\n')}`).toEqual([]);
}
