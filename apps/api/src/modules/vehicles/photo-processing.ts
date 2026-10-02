import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { classifyQuality, computeQualityMetrics, EXTERIOR_PHOTO_SLOTS, QUALITY_ANALYSIS_WIDTH, type PhotoQuality, type QualityMetrics } from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { getObject, newStorageKey, putObject } from '../../core/storage';
import { AppError } from '../../core/errors';
import { config } from '../../config';
import { aiVisionEnabled, checkVehicleFraming } from '../../core/ai-vision';
import { recomputeCompleteness } from './service';

export interface QualityResult {
  quality: PhotoQuality;
  metrics: QualityMetrics;
  width: number;
  height: number;
}

/** Synchrone Qualitätsprüfung beim Upload (auf verkleinerter Graustufenkopie, ~50 ms). */
export async function analyzePhoto(buf: Buffer): Promise<QualityResult> {
  try {
    const meta = await sharp(buf).metadata();
    const { data, info } = await sharp(buf)
      .rotate()
      .resize({ width: QUALITY_ANALYSIS_WIDTH, withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const metrics = computeQualityMetrics(data, info.width, info.height);
    // Für die Qualitätsentscheidung zählt die Orientierung nicht, aber Breite/Höhe des Originals werden gespeichert.
    return { quality: classifyQuality(metrics), metrics, width: meta.width ?? info.width, height: meta.height ?? info.height };
  } catch {
    throw new AppError(422, 'IMAGE_UNREADABLE', 'Das Bild konnte nicht gelesen werden. Bitte Foto erneut aufnehmen.');
  }
}

/**
 * Job `image.process`: erzeugt Web-Version (max. 1920 px) und Thumbnail (480 px).
 * Das Original bleibt unverändert gespeichert (SHA-256 an der Akte). Die Ableitungen werden
 * nur skaliert und gedreht – keine inhaltliche Bearbeitung von Schadenfotos. EXIF-Daten
 * (z. B. GPS) werden in den Ableitungen entfernt.
 *
 * Außenaufnahmen werden anschließend per KI geprüft, ob das Fahrzeug vollständig im Bild ist (§11).
 * Ein abgeschnittenes Fahrzeug erhält die Qualität CROPPED und zählt wie ein fehlendes Pflichtfoto,
 * bis der Mitarbeiter neu fotografiert oder eine begründete Übersteuerung erfasst.
 */
export async function processPhotoJob(payload: { photoId: string }): Promise<void> {
  const [photo] = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.id, payload.photoId));
  if (!photo) return; // nichts zu tun
  if (photo.uploadStatus === 'PROCESSED' && photo.storageKeyWeb && photo.storageKeyThumb) return; // idempotent
  let web: Buffer;
  try {
    const original = await getObject(photo.storageKeyOriginal);
    web = await sharp(original).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const thumb = await sharp(original).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
    const webKey = newStorageKey(`vehicles/${photo.vehicleId}/web`, 'jpg');
    const thumbKey = newStorageKey(`vehicles/${photo.vehicleId}/thumb`, 'jpg');
    await putObject(webKey, web, 'image/jpeg');
    await putObject(thumbKey, thumb, 'image/jpeg');
    await db
      .update(schema.vehiclePhotos)
      .set({ storageKeyWeb: webKey, storageKeyThumb: thumbKey, uploadStatus: 'PROCESSED' })
      .where(eq(schema.vehiclePhotos.id, photo.id));
  } catch (err) {
    await db.update(schema.vehiclePhotos).set({ uploadStatus: 'FAILED' }).where(eq(schema.vehiclePhotos.id, photo.id));
    throw err; // Queue plant Wiederholung ein
  }

  await aiFramingCheck(photo, web);
}

/** KI-Prüfung „Fahrzeug vollständig im Bild“ für Außenaufnahmen; Ergebnis wird an den Qualitätsmetriken vermerkt. */
async function aiFramingCheck(photo: typeof schema.vehiclePhotos.$inferSelect, web: Buffer): Promise<void> {
  if (!aiVisionEnabled() || !config.AI_PHOTO_CHECK) return;
  if (!EXTERIOR_PHOTO_SLOTS.includes(photo.slot) || photo.quality !== 'OK' || photo.qualityOverride) return;
  const metrics = (photo.qualityMetrics ?? {}) as Record<string, unknown>;
  try {
    const framing = await checkVehicleFraming(web);
    // Nur bei klarer Aussage beanstanden: unsichere Antworten führen nicht zu einer Nachforderung.
    const cropped = framing.vehiclePresent && !framing.fullyVisible && framing.confidence !== 'low';
    await db.transaction(async (tx) => {
      await tx
        .update(schema.vehiclePhotos)
        .set({ quality: cropped ? 'CROPPED' : 'OK', qualityMetrics: { ...metrics, ai: { ...framing, checkedAt: new Date().toISOString() } } })
        .where(eq(schema.vehiclePhotos.id, photo.id));
      if (cropped) await recomputeCompleteness(tx, photo.vehicleId);
    });
  } catch (err) {
    // Kein stiller Fehler: Die Ableitungen sind erzeugt; die KI-Prüfung wird protokolliert und am Foto vermerkt.
    const message = (err as Error).message;
    console.error(`[ai] Bildprüfung für Foto ${photo.id} fehlgeschlagen:`, message);
    await db
      .update(schema.vehiclePhotos)
      .set({ qualityMetrics: { ...metrics, aiError: { message: message.slice(0, 300), at: new Date().toISOString() } } })
      .where(eq(schema.vehiclePhotos.id, photo.id));
  }
}
