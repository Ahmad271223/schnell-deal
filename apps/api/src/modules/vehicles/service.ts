import type { FastifyRequest } from 'fastify';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  assertTransition,
  computeCompleteness,
  FEATURES,
  type VehicleStatus,
} from '@sd/shared';
import { schema, type DbOrTx } from '../../core/db/client';
import { AppError, notFound } from '../../core/errors';
import { actorOf, getAuth, isAdmin } from '../../core/auth';
import { audit } from '../../core/audit';

export type Vehicle = typeof schema.vehicles.$inferSelect;

/** Statusse, in denen der Außendienst die Akte bearbeiten darf. */
export const INSPECTOR_EDITABLE: VehicleStatus[] = ['DRAFT', 'INSPECTION_IN_PROGRESS', 'REQUIRES_CORRECTION'];

/**
 * Sichtbarkeit einer Fahrzeugakte für interne Rollen:
 * - Admin: alle
 * - Außendienst: Fahrzeuge eigener Aufnahmen bzw. Aufträge mit aktiver Zuweisung
 * - Autohaus: nur Fahrzeuge der eigenen Firma
 * Händler sehen Fahrzeuge ausschließlich über die Auktionsansicht (eigener Presenter).
 */
export function vehicleVisibility(req: FastifyRequest) {
  const u = getAuth(req);
  if (isAdmin(u)) return undefined;
  if (u.platformRole === 'INSPECTOR') {
    return sql`(${schema.vehicles.inspectorUserId} = ${u.userId} OR EXISTS (
      SELECT 1 FROM inspection_assignments ia
      WHERE ia.request_id = ${schema.vehicles.inspectionRequestId} AND ia.active AND ia.inspector_user_id = ${u.userId}))`;
  }
  if (u.company?.type === 'DEALERSHIP' && u.company.status === 'APPROVED') return eq(schema.vehicles.companyId, u.company.id);
  return sql`false`;
}

export async function loadVehicle(tx: DbOrTx, req: FastifyRequest, id: string, opts: { forUpdate?: boolean } = {}): Promise<Vehicle> {
  const q = tx
    .select()
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, id), vehicleVisibility(req)))
    .limit(1);
  const rows = opts.forUpdate ? await q.for('update') : await q;
  if (!rows[0]) throw notFound('Fahrzeug');
  return rows[0];
}

/** Lädt die Akte zur Bearbeitung durch den Außendienst (gesperrt nach Abschluss). */
export async function loadForInspection(tx: DbOrTx, req: FastifyRequest, id: string): Promise<Vehicle> {
  const u = getAuth(req);
  if (u.platformRole !== 'INSPECTOR' && !isAdmin(u)) throw new AppError(403, 'FORBIDDEN', 'Nur der Außendienst erfasst Fahrzeugdaten.');
  const v = await loadVehicle(tx, req, id, { forUpdate: true });
  if (!INSPECTOR_EDITABLE.includes(v.status) || v.lockedAt) {
    throw new AppError(
      409,
      'VEHICLE_LOCKED',
      'Die Fahrzeugakte ist abgeschlossen und gesperrt. Änderungen sind nur noch als nachvollziehbare Korrektur durch den Administrator möglich.',
    );
  }
  return v;
}

export async function setVehicleStatus(tx: DbOrTx, req: FastifyRequest | null, v: Vehicle, to: VehicleStatus, extra: Partial<Vehicle> = {}): Promise<void> {
  assertTransition('vehicle', v.status, to);
  await tx
    .update(schema.vehicles)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(eq(schema.vehicles.id, v.id));
  await audit(tx, req ? actorOf(req) : { userId: null, role: 'SYSTEM', companyId: null }, {
    event: 'VEHICLE_STATUS_CHANGED',
    entityType: 'vehicle',
    entityId: v.id,
    oldValue: { status: v.status },
    newValue: { status: to },
  });
}

/** Erste Datenerfassung startet die Aufnahme (DRAFT → INSPECTION_IN_PROGRESS). */
export async function touchInspection(tx: DbOrTx, req: FastifyRequest, v: Vehicle): Promise<void> {
  if (v.status === 'DRAFT') {
    await setVehicleStatus(tx, req, v, 'INSPECTION_IN_PROGRESS', { inspectionStartedAt: new Date() });
    v.status = 'INSPECTION_IN_PROGRESS';
  }
}

