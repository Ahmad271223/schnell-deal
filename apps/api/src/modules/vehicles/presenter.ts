import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { kwToPs } from '@sd/shared';
import { schema, type DbOrTx } from '../../core/db/client';
import { notFound } from '../../core/errors';

export type Audience = 'admin' | 'inspector' | 'dealership' | 'buyer';

/**
 * Baut die Fahrzeugakte je nach Zielgruppe zusammen. Vertrauliche Felder werden hier
 * zentral entfernt – nicht im Frontend versteckt.
 *
 * - buyer: keine Einliefereridentität, kein Kennzeichen, nur freigegebene Dokumente,
 *          keine internen Notizen/Revisionen, keine Original-Fotos.
 * - dealership: eigene Akte ohne interne Kommentare.
 */
export async function buildVehicleFile(tx: DbOrTx, vehicleId: string, audience: Audience) {
  const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
  if (!v) throw notFound('Fahrzeug');

  const photoRows = await tx
    .select()
    .from(schema.vehiclePhotos)
    .where(and(eq(schema.vehiclePhotos.vehicleId, vehicleId), audience === 'admin' ? undefined : isNull(schema.vehiclePhotos.replacedById)))
    .orderBy(asc(schema.vehiclePhotos.createdAt));
  const photos = photoRows.map((p) => ({
    id: p.id,
    slot: p.slot,
    quality: p.quality,
    qualityOverride: p.qualityOverride,
    qualityMetrics: audience === 'buyer' ? undefined : p.qualityMetrics,
    width: p.width,
    height: p.height,
    processed: p.uploadStatus === 'PROCESSED',
    replaced: !!p.replacedById,
    replacedAt: p.replacedAt,
    sha256: audience === 'buyer' ? undefined : p.sha256,
    createdAt: p.createdAt,
  }));

  const damages = await tx.select().from(schema.vehicleDamages).where(eq(schema.vehicleDamages.vehicleId, vehicleId)).orderBy(asc(schema.vehicleDamages.createdAt));
  const damagePhotos = damages.length
    ? await tx
        .select()
        .from(schema.vehicleDamagePhotos)
        .where(inArray(schema.vehicleDamagePhotos.damageId, damages.map((d) => d.id)))
    : [];

  const docsAll = await tx.select().from(schema.vehicleDocuments).where(eq(schema.vehicleDocuments.vehicleId, vehicleId)).orderBy(asc(schema.vehicleDocuments.createdAt));
  const documents = docsAll
    .filter((d) => audience !== 'buyer' || d.visibleToBuyers)
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      fileName: d.fileName,
      mime: d.mime,
      sizeBytes: d.sizeBytes,
      visibleToBuyers: audience === 'buyer' ? undefined : d.visibleToBuyers,
      releasedAt: audience === 'buyer' ? undefined : d.releasedAt,
      createdAt: d.createdAt,
    }));

  const paint = await tx.select().from(schema.paintMeasurements).where(eq(schema.paintMeasurements.vehicleId, vehicleId));
  const tires = await tx.select().from(schema.tireMeasurements).where(eq(schema.tireMeasurements.vehicleId, vehicleId));
  const [pdr] = await tx.select().from(schema.pdrChecks).where(eq(schema.pdrChecks.vehicleId, vehicleId));
  const reports = await tx.select().from(schema.diagnosticReports).where(eq(schema.diagnosticReports.vehicleId, vehicleId)).orderBy(desc(schema.diagnosticReports.performedAt));
  const codes = reports.length
    ? await tx.select().from(schema.diagnosticCodes).where(inArray(schema.diagnosticCodes.reportId, reports.map((r) => r.id)))
    : [];
  const [battery] = await tx.select().from(schema.batteryChecks).where(eq(schema.batteryChecks.vehicleId, vehicleId));
  const features = await tx.select().from(schema.vehicleFeatureChecks).where(eq(schema.vehicleFeatureChecks.vehicleId, vehicleId));

  const [company] = await tx
    .select({ id: schema.companies.id, name: schema.companies.name, city: schema.companies.city, zip: schema.companies.zip })
    .from(schema.companies)
    .where(eq(schema.companies.id, v.companyId));

  let inspectorName: string | null = null;
  if (v.inspectorUserId && audience !== 'buyer') {
    const [i] = await tx.select({ f: schema.users.firstName, l: schema.users.lastName }).from(schema.users).where(eq(schema.users.id, v.inspectorUserId));
    inspectorName = i ? (audience === 'dealership' ? `${i.f} ${i.l.charAt(0)}.` : `${i.f} ${i.l}`) : null;
  }

  const comments =
    audience === 'admin'
      ? await tx
          .select({
            id: schema.vehicleComments.id,
            text: schema.vehicleComments.text,
            createdAt: schema.vehicleComments.createdAt,
            author: schema.users.email,
          })
          .from(schema.vehicleComments)
          .innerJoin(schema.users, eq(schema.users.id, schema.vehicleComments.userId))
          .where(eq(schema.vehicleComments.vehicleId, vehicleId))
          .orderBy(desc(schema.vehicleComments.createdAt))
      : undefined;
  const revisions =
    audience === 'admin'
      ? await tx.select().from(schema.vehicleRevisions).where(eq(schema.vehicleRevisions.vehicleId, vehicleId)).orderBy(desc(schema.vehicleRevisions.createdAt))
      : undefined;

  return {
    id: v.id,
    internalNumber: v.internalNumber,
    status: v.status,
    vin: v.vin,
    vinCheck: v.vinCheck,
    licensePlate: audience === 'buyer' ? undefined : v.licensePlate,
    make: v.make,
    model: v.model,
    variant: v.variant,
    firstRegistration: v.firstRegistration,
    modelYear: v.modelYear,
    mileageKm: v.mileageKm,
    fuel: v.fuel,
    powerKw: v.powerKw,
    powerPs: kwToPs(v.powerKw),
    displacementCcm: v.displacementCcm,
    transmission: v.transmission,
    drive: v.drive,
    body: v.body,
    color: v.color,
    doors: v.doors,
    seats: v.seats,
    ownersCount: v.ownersCount,
    huUntil: v.huUntil,
    origin: v.origin,
    emissionClass: v.emissionClass,
    holderType: v.holderType,
    keysCount: v.keysCount,
    equipment: v.equipment,
    hasEngineVideo: !!v.engineVideoKey,
    completenessPct: v.completenessPct,
    hasDamages: v.hasDamages,
    paintFlagged: v.paintFlagged,
    location: { zip: v.locationZip, city: v.locationCity, street: audience === 'buyer' ? undefined : v.locationStreet },
    seller: audience === 'buyer' ? undefined : company,
    inspectorName,
    inspectionRequestId: audience === 'buyer' ? undefined : v.inspectionRequestId,
    inspectionStartedAt: v.inspectionStartedAt,
    inspectionCompletedAt: v.inspectionCompletedAt,
    lockedAt: v.lockedAt,
    reviewNote: audience === 'buyer' ? undefined : v.reviewNote,
    requestedPhotoSlots: audience === 'buyer' ? undefined : v.requestedPhotoSlots,
    returnCount: audience === 'admin' ? v.returnCount : undefined,
    approvedAt: v.approvedAt,
    photos,
    damages: damages.map((d) => ({
      id: d.id,
      zone: d.zone,
      kind: d.kind,
      size: d.size,
      severity: d.severity,
      description: d.description,
      photoIds: damagePhotos.filter((p) => p.damageId === d.id).map((p) => p.photoId),
    })),
    documents,
    paint: paint.map((p) => ({ point: p.point, valueUm: p.valueUm, flagged: p.flagged })),
    tires: tires.map((t) => ({
      position: t.position,
      brand: t.brand,
      dimension: t.dimension,
      season: t.season,
      treadMm: t.treadMm,
      damage: t.damage,
      dot: t.dot,
      rimCondition: t.rimCondition,
    })),
    pdr: pdr ?? null,
    diagnostics: reports.map((r) => ({
      id: r.id,
      device: r.device,
      performedAt: r.performedAt,
      ecus: r.ecus,
      notes: r.notes,
      codes: codes.filter((c) => c.reportId === r.id).map((c) => ({ code: c.code, description: c.description, status: c.status })),
    })),
    battery: battery
      ? {
          kind: battery.kind,
          voltage: battery.voltage,
          testResult: battery.testResult,
          coldCranking: battery.coldCranking,
          hvInfo: battery.hvInfo,
          hvSource: battery.hvSource,
        }
      : null,
    features: features.map((f) => ({ feature: f.feature, result: f.result, note: f.note })),
    comments,
    revisions,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}
