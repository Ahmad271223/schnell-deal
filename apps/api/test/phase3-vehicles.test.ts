import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/core/db/client';
import { api, approvedDealer, approvedDealership, auditEvents, blurryJpeg, createPlatformUser, darkJpeg, json, sharpJpeg, upload, type Session } from './helpers';
import { crid, drainJobs, inspectFullVehicle, randomVin, startedInspection } from './flows';

let admin: Session;
let ah: Session;
let otherAh: Session;
let dealer: Session;
let inspector: Session;
let otherInspector: Session;
let requestId: string;

beforeAll(async () => {
  admin = await createPlatformUser('ADMIN');
  ah = await approvedDealership(admin);
  otherAh = await approvedDealership(admin);
  dealer = await approvedDealer(admin);
  inspector = await createPlatformUser('INSPECTOR');
  otherInspector = await createPlatformUser('INSPECTOR');
  requestId = await startedInspection(admin, ah, inspector, 5);
});

async function newVehicle(): Promise<string> {
  const res = await api('POST', `/inspector/requests/${requestId}/vehicles`, { session: inspector, body: {} });
  expect(res.statusCode).toBe(201);
  return json(res).id;
}

describe('Fahrzeug anlegen', () => {
  it('erhält eine eindeutige interne Fahrzeug-ID; Anlage mit Client-ID ist idempotent (Offline)', async () => {
    const clientVehicleId = crypto.randomUUID();
    const a = await api('POST', `/inspector/requests/${requestId}/vehicles`, { session: inspector, body: { clientVehicleId } });
    const b = await api('POST', `/inspector/requests/${requestId}/vehicles`, { session: inspector, body: { clientVehicleId } });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(json(a).id).toBe(clientVehicleId);
    expect(json(a).internalNumber).toMatch(/^FZ-\d{6}$/);
    expect(json(b).internalNumber).toBe(json(a).internalNumber);
  });

  it('fremder Außendienstmitarbeiter kann im Auftrag keine Fahrzeuge anlegen', async () => {
    const res = await api('POST', `/inspector/requests/${requestId}/vehicles`, { session: otherInspector, body: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe('FIN', () => {
  it('validiert das Format', async () => {
    const id = await newVehicle();
    const res = await api('POST', `/vehicles/${id}/vin`, { session: inspector, body: { vin: 'WVWZZZ1KZAW00000O' } });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('VIN_INVALID');
  });

  it('erkennt doppelte FIN (aktives Fahrzeug blockiert, historische erfordert Bestätigung)', async () => {
    const vin = randomVin();
    const a = await newVehicle();
    const b = await newVehicle();
    expect((await api('POST', `/vehicles/${a}/vin`, { session: inspector, body: { vin } })).statusCode).toBe(200);
    const dup = await api('POST', `/vehicles/${b}/vin`, { session: inspector, body: { vin: vin.toLowerCase() } });
    expect(dup.statusCode).toBe(409);
    expect(json(dup).error.code).toBe('VIN_DUPLICATE');
    // Erstes Fahrzeug historisch (abgeschlossen) → Wiederaufnahme mit Bestätigung.
    await db.update(schema.vehicles).set({ status: 'COMPLETED' }).where(eq(schema.vehicles.id, a));
    const seen = await api('POST', `/vehicles/${b}/vin`, { session: inspector, body: { vin } });
    expect(json(seen).error.code).toBe('VIN_SEEN_BEFORE');
    const ok = await api('POST', `/vehicles/${b}/vin`, { session: inspector, body: { vin, confirmDuplicate: true } });
    expect(ok.statusCode).toBe(200);
  });
});

describe('Fotos', () => {
  it('Qualitätsprüfung: zu dunkel / unscharf → "Bitte Foto erneut aufnehmen.", Original wird gespeichert', async () => {
    const id = await newVehicle();
    const dark = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'ENGINE_BAY', clientUploadId: crid() }, { name: 'a.jpg', content: await darkJpeg(), type: 'image/jpeg' });
    expect(dark.statusCode).toBe(201);
    expect(json(dark).quality).toBe('DARK');
    expect(json(dark).message).toBe('Bitte Foto erneut aufnehmen.');
    const blurry = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'ROOF', clientUploadId: crid() }, { name: 'b.jpg', content: await blurryJpeg(), type: 'image/jpeg' });
    expect(json(blurry).quality).toBe('BLURRY');
    // Schlechtes Foto zählt nicht als Pflichtfoto …
    let c = json(await api('GET', `/vehicles/${id}/completeness`, { session: inspector }));
    expect(c.missingPhotoSlots).toContain('ENGINE_BAY');
    // … außer mit dokumentierter Übersteuerung.
    const ov = await api('POST', `/vehicles/${id}/photos/${json(dark).id}/accept-quality`, { session: inspector, body: { reason: 'Motorraum bauartbedingt dunkel' } });
    expect(ov.statusCode).toBe(200);
    c = json(await api('GET', `/vehicles/${id}/completeness`, { session: inspector }));
    expect(c.missingPhotoSlots).not.toContain('ENGINE_BAY');
  });

  it('doppelter Upload (gleiche clientUploadId) erzeugt keinen zweiten Datensatz', async () => {
    const id = await newVehicle();
    const img = await sharpJpeg(640, 480, 77);
    const clientUploadId = crid();
    const first = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'FRONT', clientUploadId }, { name: 'f.jpg', content: img, type: 'image/jpeg' });
    const again = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'FRONT', clientUploadId }, { name: 'f.jpg', content: img, type: 'image/jpeg' });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(json(again).duplicate).toBe(true);
    expect(json(again).id).toBe(json(first).id);
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from vehicle_photos where vehicle_id = ${id}`)).rows as [{ n: number }];
    expect(n).toBe(1);
    // Identischer Bildinhalt für einen anderen Slot wird abgelehnt.
    const reuse = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'REAR', clientUploadId: crid() }, { name: 'r.jpg', content: img, type: 'image/jpeg' });
    expect(reuse.statusCode).toBe(409);
    expect(json(reuse).error.code).toBe('DUPLICATE_PHOTO');
  });

  it('Ersetzen eines Pflichtfotos behält das Original (keine unbemerkte Manipulation)', async () => {
    const id = await newVehicle();
    const a = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'LEFT_SIDE', clientUploadId: crid() }, { name: 'l1.jpg', content: await sharpJpeg(640, 480, 1001), type: 'image/jpeg' });
    const b = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'LEFT_SIDE', clientUploadId: crid() }, { name: 'l2.jpg', content: await sharpJpeg(640, 480, 1002), type: 'image/jpeg' });
    const rows = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.vehicleId, id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === json(a).id)!.replacedById).toBe(json(b).id);
    expect(await auditEvents(id)).toContain('VEHICLE_PHOTO_REPLACED');
    await expect(db.execute(sql`delete from vehicle_photos where id = ${json(a).id}`)).rejects.toBeTruthy();
  });

  it('Worker erzeugt Web-Version und Thumbnail; Original bleibt unverändert', async () => {
    const id = await newVehicle();
    const up = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'FRONT_LEFT_45', clientUploadId: crid() }, { name: 'x.jpg', content: await sharpJpeg(2400, 1600, 5), type: 'image/jpeg' });
    await drainJobs();
    const [p] = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.id, json(up).id));
    expect(p!.uploadStatus).toBe('PROCESSED');
    expect(p!.storageKeyWeb).toBeTruthy();
    expect(p!.storageKeyThumb).toBeTruthy();
    expect(p!.storageKeyOriginal).not.toBe(p!.storageKeyWeb);
    const res = await api('GET', `/vehicles/${id}/photos/${p!.id}/file?variant=thumb`, { session: inspector });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain('X-Amz-Signature');
  });

  it('lehnt Nicht-Bilder ab', async () => {
    const id = await newVehicle();
    const res = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'FRONT', clientUploadId: crid() }, { name: 'x.jpg', content: Buffer.from('<?php echo 1; ?>'), type: 'image/jpeg' });
    expect(res.statusCode).toBe(415);
  });
});

describe('Prüfwerte', () => {
  it('Lackmessung markiert auffällige Werte ohne Unfallaussage', async () => {
    const id = await newVehicle();
    await api('PUT', `/vehicles/${id}/paint`, { session: inspector, body: { measurements: [{ point: 'HOOD', valueUm: 120 }, { point: 'DOOR_FL', valueUm: 420 }] } });
    const file = json(await api('GET', `/vehicles/${id}`, { session: inspector }));
    expect(file.paint.find((p: { point: string }) => p.point === 'HOOD').flagged).toBe(false);
    expect(file.paint.find((p: { point: string }) => p.point === 'DOOR_FL').flagged).toBe(true);
    expect(file.paintFlagged).toBe(true);
    expect(JSON.stringify(file)).not.toMatch(/Unfall/);
  });

  it('OBD-Fehlercodes können nicht gelöscht werden', async () => {
    const id = await newVehicle();
    const res = await api('POST', `/vehicles/${id}/diagnostics`, {
      session: inspector,
      body: { device: 'Bosch KTS 560', performedAt: new Date().toISOString(), ecus: ['Motor', 'ABS'], notes: null, codes: [{ code: 'p0420', description: 'Katalysator Wirkungsgrad', status: 'PERMANENT' }] },
    });
    expect(res.statusCode).toBe(201);
    const file = json(await api('GET', `/vehicles/${id}`, { session: inspector }));
    expect(file.diagnostics[0].codes[0].code).toBe('P0420');
    await expect(db.execute(sql`delete from diagnostic_codes`)).rejects.toBeTruthy();
    await expect(db.execute(sql`update diagnostic_codes set status = 'UNKNOWN'`)).rejects.toBeTruthy();
  });

  it('HV-Batteriedaten nur mit dokumentierter Quelle (keine erfundenen SoH-Werte)', async () => {
    const id = await newVehicle();
    const bad = await api('PUT', `/vehicles/${id}/battery`, { session: inspector, body: { kind: 'EV', hvInfo: { sohPercent: 93 } } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.code).toBe('HV_SOURCE_REQUIRED');
    const ok = await api('PUT', `/vehicles/${id}/battery`, { session: inspector, body: { kind: 'EV', hvInfo: { sohPercent: 93 }, hvSource: 'Herstellerdiagnose via OBD, Gerät XY' } });
    expect(ok.statusCode).toBe(200);
  });

  it('Schäden mit Detailfotos', async () => {
    const id = await newVehicle();
    const photo = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'DAMAGE', clientUploadId: crid() }, { name: 'd.jpg', content: await sharpJpeg(640, 480, 4242), type: 'image/jpeg' });
    const res = await api('POST', `/vehicles/${id}/damages`, {
      session: inspector,
      body: { zone: 'FENDER_FR', kind: 'DENT', size: 'ca. 3 cm', severity: 'LOW', description: 'Delle ohne Lackschaden', photoIds: [json(photo).id] },
    });
    expect(res.statusCode).toBe(201);
    const file = json(await api('GET', `/vehicles/${id}`, { session: inspector }));
    expect(file.damages[0]).toMatchObject({ zone: 'FENDER_FR', kind: 'DENT', photoIds: [json(photo).id] });
    expect(file.hasDamages).toBe(true);
    // Foto eines fremden Fahrzeugs kann nicht verknüpft werden.
    const other = await newVehicle();
    const foreign = await api('POST', `/vehicles/${other}/damages`, { session: inspector, body: { zone: 'HOOD', kind: 'SCRATCH', severity: 'LOW', photoIds: [json(photo).id] } });
    expect(foreign.statusCode).toBe(400);
  });
});

describe('Abschluss, Sperre, Prüfung, Korrektur', () => {
  it('Abschluss ist blockiert, solange Pflichtbilder fehlen', async () => {
    const id = await newVehicle();
    await api('POST', `/vehicles/${id}/vin`, { session: inspector, body: { vin: randomVin() } });
    const res = await api('POST', `/vehicles/${id}/complete`, { session: inspector });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('INCOMPLETE');
    expect(json(res).error.details.missingPhotoSlots.length).toBe(28);
  });

  it('kompletter Ablauf: Abschluss sperrt die Akte, Admin weist zurück, Korrektur, Freigabe', async () => {
    const id = await inspectFullVehicle(inspector, requestId);
    let file = json(await api('GET', `/vehicles/${id}`, { session: admin }));
    expect(file.status).toBe('WAITING_REVIEW');
    expect(file.lockedAt).toBeTruthy();
    expect(file.completenessPct).toBe(100);

    // Nach Abschluss keine Bearbeitung durch den Außendienst.
    const locked = await api('PATCH', `/vehicles/${id}`, { session: inspector, body: { mileageKm: 1 } });
    expect(locked.statusCode).toBe(409);
    expect(json(locked).error.code).toBe('VEHICLE_LOCKED');

    // Review-Queue zeigt das Fahrzeug.
    const queue = json(await api('GET', '/admin/review-queue', { session: admin }));
    expect(queue.find((q: { id: string }) => q.id === id)).toMatchObject({ completenessPct: 100, photoCount: 28 });

    // Zurück an Mitarbeiter mit Zusatzfoto-Anforderung.
    expect((await api('POST', `/admin/vehicles/${id}/review`, { session: admin, body: { action: 'return' } })).statusCode).toBe(400);
    const ret = await api('POST', `/admin/vehicles/${id}/review`, { session: admin, body: { action: 'return', reason: 'Tachofoto unleserlich', requestedPhotoSlots: ['ODOMETER'] } });
    expect(ret.statusCode).toBe(200);
    file = json(await api('GET', `/vehicles/${id}`, { session: inspector }));
    expect(file.status).toBe('REQUIRES_CORRECTION');
    expect(file.requestedPhotoSlots).toEqual(['ODOMETER']);
    const replaced = await upload(`/vehicles/${id}/photos`, inspector, { slot: 'ODOMETER', clientUploadId: crid() }, { name: 'o.jpg', content: await sharpJpeg(640, 480, 99991), type: 'image/jpeg' });
    expect(replaced.statusCode).toBe(201);
    expect((await api('POST', `/vehicles/${id}/complete`, { session: inspector })).statusCode).toBe(200);

    // Freigabe
    expect((await api('POST', `/admin/vehicles/${id}/review`, { session: admin, body: { action: 'approve' } })).statusCode).toBe(200);
    file = json(await api('GET', `/vehicles/${id}`, { session: admin }));
    expect(file.status).toBe('APPROVED');
    expect(file.returnCount).toBe(1);

    // Nachvollziehbare Korrektur durch Admin: Originalwert bleibt erhalten.
    const corr = await api('POST', `/admin/vehicles/${id}/correct`, { session: admin, body: { reason: 'Tippfehler km-Stand laut Tachofoto', changes: { mileageKm: 87_400 } } });
    expect(corr.statusCode).toBe(200);
    file = json(await api('GET', `/vehicles/${id}`, { session: admin }));
    expect(file.mileageKm).toBe(87_400);
    expect(file.revisions[0]).toMatchObject({ field: 'mileageKm', oldValue: 87_300, newValue: 87_400 });
    await expect(db.execute(sql`update vehicle_revisions set reason = 'x'`)).rejects.toBeTruthy();
    expect(await auditEvents(id)).toEqual(expect.arrayContaining(['VEHICLE_CREATED', 'VEHICLE_STATUS_CHANGED', 'VEHICLE_REVIEWED', 'VEHICLE_CORRECTED']));

    // Interner Kommentar nur für Admin.
    await api('POST', `/admin/vehicles/${id}/comments`, { session: admin, body: { text: 'Preisvorstellung Autohaus: 18.000 €' } });
    const forDealership = json(await api('GET', `/vehicles/${id}`, { session: ah }));
    expect(forDealership.comments).toBeUndefined();
    expect(forDealership.revisions).toBeUndefined();
    expect(JSON.stringify(forDealership)).not.toContain('Preisvorstellung');
  }, 60_000);
});

describe('Mandantentrennung Fahrzeugakte (IDOR)', () => {
  it('fremdes Autohaus, Händler und fremder Außendienst erhalten 404', async () => {
    const id = await newVehicle();
    expect((await api('GET', `/vehicles/${id}`, { session: ah })).statusCode).toBe(200);
    expect((await api('GET', `/vehicles/${id}`, { session: otherAh })).statusCode).toBe(404);
    expect((await api('GET', `/vehicles/${id}`, { session: dealer })).statusCode).toBe(404);
    expect((await api('GET', `/vehicles/${id}`, { session: otherInspector })).statusCode).toBe(404);
    expect((await api('PATCH', `/vehicles/${id}`, { session: otherInspector, body: { mileageKm: 5 } })).statusCode).toBe(404);
    const list = json(await api('GET', '/vehicles', { session: otherAh }));
    expect(list.some((v: { id: string }) => v.id === id)).toBe(false);
  });

  it('Autohaus darf keine Fahrzeugdaten verändern', async () => {
    const id = await newVehicle();
    expect((await api('PATCH', `/vehicles/${id}`, { session: ah, body: { mileageKm: 5 } })).statusCode).toBe(403);
  });
});

void crid;