export interface CompletenessDetails {
  percent: number;
  missing: string[];
  missingPhotoSlots: string[];
  canComplete: boolean;
  photoStats: { required: number; present: number; badQuality: number };
}

/** Vollständigkeit aus echten DB-Werten berechnen und an der Akte speichern. */
export async function recomputeCompleteness(tx: DbOrTx, vehicleId: string): Promise<CompletenessDetails> {
  const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
  if (!v) throw notFound('Fahrzeug');
  const photos = await tx
    .select({ slot: schema.vehiclePhotos.slot, quality: schema.vehiclePhotos.quality, override: schema.vehiclePhotos.qualityOverride })
    .from(schema.vehiclePhotos)
    .where(and(eq(schema.vehiclePhotos.vehicleId, vehicleId), isNull(schema.vehiclePhotos.replacedById)));
  // Nur Fotos mit bestandener Qualitätsprüfung (oder dokumentierter Übersteuerung) zählen als Pflichtfoto.
  const usable = photos.filter((p) => p.quality === 'OK' || p.override);
  const badQuality = photos.length - usable.length;
  const paint = await tx.select({ point: schema.paintMeasurements.point, flagged: schema.paintMeasurements.flagged }).from(schema.paintMeasurements).where(eq(schema.paintMeasurements.vehicleId, vehicleId));
  const tires = await tx.select({ position: schema.tireMeasurements.position }).from(schema.tireMeasurements).where(eq(schema.tireMeasurements.vehicleId, vehicleId));
  const features = await tx.select({ f: schema.vehicleFeatureChecks.feature }).from(schema.vehicleFeatureChecks).where(eq(schema.vehicleFeatureChecks.vehicleId, vehicleId));
  const [reg] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.vehicleDocuments)
    .where(and(eq(schema.vehicleDocuments.vehicleId, vehicleId), eq(schema.vehicleDocuments.kind, 'REGISTRATION_1')));
  const [dmg] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.vehicleDamages).where(eq(schema.vehicleDamages.vehicleId, vehicleId));

  const result = computeCompleteness({
    vinValid: !!v.vin && v.vinCheck !== 'INVALID',
    mileageKm: v.mileageKm,
    hasBasicData: !!(v.make && v.model && v.firstRegistration && v.fuel && v.transmission),
    photoSlots: usable.map((p) => p.slot),
    paintPoints: paint.map((p) => p.point),
    tirePositions: tires.map((t) => t.position),
    featureCount: features.length,
    featureTotal: FEATURES.length,
    hasRegistrationDoc: (reg?.n ?? 0) > 0,
  });
  const requiredPresent = 28 - result.missingPhotoSlots.length;
  await tx
    .update(schema.vehicles)
    .set({
      completenessPct: result.percent,
      hasDamages: (dmg?.n ?? 0) > 0,
      paintFlagged: paint.some((p) => p.flagged),
    })
    .where(eq(schema.vehicles.id, vehicleId));
  return { ...result, photoStats: { required: 28, present: requiredPresent, badQuality } };
}

/** Dublettenprüfung der FIN. Aktive Dubletten blockieren; historische (abgeschlossene) Akten erfordern Bestätigung. */
export async function findVinDuplicates(tx: DbOrTx, vin: string, excludeVehicleId: string) {
  return tx
    .select({
      id: schema.vehicles.id,
      internalNumber: schema.vehicles.internalNumber,
      status: schema.vehicles.status,
      companyId: schema.vehicles.companyId,
      createdAt: schema.vehicles.createdAt,
    })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.vin, vin), ne(schema.vehicles.id, excludeVehicleId)));
}

export async function assertPhotosBelong(tx: DbOrTx, vehicleId: string, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const rows = await tx
    .select({ id: schema.vehiclePhotos.id })
    .from(schema.vehiclePhotos)
    .where(and(eq(schema.vehiclePhotos.vehicleId, vehicleId), inArray(schema.vehiclePhotos.id, photoIds)));
  if (rows.length !== new Set(photoIds).size) throw new AppError(400, 'INVALID_PHOTOS', 'Fotos gehören nicht zu diesem Fahrzeug.');
}
