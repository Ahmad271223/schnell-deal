import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  approxCoordinatesForZip,
  batterySchema,
  commentSchema,
  correctionSchema,
  damageSchema,
  diagnosticSchema,
  featuresSchema,
  isPaintValueFlagged,
  paintSchema,
  pdrSchema,
  PHOTO_SLOTS,
  REQUIRED_PHOTO_SLOTS,
  QUALITY_RETAKE_MESSAGE,
  reviewVehicleSchema,
  tiresSchema,
  uuidSchema,
  validateVin,
  VEHICLE_DOCUMENT_KINDS,
  VEHICLE_STATUSES,
  vehicleDataSchema,
  vinInputSchema,
  type PhotoSlot,
  type VehicleDocumentKind,
} from '@sd/shared';
import { db, schema, type DbOrTx } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, getAuth, isAdmin, requireAdmin, requireAuth, requireInspectorOrAdmin } from '../../core/auth';
import { audit } from '../../core/audit';
import { receiveFile } from '../../core/upload';
import { DOCUMENT_MIME, IMAGE_MIME, VIDEO_MIME, deleteObject, newStorageKey, putObject, signedUrl, validateUpload } from '../../core/storage';
import { enqueue } from '../../core/jobs';
import { getSettings } from '../../core/settings';
import { publish, channels } from '../../core/realtime';
import { notifyAdmins, notifyCompany, notifyUsers } from '../notifications/service';
import { analyzePhoto } from './photo-processing';
import { buildVehicleFile, type Audience } from './presenter';
import {
  assertPhotosBelong,
  findVinDuplicates,
  INSPECTOR_EDITABLE,
  loadForInspection,
  loadVehicle,
  recomputeCompleteness,
  setVehicleStatus,
  touchInspection,
  vehicleVisibility,
} from './service';
import { buyerCanSeeVehicle } from '../auctions/access';
import { config, rateMax } from '../../config';

const vid = (req: FastifyRequest) => parse(uuidSchema, (req.params as { id: string }).id);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function audienceOf(req: FastifyRequest): Audience {
  const u = getAuth(req);
  if (isAdmin(u)) return 'admin';
  if (u.platformRole === 'INSPECTOR') return 'inspector';
  return 'dealership';
}

/** Nach jeder Änderung: Vollständigkeit neu berechnen und Admin-Board informieren. */
async function afterChange(tx: DbOrTx, vehicleId: string) {
  const c = await recomputeCompleteness(tx, vehicleId);
  await publish(tx, channels.admin(), 'vehicle.updated', { id: vehicleId, completenessPct: c.percent });
  return c;
}

/**
 * Berechtigung prüfen, bevor Virenscan, Bildanalyse und Speichern Ressourcen belegen (Außendienst nur für eigene, nicht
 * gesperrte Akten). Die anschließende Schreibtransaktion prüft erneut mit Zeilensperre.
 */
async function assertUploadAllowed(req: FastifyRequest, id: string): Promise<void> {
  const v = await loadVehicle(db, req, id);
  if (isAdmin(getAuth(req))) return;
  if (!INSPECTOR_EDITABLE.includes(v.status) || v.lockedAt) {
    throw new AppError(409, 'VEHICLE_LOCKED', 'Die Fahrzeugakte ist abgeschlossen und gesperrt. Änderungen sind nur noch als nachvollziehbare Korrektur durch den Administrator möglich.');
  }
}

/** Schreibtransaktion nach dem Speichern eines Objekts: scheitert sie, wird das Objekt wieder entfernt (keine Waisen). */
async function withStoredObject<T>(key: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    await deleteObject(key).catch(() => undefined);
    throw err;
  }
}

