import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { uuidSchema } from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { AppError, parse } from '../../core/errors';
import { requireRoles } from '../../core/auth';
import { rateMax } from '../../config';
import { receiveFile } from '../../core/upload';
import { getObject, IMAGE_MIME, validateUpload } from '../../core/storage';
import { aiVisionEnabled, recognizeVinFromImage } from '../../core/ai-vision';
import { loadForInspection } from './service';

const vid = (req: FastifyRequest) => parse(uuidSchema, (req.params as { id: string }).id);

/**
 * FIN-Erkennung per KI (Spezifikation §9, „OCR“): liefert einen Vorschlag mit Konfidenz.
 * Gespeichert wird die FIN erst über POST /vehicles/:id/vin nach Prüfung durch den Mitarbeiter.
 * Entweder wird ein Foto mitgeschickt (multipart, Feld „file“) oder das zuletzt hochgeladene FIN-Foto verwendet.
 */
export async function vinRecognitionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/vehicles/:id/vin/recognize',
    { preHandler: requireRoles('INSPECTOR', 'ADMIN', 'SUPERADMIN'), config: { rateLimit: { max: rateMax(30), timeWindow: '1 minute' } } },
    async (req) => {
      const id = vid(req);
      if (!aiVisionEnabled()) throw new AppError(503, 'AI_UNAVAILABLE', 'FIN-Erkennung ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt). Bitte FIN manuell eingeben.');
      // Zugriff und Bearbeitbarkeit wie bei jeder Aufnahme-Änderung prüfen.
      await db.transaction((tx) => loadForInspection(tx, req, id));

      let image: Buffer;
      let source: 'upload' | 'stored';
      if (req.isMultipart()) {
        const file = await receiveFile(req);
        await validateUpload(file.buffer, IMAGE_MIME);
        image = file.buffer;
        source = 'upload';
      } else {
        const [photo] = await db
          .select({ key: schema.vehiclePhotos.storageKeyOriginal })
          .from(schema.vehiclePhotos)
          .where(and(eq(schema.vehiclePhotos.vehicleId, id), eq(schema.vehiclePhotos.slot, 'VIN_PLATE'), isNull(schema.vehiclePhotos.replacedById)))
          .orderBy(desc(schema.vehiclePhotos.createdAt))
          .limit(1);
        if (!photo) throw new AppError(404, 'NO_VIN_PHOTO', 'Für dieses Fahrzeug ist noch kein FIN-Foto hochgeladen.');
        image = await getObject(photo.key);
        source = 'stored';
      }
      const result = await recognizeVinFromImage(image);
      return { ...result, source };
    },
  );
}
