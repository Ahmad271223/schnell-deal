import { beforeAll, describe, expect, it } from 'vitest';
import { activeAuction, bid, fixtureApprovedVehicle } from './flows';
import { api, approvedDealer, approvedDealership, createPlatformUser, json, sharpJpeg, upload, type Session } from './helpers';

/** Händler-Startseite: Kennzahlen über alle sichtbaren Auktionen und Katalogkarten („Showrooms“). */
describe('Händler-Startseite', () => {
  let superadmin: Session;
  let dealership: Session & { companyId: string };
  let dealerA: Session & { companyId: string };
  let dealerB: Session & { companyId: string };
  let catalogId: string;
  let draftCatalogId: string;
  const auctionIds: string[] = [];
  const vehicleIds: string[] = [];
  let coverPhotoId: string;

  beforeAll(async () => {
    superadmin = await createPlatformUser('SUPERADMIN');
    dealership = await approvedDealership(superadmin);
    dealerA = await approvedDealer(superadmin);
    dealerB = await approvedDealer(superadmin);

    const catalog = json(await api('POST', '/admin/catalogs', { session: superadmin, body: { name: 'Hannover Auktion', startsAt: new Date(Date.now() + 86_400_000).toISOString() } }));
    catalogId = catalog.id;
    expect((await api('POST', `/admin/catalogs/${catalogId}/status`, { session: superadmin, body: { status: 'PUBLISHED' } })).statusCode).toBe(200);
    const group = json(await api('POST', '/admin/dealer-groups', { session: superadmin, body: { name: 'Nur Händler A' } }));
    expect((await api('PUT', `/admin/dealer-groups/${group.id}/members`, { session: superadmin, body: { companyIds: [dealerA.companyId] } })).statusCode).toBe(200);

    for (let i = 0; i < 3; i++) vehicleIds.push((await fixtureApprovedVehicle(dealership.companyId)).id);
    expect((await api('PUT', `/admin/catalogs/${catalogId}/vehicles`, { session: superadmin, body: { vehicleIds } })).statusCode).toBe(200);
    // Kartenbild für das zuerst endende Fahrzeug (wird Titelbild des Katalogs).
    const photo = await upload(`/vehicles/${vehicleIds[0]}/media/photo`, superadmin, {}, { name: 'a.jpg', content: await sharpJpeg(640, 480, 3), type: 'image/jpeg' });
    coverPhotoId = json(photo).id;
    // Auktion 0 endet in ~11 Minuten (innerhalb der „endet bald“-Spanne), Auktion 1 nur für Gruppe A, Auktion 2 regulär.
    auctionIds.push(await activeAuction(superadmin, vehicleIds[0]!, { catalogId, durationMinutes: 10 }));
    auctionIds.push(await activeAuction(superadmin, vehicleIds[1]!, { catalogId, dealerGroupId: group.id }));
    auctionIds.push(await activeAuction(superadmin, vehicleIds[2]!, { catalogId }));

    // Nicht veröffentlichter Katalog mit laufender Auktion: Auktion sichtbar, Katalogkarte nicht.
    draftCatalogId = json(await api('POST', '/admin/catalogs', { session: superadmin, body: { name: 'Entwurf' } })).id;
    const extra = await fixtureApprovedVehicle(dealership.companyId);
    expect((await api('PUT', `/admin/catalogs/${draftCatalogId}/vehicles`, { session: superadmin, body: { vehicleIds: [extra.id] } })).statusCode).toBe(200);
    auctionIds.push(await activeAuction(superadmin, extra.id, { catalogId: draftCatalogId }));
  });

  it('zählt sichtbare, bald endende, neue, geführte und beobachtete Auktionen je Händler', async () => {
    // Die Testdatenbank wird von parallel laufenden Testdateien geteilt: globale Zähler daher als Untergrenze,
    // händlerbezogene Zähler (führend, überboten, beobachtet) exakt.
    const a = json(await api('GET', '/auctions/summary', { session: dealerA }));
    expect(a).toMatchObject({ myLeading: 0, myOutbid: 0, watched: 0 });
    expect(a.active).toBeGreaterThanOrEqual(4);
    expect(a.newToday).toBeGreaterThanOrEqual(4);
    expect(a.catalogs).toBeGreaterThanOrEqual(2);
    expect(a.endingSoon).toBeGreaterThanOrEqual(1);
    expect(a.endingSoonMinutes).toBeGreaterThan(0);
    expect(a.serverNow).toEqual(expect.any(String));
    // Händler B sieht die gruppenbeschränkte Auktion nicht.
    const b = json(await api('GET', '/auctions/summary', { session: dealerB }));
    expect(b.active).toBeGreaterThanOrEqual(3);
    expect(a.active).toBeGreaterThanOrEqual(b.active + 1);

    expect((await bid(dealerA, auctionIds[0]!, 1_000_000)).statusCode).toBe(201);
    expect((await api('PUT', `/watchlist/${vehicleIds[2]}`, { session: dealerA })).statusCode).toBe(200);
    expect(json(await api('GET', '/auctions/summary', { session: dealerA }))).toMatchObject({ myLeading: 1, myOutbid: 0, watched: 1 });
    expect((await bid(dealerB, auctionIds[0]!, 1_010_000)).statusCode).toBe(201);
    expect(json(await api('GET', '/auctions/summary', { session: dealerA }))).toMatchObject({ myLeading: 0, myOutbid: 1 });
    expect(json(await api('GET', '/auctions/summary', { session: dealerB }))).toMatchObject({ myLeading: 1, myOutbid: 0 });

    expect((await api('GET', '/auctions/summary', { session: dealership })).statusCode).toBe(403);
    expect((await api('GET', '/auctions/summary', { session: superadmin })).statusCode).toBe(403);
  });

  it('listet nur veröffentlichte Kataloge mit sichtbaren Auktionen, mit Zahlen aus genau diesen Auktionen', async () => {
    const a = json(await api('GET', '/catalogs', { session: dealerA }));
    const ids = a.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(catalogId);
    expect(ids).not.toContain(draftCatalogId);
    const cat = a.items.find((c: { id: string }) => c.id === catalogId);
    expect(cat).toMatchObject({ name: 'Hannover Auktion', vehicleCount: 3, activeCount: 3, cover: { vehicleId: vehicleIds[0], photoId: coverPhotoId } });
    expect(cat.firstEndsAt).toEqual(expect.any(String));
    expect(new Date(cat.firstEndsAt).getTime()).toBeLessThanOrEqual(new Date(cat.lastEndsAt).getTime());

    const b = json(await api('GET', '/catalogs', { session: dealerB }));
    expect(b.items.find((c: { id: string }) => c.id === catalogId)).toMatchObject({ vehicleCount: 2, activeCount: 2 });

    expect((await api('POST', `/admin/catalogs/${draftCatalogId}/status`, { session: superadmin, body: { status: 'PUBLISHED' } })).statusCode).toBe(200);
    const again = json(await api('GET', '/catalogs', { session: dealerB }));
    expect(again.items.find((c: { id: string }) => c.id === draftCatalogId)).toMatchObject({ name: 'Entwurf', vehicleCount: 1, cover: null });

    expect((await api('GET', '/catalogs', { session: dealership })).statusCode).toBe(403);
  });

  it('liefert den Hinweistext des Betreibers auf der Auktionsseite nur, wenn er gepflegt ist', async () => {
    const settings = json(await api('GET', '/admin/settings', { session: superadmin }));
    expect(json(await api('GET', `/auctions/${auctionIds[2]}`, { session: dealerA })).notice).toBeNull();
    expect((await api('PUT', '/admin/settings', { session: superadmin, body: { ...settings, auctionNotice: 'Abholung nur nach Terminabsprache.' } })).statusCode).toBe(200);
    try {
      expect(json(await api('GET', `/auctions/${auctionIds[2]}`, { session: dealerA })).notice).toBe('Abholung nur nach Terminabsprache.');
    } finally {
      await api('PUT', '/admin/settings', { session: superadmin, body: settings });
    }
  });
});
