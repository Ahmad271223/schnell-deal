import type { FastifyRequest } from 'fastify';
import { AppError } from './errors';

export interface ReceivedFile {
  buffer: Buffer;
  fileName: string;
  fields: Record<string, string>;
}

/** Liest genau eine Datei aus einem multipart-Request (Größenlimit greift bereits im Stream). */
export async function receiveFile(req: FastifyRequest): Promise<ReceivedFile> {
  if (!req.isMultipart()) throw new AppError(400, 'MULTIPART_REQUIRED', 'Datei-Upload (multipart/form-data) erwartet.');
  const file = await req.file();
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Keine Datei übermittelt.');
  const buffer = await file.toBuffer();
  if (file.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', 'Die Datei ist zu groß.');
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(file.fields)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v && 'value' in v && typeof v.value === 'string') fields[key] = v.value;
  }
  const fileName = (file.filename || 'upload').replace(/[^\w.\- äöüÄÖÜß]/g, '_').slice(0, 150);
  return { buffer, fileName, fields };
}
