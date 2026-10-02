import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config';
import { AppError } from './errors';

/**
 * Lokaler, persistenter Objektspeicher (Dateisystem) unter STORAGE_DIR.
 * Ersetzt in dieser Umgebung MinIO/S3; die API liefert Objekte serverseitig aus
 * bzw. über kurzlebige, signierte /files-Links (signedUrl).
 */
const STORAGE_DIR = process.env.STORAGE_DIR || '/app/.storage';
const SIGN_SECRET = config.S3_SECRET_KEY || 'schnelldeal-local-secret';

function safeResolve(key: string): string {
  const full = path.resolve(STORAGE_DIR, key);
  if (!full.startsWith(path.resolve(STORAGE_DIR) + path.sep)) throw new AppError(400, 'BAD_KEY', 'Ungültiger Objektschlüssel.');
  return full;
}

export async function putObject(key: string, body: Buffer, _contentType: string): Promise<void> {
  const full = safeResolve(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    return await fs.readFile(safeResolve(key));
  } catch {
    throw new Error(`Objekt ${key} nicht gefunden`);
  }
}

/** Kurzlebige, signierte Download-URL (HMAC über Schlüssel + Ablaufzeit). Nur nach Autorisierung aufrufen. */
export async function signedUrl(key: string, opts: { downloadName?: string; ttlSeconds?: number } = {}): Promise<string> {
  const exp = Date.now() + (opts.ttlSeconds ?? config.SIGNED_URL_TTL_SECONDS) * 1000;
  const payload = JSON.stringify({ k: key, exp, dn: opts.downloadName ?? null });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(b64).digest('hex');
  const base = (config.PUBLIC_WEB_URL || '').replace(/\/$/, '');
  return `${base}/api/v1/files?t=${b64}.${sig}`;
}

/** Validiert ein signiertes Token und gibt Objektschlüssel + Download-Namen zurück (oder null). */
export function verifyFileToken(token: string): { key: string; downloadName: string | null } | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SIGN_SECRET).update(b64).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { k, exp, dn } = JSON.parse(Buffer.from(b64, 'base64url').toString()) as { k: string; exp: number; dn: string | null };
    if (typeof exp !== 'number' || Date.now() > exp) return null;
    return { key: k, downloadName: dn };
  } catch {
    return null;
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.access(STORAGE_DIR);
    return true;
  } catch {
    return false;
  }
}

/** Nicht vorhersehbare Objektschlüssel (keine fortlaufenden IDs in URLs). */
export function newStorageKey(prefix: string, ext: string): string {
  const rand = crypto.randomBytes(16).toString('hex');
  const d = new Date();
  return `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${rand}.${ext}`;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export interface ValidatedFile {
  mime: string;
  ext: string;
  sha256: string;
  size: number;
}

/**
 * Prüft den tatsächlichen Dateityp über Magic Bytes (nicht über Dateiname/Content-Type des Clients),
 * die Größe und – falls konfiguriert – einen Virenscan via ClamAV.
 */
export async function validateUpload(buf: Buffer, allowed: readonly string[]): Promise<ValidatedFile> {
  if (buf.length === 0) throw new AppError(400, 'EMPTY_FILE', 'Die Datei ist leer.');
  if (buf.length > config.MAX_UPLOAD_MB * 1024 * 1024) {
    throw new AppError(413, 'FILE_TOO_LARGE', `Die Datei überschreitet ${config.MAX_UPLOAD_MB} MB.`);
  }
  const type = await fileTypeFromBuffer(buf);
  if (!type || !allowed.includes(type.mime)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', `Dateityp nicht erlaubt. Erlaubt: ${allowed.join(', ')}`);
  }
  if (type.mime === 'application/pdf') assertSafePdf(buf);
  await scanForMalware(buf);
  return { mime: type.mime, ext: type.ext, sha256: sha256(buf), size: buf.length };
}

/** Lehnt PDFs mit eingebettetem JavaScript oder Auto-Aktionen ab. */
function assertSafePdf(buf: Buffer): void {
  const text = buf.toString('latin1');
  if (/\/JavaScript|\/JS\s|\/Launch|\/OpenAction\s*<<[^>]*\/JS/i.test(text)) {
    throw new AppError(415, 'UNSAFE_PDF', 'PDF-Dateien mit eingebetteten Skripten oder Aktionen sind nicht erlaubt.');
  }
}

export const malwareScanMode: 'clamav' | 'disabled' = config.CLAMAV_HOST ? 'clamav' : 'disabled';

async function scanForMalware(buf: Buffer): Promise<void> {
  if (!config.CLAMAV_HOST) return;
  const result = await clamdInstream(buf, config.CLAMAV_HOST, config.CLAMAV_PORT);
  if (result.infected) {
    throw new AppError(422, 'MALWARE_DETECTED', 'Die Datei wurde vom Virenscanner abgelehnt.', { signature: result.signature });
  }
}

/**
 * Minimaler clamd-INSTREAM-Client. Fail closed: Nur die ausdrückliche Antwort „stream: OK“ gibt eine Datei frei.
 * Fehlerantworten, leere Antworten, Verbindungsfehler und Zeitüberschreitungen blockieren den Upload.
 */
export function clamdInstream(buf: Buffer, host: string, port: number, timeoutMs = 30_000): Promise<{ infected: boolean; signature?: string }> {
  const unavailable = () => new AppError(503, 'SCANNER_UNAVAILABLE', 'Virenscan fehlgeschlagen oder Virenscanner nicht erreichbar. Bitte später erneut versuchen.');
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let response = '';
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      reject(unavailable());
    });
    socket.on('error', () => reject(unavailable()));
    socket.on('data', (d) => (response += d.toString()));
    socket.on('end', () => {
      // Mit dem Präfix „z“ antwortet clamd nullterminiert, z. B. „stream: OK\0“ oder „stream: Eicar-Signature FOUND\0“.
      const text = response.replace(/\0/g, '').trim();
      if (text === 'stream: OK') return resolve({ infected: false });
      const found = /^stream: (.+) FOUND$/.exec(text);
      if (found) return resolve({ infected: true, signature: found[1] });
      reject(unavailable());
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const chunk = 64 * 1024;
      for (let i = 0; i < buf.length; i += chunk) {
        const part = buf.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
