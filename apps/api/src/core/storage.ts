import crypto from 'node:crypto';
import net from 'node:net';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config';
import { AppError } from './errors';

const baseClientConfig = {
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
};

const s3 = new S3Client({ ...baseClientConfig, endpoint: config.S3_ENDPOINT });
/** Separater Client nur zum Signieren mit der öffentlich erreichbaren Adresse. */
const s3Public = new S3Client({ ...baseClientConfig, endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT });

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Objekte sind privat; der Bucket hat keine anonyme Policy.
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Objekt ${key} ohne Inhalt`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/** Kurzlebige Signed URL (Standard 5 Minuten). Nur nach erfolgter Autorisierung aufrufen. */
export async function signedUrl(key: string, opts: { downloadName?: string; ttlSeconds?: number } = {}): Promise<string> {
  return getSignedUrl(
    s3Public,
    new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: opts.downloadName
        ? `attachment; filename="${opts.downloadName.replace(/[^A-Za-z0-9._-]/g, '_')}"`
        : undefined,
    }),
    { expiresIn: opts.ttlSeconds ?? config.SIGNED_URL_TTL_SECONDS },
  );
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
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