export async function vehicleRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Fahrzeug anlegen (Außendienst, im laufenden Auftrag) ----------
  app.post('/inspector/requests/:id/vehicles', { preHandler: requireInspectorOrAdmin }, async (req, reply) => {
    const requestId = vid(req);
    const u = getAuth(req);
    // Offline-fähig: der Client darf eine eigene UUID mitsenden → wiederholte Requests sind idempotent.
    const input = parse(z.object({ clientVehicleId: uuidSchema.optional() }), req.body ?? {});
    // Antwort erst nach dem Commit senden: Der Client (Offline-Warteschlange) schickt FIN und Fotos sofort hinterher;
    // eine Antwort aus der offenen Transaktion heraus ließe diese Folgeanfragen auf ein noch unsichtbares Fahrzeug treffen (404).
    const result = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.inspectionRequests).where(eq(schema.inspectionRequests.id, requestId)).for('update');
      if (!r) throw notFound('Aufnahmeauftrag');
      if (!isAdmin(u)) {
        const [a] = await tx
          .select()
          .from(schema.inspectionAssignments)
          .where(and(eq(schema.inspectionAssignments.requestId, requestId), eq(schema.inspectionAssignments.active, true), eq(schema.inspectionAssignments.inspectorUserId, u.userId)));
        if (!a) throw notFound('Aufnahmeauftrag');
      }
      if (r.status !== 'IN_PROGRESS') {
        throw new AppError(409, 'INSPECTION_NOT_STARTED', 'Bitte zuerst „Aufnahme starten“ wählen.');
      }
      if (input.clientVehicleId) {
        const [existing] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, input.clientVehicleId));
        if (existing) {
          if (existing.inspectionRequestId !== requestId) throw new AppError(409, 'ID_CONFLICT', 'Fahrzeug-ID bereits vergeben.');
          return { code: 200, body: { id: existing.id, internalNumber: existing.internalNumber, status: existing.status } };
        }
      }
      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('vehicle_number_seq')::text as n`)).rows as [{ n: string }];
      const coords = approxCoordinatesForZip(r.locationZip);
      const [v] = await tx
        .insert(schema.vehicles)
        .values({
          ...(input.clientVehicleId ? { id: input.clientVehicleId } : {}),
          internalNumber: `FZ-${n.padStart(6, '0')}`,
          companyId: r.companyId,
          inspectionRequestId: requestId,
          inspectorUserId: u.userId,
          status: 'DRAFT',
          locationStreet: r.locationStreet,
          locationZip: r.locationZip,
          locationCity: r.locationCity,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        })
        .returning();
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_CREATED',
        entityType: 'vehicle',
        entityId: v!.id,
        newValue: { internalNumber: v!.internalNumber, inspectionRequestId: requestId },
      });
      return { code: 201, body: { id: v!.id, internalNumber: v!.internalNumber, status: v!.status } };
    });
    return reply.status(result.code).send(result.body);
  });

  // ---------- Liste ----------
  app.get('/vehicles', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    if (u.company?.type === 'DEALER') throw new AppError(403, 'FORBIDDEN', 'Händler sehen Fahrzeuge über die Auktionsansicht.');
    const q = parse(
      z.object({
        status: z.string().optional(),
        companyId: uuidSchema.optional(),
        q: z.string().max(100).optional(),
        requestId: uuidSchema.optional(),
      }),
      req.query,
    );
    const where: (SQL | undefined)[] = [vehicleVisibility(req)];
    if (q.status) {
      const statuses = q.status.split(',').filter((s) => (VEHICLE_STATUSES as readonly string[]).includes(s));
      if (statuses.length) where.push(inArray(schema.vehicles.status, statuses as (typeof VEHICLE_STATUSES)[number][]));
    }
    if (q.companyId && isAdmin(u)) where.push(eq(schema.vehicles.companyId, q.companyId));
    if (q.requestId) where.push(eq(schema.vehicles.inspectionRequestId, q.requestId));
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      where.push(or(ilike(schema.vehicles.vin, like), ilike(schema.vehicles.internalNumber, like), ilike(schema.vehicles.make, like), ilike(schema.vehicles.model, like), ilike(schema.vehicles.licensePlate, like)));
    }
    const rows = await db
      .select({
        id: schema.vehicles.id,
        internalNumber: schema.vehicles.internalNumber,
        vin: schema.vehicles.vin,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        variant: schema.vehicles.variant,
        firstRegistration: schema.vehicles.firstRegistration,
        mileageKm: schema.vehicles.mileageKm,
        fuel: schema.vehicles.fuel,
        status: schema.vehicles.status,
        completenessPct: schema.vehicles.completenessPct,
        hasDamages: schema.vehicles.hasDamages,
        companyId: schema.vehicles.companyId,
        companyName: schema.companies.name,
        locationCity: schema.vehicles.locationCity,
        createdAt: schema.vehicles.createdAt,
        inspectionCompletedAt: schema.vehicles.inspectionCompletedAt,
        thumbPhotoId: sql<string | null>`(select p.id from vehicle_photos p where p.vehicle_id = ${schema.vehicles.id} and p.slot = 'FRONT_LEFT_45' and p.replaced_by_id is null order by p.created_at desc limit 1)`,
        currentAuction: sql<{ id: string; status: string; currentBid: number | null; endsAt: string } | null>`(
          select json_build_object('id', a.id, 'status', a.status, 'currentBid', a.current_bid, 'endsAt', a.ends_at, 'outcome', a.outcome)
          from auctions a where a.vehicle_id = ${schema.vehicles.id} order by a.created_at desc limit 1)`,
      })
      .from(schema.vehicles)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.vehicles.companyId))
      .where(and(...where))
      .orderBy(desc(schema.vehicles.createdAt))
      .limit(500);
    return rows;
  });

  // ---------- Akte ----------
  app.get('/vehicles/:id', { preHandler: requireAuth }, async (req) => {
    const id = vid(req);
    const u = getAuth(req);
    if (u.company?.type === 'DEALER') throw notFound('Fahrzeug');
    await loadVehicle(db, req, id);
    const file = await buildVehicleFile(db, id, audienceOf(req));
    const completeness = await recomputeCompleteness(db, id);
    return { ...file, completeness };
  });

  // ---------- Stammdaten (geführte Aufnahme) ----------
  app.patch('/vehicles/:id', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(vehicleDataSchema, req.body);
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      await tx.update(schema.vehicles).set({ ...input, updatedAt: new Date() }).where(eq(schema.vehicles.id, id));
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: input });
      return { completeness: await afterChange(tx, id) };
    });
  });

  app.post('/vehicles/:id/vin', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(vinInputSchema, req.body);
    const check = validateVin(input.vin);
    if (!check.formatValid) throw new AppError(400, 'VIN_INVALID', check.errors.join(' '), { errors: check.errors });
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      const dups = await findVinDuplicates(tx, check.normalized, id);
      const active = dups.filter((d) => d.status !== 'COMPLETED');
      if (active.length) {
        throw new AppError(409, 'VIN_DUPLICATE', 'Diese FIN ist bereits einem aktiven Fahrzeug zugeordnet.', {
          vehicles: active.map((d) => ({ internalNumber: d.internalNumber, status: d.status })),
        });
      }
      if (dups.length && !input.confirmDuplicate) {
        throw new AppError(409, 'VIN_SEEN_BEFORE', 'Diese FIN war bereits früher auf der Plattform. Bitte Wiederaufnahme bestätigen.', {
          vehicles: dups.map((d) => ({ internalNumber: d.internalNumber, status: d.status, createdAt: d.createdAt })),
        });
      }
      await touchInspection(tx, req, v);
      const vinCheck = check.checkDigitValid ? 'VALID' : 'UNVERIFIED';
      await tx.update(schema.vehicles).set({ vin: check.normalized, vinCheck, updatedAt: new Date() }).where(eq(schema.vehicles.id, id));
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_UPDATED',
        entityType: 'vehicle',
        entityId: id,
        oldValue: { vin: v.vin },
        newValue: { vin: check.normalized, vinCheck, previousRecords: dups.length },
      });
      return {
        vin: check.normalized,
        vinCheck,
        checkDigitHint: check.checkDigitValid ? null : 'Prüfziffer nicht bestätigt (bei europäischen FIN üblich). Bitte FIN mit Fahrzeugschein abgleichen.',
        completeness: await afterChange(tx, id),
      };
    });
  });

  // ---------- Fotos ----------
  app.post('/vehicles/:id/photos', { preHandler: requireInspectorOrAdmin, config: { rateLimit: { max: rateMax(300), timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = vid(req);
    const file = await receiveFile(req);
    const meta = parse(
      z.object({
        slot: z.enum(PHOTO_SLOTS),
        clientUploadId: z.string().min(8).max(64),
        takenAt: z.string().datetime({ offset: true }).optional(),
        /** Bewusste Übersteuerung der Qualitätswarnung (z. B. offline erfasst), wird protokolliert. */
        qualityOverrideReason: z.string().trim().min(3).max(300).optional(),
      }),
      file.fields,
    );
    // Idempotenz: ein wiederholter Upload (z. B. nach Verbindungsabbruch) liefert den vorhandenen Datensatz.
    const [already] = await db
      .select()
      .from(schema.vehiclePhotos)
      .where(and(eq(schema.vehiclePhotos.vehicleId, id), eq(schema.vehiclePhotos.clientUploadId, meta.clientUploadId)));
    if (already) {
      await loadVehicle(db, req, id);
      return reply.status(200).send(photoResponse(already, true));
    }
    await assertUploadAllowed(req, id);
    const valid = await validateUpload(file.buffer, IMAGE_MIME);
    const q = await analyzePhoto(file.buffer);
    const key = newStorageKey(`vehicles/${id}/original`, valid.ext);
    await putObject(key, file.buffer, valid.mime);

    const result = await withStoredObject(key, () => db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      const [dupContent] = await tx
        .select({ id: schema.vehiclePhotos.id, slot: schema.vehiclePhotos.slot })
        .from(schema.vehiclePhotos)
        .where(and(eq(schema.vehiclePhotos.vehicleId, id), eq(schema.vehiclePhotos.sha256, valid.sha256), isNull(schema.vehiclePhotos.replacedById)));
      if (dupContent) {
        throw new AppError(409, 'DUPLICATE_PHOTO', `Dieses Foto wurde bereits für „${dupContent.slot}“ hochgeladen. Bitte ein neues Foto aufnehmen.`, {
          existingPhotoId: dupContent.id,
        });
      }
      await touchInspection(tx, req, v);
      const [photo] = await tx
        .insert(schema.vehiclePhotos)
        .values({
          // UUID-förmige clientUploadId wird zur Foto-ID → Offline erfasste Schäden können Fotos vorab referenzieren.
          ...(UUID_RE.test(meta.clientUploadId) ? { id: meta.clientUploadId } : {}),
          vehicleId: id,
          slot: meta.slot,
          clientUploadId: meta.clientUploadId,
          storageKeyOriginal: key,
          mime: valid.mime,
          width: q.width,
          height: q.height,
          sizeBytes: valid.size,
          sha256: valid.sha256,
          quality: q.quality,
          qualityMetrics: q.metrics,
          qualityOverride: q.quality !== 'OK' && !!meta.qualityOverrideReason,
          uploadStatus: 'UPLOADED',
          uploadedBy: getAuth(req).userId,
          takenAt: meta.takenAt ? new Date(meta.takenAt) : null,
        })
        .returning();
      // Pflicht-Slots haben genau ein aktives Foto; das vorherige bleibt als ersetzt erhalten.
      if ((REQUIRED_PHOTO_SLOTS as readonly string[]).includes(meta.slot)) {
        const replaced = await tx
          .update(schema.vehiclePhotos)
          .set({ replacedById: photo!.id, replacedAt: new Date() })
          .where(
            and(
              eq(schema.vehiclePhotos.vehicleId, id),
              eq(schema.vehiclePhotos.slot, meta.slot),
              isNull(schema.vehiclePhotos.replacedById),
              sql`${schema.vehiclePhotos.id} <> ${photo!.id}`,
            ),
          )
          .returning({ id: schema.vehiclePhotos.id });
        if (replaced.length) {
          await audit(tx, actorOf(req), {
            event: 'VEHICLE_PHOTO_REPLACED',
            entityType: 'vehicle',
            entityId: id,
            newValue: { slot: meta.slot, replaced: replaced.map((r) => r.id), by: photo!.id },
          });
        }
      }
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_PHOTO_UPLOADED',
        entityType: 'vehicle',
        entityId: id,
        newValue: { photoId: photo!.id, slot: meta.slot, sha256: valid.sha256, quality: q.quality, qualityOverrideReason: q.quality !== 'OK' ? (meta.qualityOverrideReason ?? null) : null },
      });
      await enqueue(tx, 'image.process', { photoId: photo!.id }, { dedupeKey: `image:${photo!.id}` });
      const completeness = await afterChange(tx, id);
      return { photo: photo!, completeness };
    }));
    return reply.status(201).send({ ...photoResponse(result.photo, false), completeness: result.completeness });
  });

  /** Qualitätswarnung bewusst übersteuern (z. B. Motorraum ist naturgemäß dunkel) – mit Begründung, für Admin sichtbar. */
  app.post('/vehicles/:id/photos/:photoId/accept-quality', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const photoId = parse(uuidSchema, (req.params as { photoId: string }).photoId);
    const input = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    return db.transaction(async (tx) => {
      await loadForInspection(tx, req, id);
      const [p] = await tx
        .update(schema.vehiclePhotos)
        .set({ qualityOverride: true })
        .where(and(eq(schema.vehiclePhotos.id, photoId), eq(schema.vehiclePhotos.vehicleId, id)))
        .returning();
      if (!p) throw notFound('Foto');
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_UPDATED',
        entityType: 'vehicle',
        entityId: id,
        newValue: { photoId, qualityOverride: true, quality: p.quality, reason: input.reason },
      });
      return { completeness: await afterChange(tx, id) };
    });
  });

  app.get('/vehicles/:id/photos/:photoId/file', { preHandler: requireAuth }, async (req, reply) => {
    const id = vid(req);
    const photoId = parse(uuidSchema, (req.params as { photoId: string }).photoId);
    const { variant } = parse(z.object({ variant: z.enum(['thumb', 'web', 'original']).default('web') }), req.query);
    const u = getAuth(req);
    const isBuyer = u.company?.type === 'DEALER';
    if (isBuyer) {
      if (!(await buyerCanSeeVehicle(db, u, id))) throw notFound('Foto');
    } else {
      await loadVehicle(db, req, id);
    }
    const [p] = await db
      .select()
      .from(schema.vehiclePhotos)
      .where(and(eq(schema.vehiclePhotos.id, photoId), eq(schema.vehiclePhotos.vehicleId, id)));
    if (!p || (isBuyer && p.replacedById)) throw notFound('Foto');
    // Käufer erhalten nie das Original (EXIF/GPS), sondern die Ableitungen.
    const wanted = isBuyer && variant === 'original' ? 'web' : variant;
    const key =
      wanted === 'thumb' ? (p.storageKeyThumb ?? p.storageKeyWeb) : wanted === 'web' ? p.storageKeyWeb : p.storageKeyOriginal;
    if (!key) {
      if (isBuyer) throw new AppError(409, 'PHOTO_PROCESSING', 'Foto wird noch verarbeitet.');
      return reply.redirect(await signedUrl(p.storageKeyOriginal));
    }
    return reply.redirect(await signedUrl(key));
  });

  // ---------- Direkter Foto-Upload (Admin): Fotos nachreichen ohne Aufnahmeprozess ----------
  // Die Qualitätsprüfung bleibt aktiv (keine stille Übersteuerung); ein mangelhaftes Foto muss der Admin
  // wie jedes andere ausdrücklich mit Begründung übersteuern oder ersetzen (§11).
  app.post('/vehicles/:id/media/photo', { preHandler: requireAdmin, config: { rateLimit: { max: rateMax(300), timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = vid(req);
    const file = await receiveFile(req);
    const valid = await validateUpload(file.buffer, IMAGE_MIME);
    const q = await analyzePhoto(file.buffer);
    const key = newStorageKey(`vehicles/${id}/original`, valid.ext);
    await putObject(key, file.buffer, valid.mime);
    const result = await withStoredObject(key, () => db.transaction(async (tx) => {
      await loadVehicle(tx, req, id);
      // Erstes Bild belegt den Katalog-Slot (FRONT_LEFT_45 = Kartenbild), weitere als EXTRA.
      const [hasMain] = await tx
        .select({ id: schema.vehiclePhotos.id })
        .from(schema.vehiclePhotos)
        .where(and(eq(schema.vehiclePhotos.vehicleId, id), eq(schema.vehiclePhotos.slot, 'FRONT_LEFT_45'), isNull(schema.vehiclePhotos.replacedById)));
      const slot: PhotoSlot = hasMain ? 'EXTRA' : 'FRONT_LEFT_45';
      const [photo] = await tx
        .insert(schema.vehiclePhotos)
        .values({
          vehicleId: id,
          slot,
          clientUploadId: `media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          storageKeyOriginal: key,
          mime: valid.mime,
          width: q.width,
          height: q.height,
          sizeBytes: valid.size,
          sha256: valid.sha256,
          quality: q.quality,
          qualityMetrics: q.metrics,
          qualityOverride: false,
          uploadStatus: 'UPLOADED',
          uploadedBy: getAuth(req).userId,
        })
        .returning();
      await audit(tx, actorOf(req), { event: 'VEHICLE_PHOTO_UPLOADED', entityType: 'vehicle', entityId: id, newValue: { photoId: photo!.id, slot, source: 'admin_media' } });
      await enqueue(tx, 'image.process', { photoId: photo!.id }, { dedupeKey: `image:${photo!.id}` });
      return photo!;
    }));
    return reply.status(201).send({ id: result.id, slot: result.slot });
  });

  app.delete('/vehicles/:id/media/photo/:photoId', { preHandler: requireAdmin }, async (req) => {
    const id = vid(req);
    const photoId = parse(uuidSchema, (req.params as { photoId: string }).photoId);
    return db.transaction(async (tx) => {
      await loadVehicle(tx, req, id);
      const [p] = await tx.select().from(schema.vehiclePhotos).where(and(eq(schema.vehiclePhotos.id, photoId), eq(schema.vehiclePhotos.vehicleId, id)));
      if (!p) throw notFound('Foto');
      // vehicle_photos ist append-only (DB-Trigger): statt Hard-Delete als „ersetzt" markieren → überall ausgeblendet.
      await tx.update(schema.vehiclePhotos).set({ replacedById: photoId, replacedAt: new Date() }).where(eq(schema.vehiclePhotos.id, photoId));
      await audit(tx, actorOf(req), { event: 'VEHICLE_PHOTO_REPLACED', entityType: 'vehicle', entityId: id, newValue: { photoId, deleted: true, source: 'admin_media' } });
      return { ok: true };
    });
  });

  // ---------- Motorvideo ----------
  // Außendienst (während der Aufnahme, Akte nicht gesperrt) oder Admin (jederzeit, z. B. nachgereicht).
  // Ein Fahrzeug hat höchstens ein Video; ein neuer Upload ersetzt das alte, das Objekt bleibt im Speicher (Audit).
  const videoAccess = async (tx: DbOrTx, req: FastifyRequest, id: string) => {
    if (isAdmin(getAuth(req))) return loadVehicle(tx, req, id, { forUpdate: true });
    const v = await loadForInspection(tx, req, id);
    await touchInspection(tx, req, v);
    return v;
  };

  app.post('/vehicles/:id/media/video', { preHandler: requireInspectorOrAdmin, config: { rateLimit: { max: rateMax(30), timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = vid(req);
    const file = await receiveFile(req, { maxMb: config.MAX_VIDEO_UPLOAD_MB });
    await assertUploadAllowed(req, id);
    const valid = await validateUpload(file.buffer, VIDEO_MIME, { maxMb: config.MAX_VIDEO_UPLOAD_MB });
    const key = newStorageKey(`vehicles/${id}/video`, valid.ext);
    await putObject(key, file.buffer, valid.mime);
    await withStoredObject(key, () => db.transaction(async (tx) => {
      const v = await videoAccess(tx, req, id);
      await tx.update(schema.vehicles).set({ engineVideoKey: key, engineVideoMime: valid.mime, updatedAt: new Date() }).where(eq(schema.vehicles.id, id));
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_UPDATED',
        entityType: 'vehicle',
        entityId: id,
        oldValue: { engineVideo: !!v.engineVideoKey },
        newValue: { engineVideo: true, mime: valid.mime, sizeBytes: valid.size, sha256: valid.sha256 },
      });
    }));
    return reply.status(201).send({ ok: true, mime: valid.mime, sizeBytes: valid.size });
  });

  app.delete('/vehicles/:id/media/video', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    return db.transaction(async (tx) => {
      const v = await videoAccess(tx, req, id);
      if (!v.engineVideoKey) throw notFound('Video');
      await tx.update(schema.vehicles).set({ engineVideoKey: null, engineVideoMime: null, updatedAt: new Date() }).where(eq(schema.vehicles.id, id));
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, oldValue: { engineVideo: true }, newValue: { engineVideo: false } });
      return { ok: true };
    });
  });

  app.get('/vehicles/:id/media/video/file', { preHandler: requireAuth }, async (req, reply) => {
    const id = vid(req);
    const u = getAuth(req);
    if (u.company?.type === 'DEALER') {
      if (!(await buyerCanSeeVehicle(db, u, id))) throw notFound('Video');
    } else {
      await loadVehicle(db, req, id);
    }
    const [v] = await db.select({ key: schema.vehicles.engineVideoKey }).from(schema.vehicles).where(eq(schema.vehicles.id, id));
    if (!v?.key) throw notFound('Video');
    return reply.redirect(await signedUrl(v.key));
  });

  // ---------- Dokumente ----------
  app.post('/vehicles/:id/documents', { preHandler: requireInspectorOrAdmin }, async (req, reply) => {
    const id = vid(req);
    const file = await receiveFile(req);
    const meta = parse(z.object({ kind: z.enum(VEHICLE_DOCUMENT_KINDS), clientUploadId: z.string().min(8).max(64) }), file.fields);
    const [already] = await db
      .select()
      .from(schema.vehicleDocuments)
      .where(and(eq(schema.vehicleDocuments.vehicleId, id), eq(schema.vehicleDocuments.clientUploadId, meta.clientUploadId)));
    if (already) {
      await loadVehicle(db, req, id);
      return reply.status(200).send({ id: already.id, duplicate: true });
    }
    await assertUploadAllowed(req, id);
    const valid = await validateUpload(file.buffer, DOCUMENT_MIME);
    const key = newStorageKey(`vehicles/${id}/documents`, valid.ext);
    await putObject(key, file.buffer, valid.mime);
    const doc = await withStoredObject(key, () => db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      const [d] = await tx
        .insert(schema.vehicleDocuments)
        .values({
          vehicleId: id,
          kind: meta.kind as VehicleDocumentKind,
          clientUploadId: meta.clientUploadId,
          fileName: file.fileName,
          storageKey: key,
          mime: valid.mime,
          sizeBytes: valid.size,
          sha256: valid.sha256,
          // Sensible Dokumente sind für Käufer erst nach Admin-Freigabe sichtbar (Spec §9/§3.3).
          visibleToBuyers: false,
          uploadedBy: getAuth(req).userId,
        })
        .returning();
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_DOCUMENT_UPLOADED',
        entityType: 'vehicle',
        entityId: id,
        newValue: { documentId: d!.id, kind: meta.kind, sha256: valid.sha256 },
      });
      await afterChange(tx, id);
      return d!;
    }));
    return reply.status(201).send({ id: doc.id, duplicate: false });
  });

  app.get('/vehicles/:id/documents/:docId/file', { preHandler: requireAuth }, async (req, reply) => {
    const id = vid(req);
    const docId = parse(uuidSchema, (req.params as { docId: string }).docId);
    const u = getAuth(req);
    const isBuyer = u.company?.type === 'DEALER';
    if (isBuyer) {
      if (!(await buyerCanSeeVehicle(db, u, id))) throw notFound('Dokument');
    } else {
      await loadVehicle(db, req, id);
    }
    const [d] = await db
      .select()
      .from(schema.vehicleDocuments)
      .where(and(eq(schema.vehicleDocuments.id, docId), eq(schema.vehicleDocuments.vehicleId, id)));
    if (!d || (isBuyer && !d.visibleToBuyers)) throw notFound('Dokument');
    return reply.redirect(await signedUrl(d.storageKey, { downloadName: d.fileName }));
  });

  app.post('/admin/vehicles/:id/documents/:docId/release', { preHandler: requireAdmin }, async (req) => {
    const id = vid(req);
    const docId = parse(uuidSchema, (req.params as { docId: string }).docId);
    const input = parse(z.object({ visible: z.boolean() }), req.body);
    return db.transaction(async (tx) => {
      const [d] = await tx
        .update(schema.vehicleDocuments)
        .set({ visibleToBuyers: input.visible, releasedBy: input.visible ? getAuth(req).userId : null, releasedAt: input.visible ? new Date() : null })
        .where(and(eq(schema.vehicleDocuments.id, docId), eq(schema.vehicleDocuments.vehicleId, id)))
        .returning();
      if (!d) throw notFound('Dokument');
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_DOCUMENT_RELEASED',
        entityType: 'vehicle',
        entityId: id,
        newValue: { documentId: docId, kind: d.kind, visibleToBuyers: input.visible },
      });
      return { ok: true };
    });
  });

  // ---------- Schäden ----------
  app.post('/vehicles/:id/damages', { preHandler: requireInspectorOrAdmin }, async (req, reply) => {
    const id = vid(req);
    const input = parse(damageSchema, req.body);
    const created = await db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      if (input.clientId) {
        const [existing] = await tx.select().from(schema.vehicleDamages).where(and(eq(schema.vehicleDamages.id, input.clientId), eq(schema.vehicleDamages.vehicleId, id)));
        if (existing) return existing; // Wiederholung aus der Offline-Warteschlange
      }
      await touchInspection(tx, req, v);
      await assertPhotosBelong(tx, id, input.photoIds);
      const [d] = await tx
        .insert(schema.vehicleDamages)
        .values({ ...(input.clientId ? { id: input.clientId } : {}), vehicleId: id, zone: input.zone, kind: input.kind, size: input.size, severity: input.severity, description: input.description, createdBy: getAuth(req).userId })
        .returning();
      if (input.photoIds.length) {
        await tx.insert(schema.vehicleDamagePhotos).values(input.photoIds.map((p) => ({ damageId: d!.id, photoId: p })));
      }
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: { damageAdded: { ...input, id: d!.id } } });
      await afterChange(tx, id);
      return d!;
    });
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/vehicles/:id/damages/:damageId', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const damageId = parse(uuidSchema, (req.params as { damageId: string }).damageId);
    const input = parse(damageSchema, req.body);
    return db.transaction(async (tx) => {
      await loadForInspection(tx, req, id);
      await assertPhotosBelong(tx, id, input.photoIds);
      const [before] = await tx.select().from(schema.vehicleDamages).where(and(eq(schema.vehicleDamages.id, damageId), eq(schema.vehicleDamages.vehicleId, id)));
      if (!before) throw notFound('Schaden');
      await tx
        .update(schema.vehicleDamages)
        .set({ zone: input.zone, kind: input.kind, size: input.size, severity: input.severity, description: input.description })
        .where(eq(schema.vehicleDamages.id, damageId));
      await tx.delete(schema.vehicleDamagePhotos).where(eq(schema.vehicleDamagePhotos.damageId, damageId));
      if (input.photoIds.length) await tx.insert(schema.vehicleDamagePhotos).values(input.photoIds.map((p) => ({ damageId, photoId: p })));
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, oldValue: { damage: before }, newValue: { damage: input } });
      await afterChange(tx, id);
      return { ok: true };
    });
  });

  app.delete('/vehicles/:id/damages/:damageId', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const damageId = parse(uuidSchema, (req.params as { damageId: string }).damageId);
    return db.transaction(async (tx) => {
      await loadForInspection(tx, req, id);
      const [before] = await tx.select().from(schema.vehicleDamages).where(and(eq(schema.vehicleDamages.id, damageId), eq(schema.vehicleDamages.vehicleId, id)));
      if (!before) throw notFound('Schaden');
      await tx.delete(schema.vehicleDamages).where(eq(schema.vehicleDamages.id, damageId));
      // Vor Abschluss der Aufnahme erlaubt; das Audit-Log bewahrt den gelöschten Eintrag.
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, oldValue: { damageRemoved: before } });
      await afterChange(tx, id);
      return { ok: true };
    });
  });

  // ---------- Prüfwerte ----------
  app.put('/vehicles/:id/paint', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(paintSchema, req.body);
    const settings = await getSettings();
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      for (const m of input.measurements) {
        const flagged = isPaintValueFlagged(m.valueUm, { flagBelowUm: settings.paintFlagBelowUm, flagAboveUm: settings.paintFlagAboveUm });
        await tx
          .insert(schema.paintMeasurements)
          .values({ vehicleId: id, point: m.point, valueUm: m.valueUm, flagged })
          .onConflictDoUpdate({
            target: [schema.paintMeasurements.vehicleId, schema.paintMeasurements.point],
            set: { valueUm: m.valueUm, flagged },
          });
      }
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: { paint: input.measurements } });
      return { completeness: await afterChange(tx, id) };
    });
  });

  app.put('/vehicles/:id/tires', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(tiresSchema, req.body);
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      for (const t of input.tires) {
        const values = {
          brand: t.brand,
          dimension: t.dimension,
          season: t.season,
          treadMm: t.treadMm,
          damage: t.damage,
          dot: t.dot,
          rimCondition: t.rimCondition,
        };
        await tx
          .insert(schema.tireMeasurements)
          .values({ vehicleId: id, position: t.position, ...values })
          .onConflictDoUpdate({ target: [schema.tireMeasurements.vehicleId, schema.tireMeasurements.position], set: values });
      }
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: { tires: input.tires } });
      return { completeness: await afterChange(tx, id) };
    });
  });

  app.put('/vehicles/:id/pdr', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(pdrSchema, req.body);
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      if (input.lineboardPhotoId) await assertPhotosBelong(tx, id, [input.lineboardPhotoId]);
      const values = {
        performed: input.performed,
        lineboardPhotoId: input.performed ? (input.lineboardPhotoId ?? null) : null,
        dentCount: input.performed ? (input.dentCount ?? null) : null,
        positions: input.performed ? input.positions : null,
        size: input.performed ? input.size : null,
        paintDamaged: input.performed ? (input.paintDamaged ?? null) : null,
        updatedAt: new Date(),
      };
      await tx.insert(schema.pdrChecks).values({ vehicleId: id, ...values }).onConflictDoUpdate({ target: schema.pdrChecks.vehicleId, set: values });
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: { pdr: input } });
      return { completeness: await afterChange(tx, id) };
    });
  });

  /** OBD-Berichte sind append-only: Fehlercodes können über die Plattform nie gelöscht werden (Spec §16). */
  app.post('/vehicles/:id/diagnostics', { preHandler: requireInspectorOrAdmin }, async (req, reply) => {
    const id = vid(req);
    const input = parse(diagnosticSchema, req.body);
    const r = await db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      if (input.clientId) {
        const [existing] = await tx.select().from(schema.diagnosticReports).where(and(eq(schema.diagnosticReports.id, input.clientId), eq(schema.diagnosticReports.vehicleId, id)));
        if (existing) return existing;
      }
      await touchInspection(tx, req, v);
      const [report] = await tx
        .insert(schema.diagnosticReports)
        .values({ ...(input.clientId ? { id: input.clientId } : {}), vehicleId: id, device: input.device, performedAt: new Date(input.performedAt), ecus: input.ecus, notes: input.notes, createdBy: getAuth(req).userId })
        .returning();
      if (input.codes.length) {
        await tx.insert(schema.diagnosticCodes).values(input.codes.map((c) => ({ reportId: report!.id, code: c.code.toUpperCase(), description: c.description, status: c.status })));
      }
      await audit(tx, actorOf(req), { event: 'DIAGNOSTIC_REPORT_ADDED', entityType: 'vehicle', entityId: id, newValue: { reportId: report!.id, device: input.device, codes: input.codes.length } });
      await afterChange(tx, id);
      return report!;
    });
    return reply.status(201).send({ id: r.id });
  });

  app.put('/vehicles/:id/battery', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(batterySchema, req.body);
    // Keine erfundenen SoH-Werte: HV-Daten nur mit dokumentierter Quelle (Spec §17).
    const hasHv = !!input.hvInfo && Object.values(input.hvInfo).some((x) => x !== null && x !== undefined && x !== '');
    if (hasHv && !input.hvSource) {
      throw new AppError(400, 'HV_SOURCE_REQUIRED', 'HV-Batterieinformationen dürfen nur mit dokumentierter Datenquelle gespeichert werden.');
    }
    if (hasHv && input.kind === 'ICE') throw new AppError(400, 'HV_NOT_APPLICABLE', 'HV-Batterieinformationen gelten nur für Elektro-/Hybridfahrzeuge.');
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      const values = {
        kind: input.kind,
        voltage: input.voltage ?? null,
        testResult: input.testResult,
        coldCranking: input.coldCranking ?? null,
        hvInfo: hasHv ? input.hvInfo : null,
        hvSource: hasHv ? input.hvSource : null,
        updatedAt: new Date(),
      };
      await tx.insert(schema.batteryChecks).values({ vehicleId: id, ...values }).onConflictDoUpdate({ target: schema.batteryChecks.vehicleId, set: values });
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: { battery: values } });
      return { completeness: await afterChange(tx, id) };
    });
  });

  app.put('/vehicles/:id/features', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(featuresSchema, req.body);
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      await touchInspection(tx, req, v);
      for (const f of input.features) {
        await tx
          .insert(schema.vehicleFeatureChecks)
          .values({ vehicleId: id, feature: f.feature, result: f.result, note: f.note })
          .onConflictDoUpdate({ target: [schema.vehicleFeatureChecks.vehicleId, schema.vehicleFeatureChecks.feature], set: { result: f.result, note: f.note } });
      }
      await audit(tx, actorOf(req), { event: 'VEHICLE_UPDATED', entityType: 'vehicle', entityId: id, newValue: { features: input.features } });
      return { completeness: await afterChange(tx, id) };
    });
  });

  app.get('/vehicles/:id/completeness', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    await loadVehicle(db, req, id);
    return recomputeCompleteness(db, id);
  });

  // ---------- Abschluss (Akte sperren) ----------
  app.post('/vehicles/:id/complete', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = vid(req);
    return db.transaction(async (tx) => {
      const v = await loadForInspection(tx, req, id);
      const c = await recomputeCompleteness(tx, id);
      if (!c.canComplete) {
        throw new AppError(409, 'INCOMPLETE', 'Die Aufnahme kann noch nicht abgeschlossen werden.', {
          missing: c.missing,
          missingPhotoSlots: c.missingPhotoSlots,
        });
      }
      if (v.status === 'DRAFT') throw new AppError(409, 'INCOMPLETE', 'Die Aufnahme wurde noch nicht begonnen.');
      const now = new Date();
      await setVehicleStatus(tx, req, v, 'WAITING_REVIEW', { lockedAt: now, inspectionCompletedAt: now, requestedPhotoSlots: [] });
      await notifyAdmins(tx, {
        type: 'VEHICLE_WAITING_REVIEW',
        title: `Fahrzeug wartet auf Prüfung: ${v.internalNumber}`,
        body: `${v.make ?? ''} ${v.model ?? ''} (${c.percent} % vollständig) wartet auf Admin-Prüfung.`,
        link: `/admin/pruefung/${id}`,
        email: false,
      });
      await publish(tx, channels.admin(), 'vehicle.waiting_review', { id });
      return { status: 'WAITING_REVIEW', completeness: c };
    });
  });

  // ---------- Admin: Prüfung ----------
  app.get('/admin/review-queue', { preHandler: requireAdmin }, async () => {
    return db
      .select({
        id: schema.vehicles.id,
        internalNumber: schema.vehicles.internalNumber,
        vin: schema.vehicles.vin,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        status: schema.vehicles.status,
        completenessPct: schema.vehicles.completenessPct,
        hasDamages: schema.vehicles.hasDamages,
        paintFlagged: schema.vehicles.paintFlagged,
        returnCount: schema.vehicles.returnCount,
        companyName: schema.companies.name,
        inspectionCompletedAt: schema.vehicles.inspectionCompletedAt,
        photoCount: sql<number>`(select count(*)::int from vehicle_photos p where p.vehicle_id = ${schema.vehicles.id} and p.replaced_by_id is null)`,
        badPhotoCount: sql<number>`(select count(*)::int from vehicle_photos p where p.vehicle_id = ${schema.vehicles.id} and p.replaced_by_id is null and p.quality <> 'OK')`,
        damageCount: sql<number>`(select count(*)::int from vehicle_damages d where d.vehicle_id = ${schema.vehicles.id})`,
        documentCount: sql<number>`(select count(*)::int from vehicle_documents d where d.vehicle_id = ${schema.vehicles.id})`,
        dtcCount: sql<number>`(select count(*)::int from diagnostic_codes c join diagnostic_reports r on r.id = c.report_id where r.vehicle_id = ${schema.vehicles.id})`,
      })
      .from(schema.vehicles)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.vehicles.companyId))
      .where(eq(schema.vehicles.status, 'WAITING_REVIEW'))
      .orderBy(asc(schema.vehicles.inspectionCompletedAt));
  });

  app.post('/admin/vehicles/:id/review', { preHandler: requireAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(reviewVehicleSchema, req.body);
    return db.transaction(async (tx) => {
      const v = await loadVehicle(tx, req, id, { forUpdate: true });
      if (v.status !== 'WAITING_REVIEW') throw new AppError(409, 'INVALID_TRANSITION', 'Nur Fahrzeuge mit Status „Wartet auf Prüfung“ können geprüft werden.');
      if (input.action === 'approve') {
        const c = await recomputeCompleteness(tx, id);
        if (!c.canComplete) throw new AppError(409, 'INCOMPLETE', 'Pflichtangaben fehlen – Freigabe nicht möglich.', { missing: c.missing });
        await setVehicleStatus(tx, req, v, 'APPROVED', { approvedBy: getAuth(req).userId, approvedAt: new Date(), reviewNote: input.reason });
        await audit(tx, actorOf(req), { event: 'VEHICLE_REVIEWED', entityType: 'vehicle', entityId: id, newValue: { action: 'approve', note: input.reason } });
        await notifyCompany(tx, v.companyId, {
          type: 'VEHICLE_APPROVED',
          title: `Fahrzeug geprüft und freigegeben: ${v.internalNumber}`,
          body: `${v.make ?? ''} ${v.model ?? ''} wurde geprüft und wird für eine Auktion eingeplant.`,
          link: `/autohaus/fahrzeuge/${id}`,
          email: false,
        });
        return { status: 'APPROVED' };
      }
      if (!input.reason) throw new AppError(400, 'REASON_REQUIRED', 'Bitte angeben, was korrigiert werden soll.');
      const slots = (input.requestedPhotoSlots ?? []).filter((s) => (PHOTO_SLOTS as readonly string[]).includes(s)) as PhotoSlot[];
      await setVehicleStatus(tx, req, v, 'REQUIRES_CORRECTION', {
        lockedAt: null,
        reviewNote: input.reason,
        requestedPhotoSlots: slots,
        returnCount: v.returnCount + 1,
      });
      await audit(tx, actorOf(req), { event: 'VEHICLE_REVIEWED', entityType: 'vehicle', entityId: id, newValue: { action: 'return', reason: input.reason, requestedPhotoSlots: slots } });
      if (v.inspectorUserId) {
        await notifyUsers(tx, [v.inspectorUserId], {
          type: 'VEHICLE_RETURNED',
          title: `Korrektur erforderlich: ${v.internalNumber}`,
          body: `${input.reason}${slots.length ? ` (Zusatzfotos: ${slots.length})` : ''}`,
          link: `/aussendienst/fahrzeug/${id}`,
        });
      }
      return { status: 'REQUIRES_CORRECTION' };
    });
  });

  /** Nachvollziehbare Korrektur nach Sperrung: Originalwerte bleiben in vehicle_revisions erhalten. */
  app.post('/admin/vehicles/:id/correct', { preHandler: requireAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(correctionSchema, req.body);
    return db.transaction(async (tx) => {
      const v = await loadVehicle(tx, req, id, { forUpdate: true });
      if (['IN_AUCTION', 'SOLD', 'COMPLETED'].includes(v.status)) {
        throw new AppError(409, 'VEHICLE_IN_SALE', 'Während einer laufenden Auktion oder nach Verkauf sind keine Korrekturen möglich.');
      }
      const changes = input.changes as Record<string, unknown>;
      const before = v as unknown as Record<string, unknown>;
      const changed = Object.keys(changes).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(changes[k]));
      if (changed.length === 0) throw new AppError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
      for (const field of changed) {
        await tx.insert(schema.vehicleRevisions).values({
          vehicleId: id,
          changedBy: getAuth(req).userId,
          field,
          oldValue: before[field] ?? null,
          newValue: changes[field] ?? null,
          reason: input.reason,
        });
      }
      await tx
        .update(schema.vehicles)
        .set({ ...Object.fromEntries(changed.map((k) => [k, changes[k]])), updatedAt: new Date() })
        .where(eq(schema.vehicles.id, id));
      await audit(tx, actorOf(req), {
        event: 'VEHICLE_CORRECTED',
        entityType: 'vehicle',
        entityId: id,
        oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])),
        newValue: { ...Object.fromEntries(changed.map((k) => [k, changes[k]])), reason: input.reason },
      });
      await afterChange(tx, id);
      return { changed };
    });
  });

  app.post('/admin/vehicles/:id/comments', { preHandler: requireAdmin }, async (req, reply) => {
    const id = vid(req);
    const input = parse(commentSchema, req.body);
    await loadVehicle(db, req, id);
    const [c] = await db.insert(schema.vehicleComments).values({ vehicleId: id, userId: getAuth(req).userId, text: input.text, internal: true }).returning();
    return reply.status(201).send({ id: c!.id });
  });

  /** Fahrzeug ohne Verkauf an das Autohaus zurückgeben (Akte bleibt dauerhaft erhalten). */
  app.post('/admin/vehicles/:id/return-to-seller', { preHandler: requireAdmin }, async (req) => {
    const id = vid(req);
    const input = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    return db.transaction(async (tx) => {
      const v = await loadVehicle(tx, req, id, { forUpdate: true });
      if (v.status !== 'UNSOLD') throw new AppError(409, 'INVALID_TRANSITION', 'Nur nicht verkaufte Fahrzeuge können zurückgegeben werden.');
      await setVehicleStatus(tx, req, v, 'COMPLETED', { reviewNote: input.reason });
      return { status: 'COMPLETED' };
    });
  });
}

function photoResponse(p: typeof schema.vehiclePhotos.$inferSelect, duplicate: boolean) {
  const ok = p.quality === 'OK' || p.qualityOverride;
  return {
    id: p.id,
    slot: p.slot,
    quality: p.quality,
    qualityOverride: p.qualityOverride,
    metrics: p.qualityMetrics,
    duplicate,
    message: ok ? null : QUALITY_RETAKE_MESSAGE,
  };
}
