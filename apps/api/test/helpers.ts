import crypto from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { buildApp } from '../src/app';
import { db, schema } from '../src/core/db/client';
import { hashPassword } from '../src/core/auth';

let appPromise: Promise<FastifyInstance> | null = null;
export function getApp(): Promise<FastifyInstance> {
  if (!appPromise) appPromise = buildApp({ logger: false }).then(async (a) => (await a.ready(), a));
  return appPromise;
}

export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'Sicher12345!';

export function uniq(prefix = 'x'): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

export interface Session {
  cookie: string;
  userId: string;
  companyId?: string;
  email: string;
}

export async function api(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  opts: { session?: Session | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const app = await getApp();
  return app.inject({
    method,
    url: `/api/v1${url}`,
    payload: opts.body as never,
    headers: {
      origin: ORIGIN,
      ...(opts.session ? { cookie: opts.session.cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

export function json<T = any>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

function extractCookie(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const c = list.find((x) => x.startsWith('sd_session='));
  if (!c) throw new Error(`Kein Session-Cookie (Status ${res.statusCode}: ${res.body})`);
  return c.split(';')[0]!;
}

export async function login(email: string, password = PASSWORD): Promise<Session> {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.statusCode !== 200) throw new Error(`Login fehlgeschlagen ${res.statusCode}: ${res.body}`);
  const cookie = extractCookie(res);
  const me = json(await api('GET', '/auth/me', { session: { cookie } as Session }));
  return { cookie, userId: me.user.id, companyId: me.company?.id, email };
}

export async function createPlatformUser(role: 'SUPERADMIN' | 'ADMIN' | 'INSPECTOR', name = uniq(role.toLowerCase())): Promise<Session> {
  const email = `${name}@test.local`;
  await db.insert(schema.users).values({
    email,
    passwordHash: await hashPassword(PASSWORD),
    firstName: role === 'INSPECTOR' ? 'Max' : 'Admin',
    lastName: name,
    phone: '+49 511 000000',
    platformRole: role,
  });
  return login(email);
}

export function dealershipPayload(overrides: Record<string, unknown> = {}) {
  const n = uniq('ah');
  return {
    name: `Autohaus ${n}`,
    legalForm: 'GmbH',
    street: 'Hauptstraße',
    houseNumber: '1',
    zip: '30159',
    city: 'Hannover',
    website: null,
    registerNumber: 'HRB 12345',
    vatId: 'DE123456789',
    brands: ['VW', 'Audi'],
    firstName: 'Anna',
    lastName: 'Ahrens',
    phone: '+49 511 123456',
    email: `${n}@autohaus.test`,
    password: PASSWORD,
    acceptTerms: true,
    acceptPrivacy: true,
    ...overrides,
  };
}

export function dealerPayload(overrides: Record<string, unknown> = {}) {
  const n = uniq('hd');
  return {
    name: `Händler ${n}`,
    legalForm: 'e.K.',
    street: 'Industrieweg',
    houseNumber: '5',
    zip: '30880',
    city: 'Laatzen',
    website: null,
    registerNumber: null,
    vatId: 'DE987654321',
    tradeType: 'Kfz-Handel',
    bankIban: null,
    firstName: 'Bernd',
    lastName: 'Bieter',
    phone: '+49 511 654321',
    email: `${n}@haendler.test`,
    password: PASSWORD,
    acceptTerms: true,
    acceptPrivacy: true,
    acceptBidderTerms: true,
    ...overrides,
  };
}

/** Kleines gültiges PDF für Upload-Tests. */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export function multipart(fields: Record<string, string>, file: { name: string; content: Buffer; type: string }) {
  const boundary = `----sd${crypto.randomBytes(8).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
  );
  parts.push(file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function upload(url: string, session: Session, fields: Record<string, string>, file: { name: string; content: Buffer; type: string }) {
  const mp = multipart(fields, file);
  return api('POST', url, { session, body: mp.body, headers: mp.headers });
}

/** Erzeugt ein kontrastreiches JPEG (besteht die Qualitätsprüfung). */
export async function sharpJpeg(width = 1200, height = 900, seed = 1): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  let s = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const checker = ((x >> 3) + (y >> 3)) % 2 === 0 ? 70 : 190;
      const v = Math.max(0, Math.min(255, checker + ((s >> 16) % 30) - 15));
      const i = (y * width + x) * channels;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).jpeg({ quality: 85 }).toBuffer();
}

export async function darkJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer();
}

export async function blurryJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
}

/** Registriert ein Autohaus inkl. Gewerbenachweis und gibt es frei. */
export async function approvedDealership(admin: Session): Promise<Session & { companyId: string }> {
  const payload = dealershipPayload();
  const reg = await api('POST', '/register/dealership', { body: payload });
  if (reg.statusCode !== 201) throw new Error(`Registrierung fehlgeschlagen: ${reg.body}`);
  const s = await login(payload.email);
  const up = await upload('/company/documents', s, { kind: 'TRADE_LICENSE' }, { name: 'gewerbe.pdf', content: PDF_BYTES, type: 'application/pdf' });
  if (up.statusCode !== 201) throw new Error(`Upload fehlgeschlagen: ${up.body}`);
  const ap = await api('POST', `/admin/companies/${s.companyId}/status`, { session: admin, body: { action: 'approve' } });
  if (ap.statusCode !== 200) throw new Error(`Freigabe fehlgeschlagen: ${ap.body}`);
  return { ...(await login(payload.email)), companyId: s.companyId! };
}

export async function approvedDealer(admin: Session): Promise<Session & { companyId: string }> {
  const payload = dealerPayload();
  const reg = await api('POST', '/register/dealer', { body: payload });
  if (reg.statusCode !== 201) throw new Error(`Registrierung fehlgeschlagen: ${reg.body}`);
  const s = await login(payload.email);
  const up = await upload('/company/documents', s, { kind: 'TRADE_LICENSE' }, { name: 'gewerbe.pdf', content: PDF_BYTES, type: 'application/pdf' });
  if (up.statusCode !== 201) throw new Error(`Upload fehlgeschlagen: ${up.body}`);
  const ap = await api('POST', `/admin/companies/${s.companyId}/status`, { session: admin, body: { action: 'approve' } });
  if (ap.statusCode !== 200) throw new Error(`Freigabe fehlgeschlagen: ${ap.body}`);
  return { ...(await login(payload.email)), companyId: s.companyId! };
}

export async function auditEvents(entityId: string): Promise<string[]> {
  const rows = await db.select({ event: schema.auditLogs.event }).from(schema.auditLogs).where(eq(schema.auditLogs.entityId, entityId));
  return rows.map((r) => r.event);
}
