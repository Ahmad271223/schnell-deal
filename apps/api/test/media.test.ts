import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '../src/core/db/client';
import { validateUpload, VIDEO_MIME } from '../src/core/storage';
import { activeAuction, bid, endAuctionNow, fixtureApprovedVehicle, inspectFullVehicle, startedInspection } from './flows';
import { api, approvedDealer, approvedDealership, createPlatformUser, json, PDF_BYTES, sharpJpeg, upload, type Session } from './helpers';

/** Minimaler MP4-Container (ftyp + leeres mdat): besteht die Magic-Byte-Prüfung, ist aber nicht abspielbar. */
export const MP4_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2', 'latin1'),
  Buffer.from([0, 0, 0, 8]),
  Buffer.from('mdat', 'latin1'),
]);

const video = (url: string, session: Session, content = MP4_BYTES, name = 'motor.mp4') => upload(url, session, {}, { name, content, type: 'video/mp4' });

describe('Motorvideo und direkter Foto-Upload', () => {
  let superadmin: Session;
  let inspector: Session;
  let stranger: Session;
  let dealership: Session & { companyId: string };
  let dealer: Session & { companyId: string };
  let vehicleId: string;

  beforeAll(async () => {
    superadmin = await createPlatformUser('SUPERADMIN');
    inspector = await createPlatformUser('INSPECTOR');
    stranger = await createPlatformUser('INSPECTOR');
    dealership = await approvedDealership(superadmin);
    dealer = await approvedDealer(superadmin);
    const requestId = await startedInspection(superadmin, dealership, inspector);
    vehicleId = await inspectFullVehicle(inspector, requestId, { complete: false });
  });

  it('Außendienst lädt das Video der eigenen Aufnahme hoch; fremder Außendienst und falsche Dateitypen werden abgelehnt', async () => {
    expect((await video(`/vehicles/${vehicleId}/media/video`, stranger)).statusCode).toBe(404);
    expect((await video(`/vehicles/${vehicleId}/media/video`, inspector, PDF_BYTES, 'getarnt.mp4')).statusCode).toBe(415);
    expect((await video(`/vehicles/${vehicleId}/media/video`, inspector, Buffer.alloc(0))).statusCode).toBe(400);

    const res = await video(`/vehicles/${vehicleId}/media/video`, inspector);
    expect(res.statusCode, res.body).toBe(201);
    expect(json(res)).toMatchObject({ ok: true, mime: 'video/mp4', sizeBytes: MP4_BYTES.length });

    const file = json(await api('GET', `/vehicles/${vehicleId}`, { session: inspector }));
    expect(file.hasEngineVideo).toBe(true);
    const [row] = await db.select({ key: schema.vehicles.engineVideoKey, mime: schema.vehicles.engineVideoMime }).from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
    expect(row?.key).toMatch(/^vehicles\/[0-9a-f-]{36}\/video\/\d{4}\/\d{2}\/[0-9a-f]{32}\.mp4$/);
    expect(row?.mime).toBe('video/mp4');
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, vehicleId));
    expect(audits.some((a) => a.event === 'VEHICLE_UPDATED' && (a.newValue as { engineVideo?: boolean })?.engineVideo === true)).toBe(true);

    // Abruf: Außendienst (eigene Akte) wird zur signierten URL weitergeleitet; Händler ohne sichtbare Auktion: 404.
    const dl = await api('GET', `/vehicles/${vehicleId}/media/video/file`, { session: inspector });
    expect(dl.statusCode).toBe(302);
    expect(String(dl.headers.location)).toContain('/video/');
    expect((await api('GET', `/vehicles/${vehicleId}/media/video/file`, { session: dealer })).statusCode).toBe(404);
  });

  it('nach dem Abschluss der Aufnahme darf nur noch der Admin ein Video ersetzen oder entfernen', async () => {
    expect((await api('POST', `/vehicles/${vehicleId}/complete`, { session: inspector })).statusCode).toBe(200);
    expect((await video(`/vehicles/${vehicleId}/media/video`, inspector)).statusCode).toBe(409);
    expect((await api('DELETE', `/vehicles/${vehicleId}/media/video`, { session: inspector })).statusCode).toBe(409);
    expect((await video(`/vehicles/${vehicleId}/media/video`, superadmin)).statusCode).toBe(201);
    expect((await api('DELETE', `/vehicles/${vehicleId}/media/video`, { session: superadmin })).statusCode).toBe(200);
    expect(json(await api('GET', `/vehicles/${vehicleId}`, { session: superadmin })).hasEngineVideo).toBe(false);
    expect((await api('DELETE', `/vehicles/${vehicleId}/media/video`, { session: superadmin })).statusCode).toBe(404);
    expect((await api('GET', `/vehicles/${vehicleId}/media/video/file`, { session: superadmin })).statusCode).toBe(404);
  });

  it('Händler sehen das Video nur über eine sichtbare Auktion; nach dem Ende nur noch Mitbieter', async () => {
    const v = await fixtureApprovedVehicle(dealership.companyId);
    expect((await video(`/vehicles/${v.id}/media/video`, superadmin)).statusCode).toBe(201);
    expect((await api('GET', `/vehicles/${v.id}/media/video/file`, { session: dealer })).statusCode).toBe(404);
    const auctionId = await activeAuction(superadmin, v.id);
    const detail = json(await api('GET', `/auctions/${auctionId}`, { session: dealer }));
    expect(detail.vehicle.hasEngineVideo).toBe(true);
    expect((await api('GET', `/vehicles/${v.id}/media/video/file`, { session: dealer })).statusCode).toBe(302);
    // Ein unterlegener Mitbieter behält den Zugriff auf die Akte der beendeten Auktion, ein Unbeteiligter nicht.
    const bystander = await approvedDealer(superadmin);
    const winner = await approvedDealer(superadmin);
    expect((await bid(dealer, auctionId, 1_000_000)).statusCode).toBe(201);
    expect((await bid(winner, auctionId, 1_010_000)).statusCode).toBe(201);
    await endAuctionNow(auctionId);
    expect((await api('GET', `/vehicles/${v.id}/media/video/file`, { session: dealer })).statusCode).toBe(302);
    expect((await api('GET', `/vehicles/${v.id}/media/video/file`, { session: winner })).statusCode).toBe(302);
    expect((await api('GET', `/vehicles/${v.id}/media/video/file`, { session: bystander })).statusCode).toBe(404);
  });

  it('Admin reicht Fotos nach: erstes Foto wird Kartenbild, Qualität bleibt geprüft, Löschen blendet aus', async () => {
    const v = await fixtureApprovedVehicle(dealership.companyId);
    const first = await upload(`/vehicles/${v.id}/media/photo`, superadmin, {}, { name: 'a.jpg', content: await sharpJpeg(640, 480, 7), type: 'image/jpeg' });
    expect(first.statusCode, first.body).toBe(201);
    expect(json(first).slot).toBe('FRONT_LEFT_45');
    const second = await upload(`/vehicles/${v.id}/media/photo`, superadmin, {}, { name: 'b.jpg', content: await sharpJpeg(640, 480, 8), type: 'image/jpeg' });
    expect(json(second).slot).toBe('EXTRA');
    const photos = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.vehicleId, v.id));
    expect(photos).toHaveLength(2);
    expect(photos.every((p) => p.qualityOverride === false)).toBe(true);

    expect((await api('DELETE', `/vehicles/${v.id}/media/photo/${json(second).id}`, { session: superadmin })).statusCode).toBe(200);
    const file = json(await api('GET', `/vehicles/${v.id}`, { session: superadmin }));
    expect(file.photos.filter((p: { replaced: boolean }) => !p.replaced).map((p: { id: string }) => p.id)).toEqual([json(first).id]);
    // Außendienst nutzt den Aufnahmeprozess, nicht den Admin-Upload.
    expect((await upload(`/vehicles/${v.id}/media/photo`, inspector, {}, { name: 'c.jpg', content: await sharpJpeg(640, 480, 9), type: 'image/jpeg' })).statusCode).toBe(403);
  });

  it('Größenlimit für Videos greift unabhängig vom Fotolimit', async () => {
    const big = Buffer.concat([MP4_BYTES, Buffer.alloc(1_500_000)]);
    await expect(validateUpload(big, VIDEO_MIME, { maxMb: 1 })).rejects.toMatchObject({ statusCode: 413, code: 'FILE_TOO_LARGE' });
    await expect(validateUpload(big, VIDEO_MIME, { maxMb: 2 })).resolves.toMatchObject({ mime: 'video/mp4', ext: 'mp4' });
    await expect(validateUpload(MP4_BYTES, ['image/jpeg'])).rejects.toMatchObject({ statusCode: 415 });
  });
});
