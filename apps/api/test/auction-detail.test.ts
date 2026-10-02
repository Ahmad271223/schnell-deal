import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '../src/core/db/client';
import { activeAuction, fixtureApprovedVehicle } from './flows';
import { api, approvedDealer, approvedDealership, createPlatformUser, json, type Session } from './helpers';

/** Händleransicht einer Auktion: Katalog-Navigation, Kontakt, neue Fahrzeugfelder und Vertraulichkeit des Verkäufers. */
describe('Auktionsdetail für Händler', () => {
  let superadmin: Session;
  let dealership: Session & { companyId: string };
  let dealerA: Session & { companyId: string };
  let dealerB: Session & { companyId: string };
  let catalogId: string;
  const auctionIds: string[] = [];

  beforeAll(async () => {
    superadmin = await createPlatformUser('SUPERADMIN');
    dealership = await approvedDealership(superadmin);
    dealerA = await approvedDealer(superadmin);
    dealerB = await approvedDealer(superadmin);

    // Katalog mit drei Fahrzeugen; das mittlere ist auf eine Händlergruppe beschränkt, in der nur Händler A ist.
    const catalog = json(await api('POST', '/admin/catalogs', { session: superadmin, body: { name: 'Hannover Auktion', startsAt: new Date(Date.now() + 86_400_000).toISOString() } }));
    catalogId = catalog.id;
    const group = json(await api('POST', '/admin/dealer-groups', { session: superadmin, body: { name: 'Nur Händler A' } }));
    expect((await api('PUT', `/admin/dealer-groups/${group.id}/members`, { session: superadmin, body: { companyIds: [dealerA.companyId] } })).statusCode).toBe(200);

    const vehicles = [];
    for (let i = 0; i < 3; i++) vehicles.push(await fixtureApprovedVehicle(dealership.companyId, { emissionClass: 'EURO_6D', holderType: 'COMMERCIAL', licensePlate: 'H-SD 123' }));
    expect((await api('PUT', `/admin/catalogs/${catalogId}/vehicles`, { session: superadmin, body: { vehicleIds: vehicles.map((v) => v.id) } })).statusCode).toBe(200);
    for (const [i, v] of vehicles.entries()) auctionIds.push(await activeAuction(superadmin, v.id, { catalogId, ...(i === 1 ? { dealerGroupId: group.id } : {}) }));
  });

  it('liefert Position und Nachbarn im Katalog nur aus den für den Händler sichtbaren Auktionen', async () => {
    const a = json(await api('GET', `/auctions/${auctionIds[1]}`, { session: dealerA }));
    expect(a.catalog).toMatchObject({ id: catalogId, name: 'Hannover Auktion', position: 2, total: 3, prevAuctionId: auctionIds[0], nextAuctionId: auctionIds[2] });
    expect(a.catalog.startsAt).toEqual(expect.any(String));

    const b = json(await api('GET', `/auctions/${auctionIds[2]}`, { session: dealerB }));
    expect(b.catalog).toMatchObject({ position: 2, total: 2, prevAuctionId: auctionIds[0], nextAuctionId: null });
    // Die gruppenbeschränkte Auktion ist für Händler B auch direkt nicht abrufbar.
    expect((await api('GET', `/auctions/${auctionIds[1]}`, { session: dealerB })).statusCode).toBe(404);
  });

  it('zeigt die neuen Fahrzeugfelder, verbirgt Verkäufer und Kennzeichen und nennt nur den gepflegten Plattformkontakt', async () => {
    const res = json(await api('GET', `/auctions/${auctionIds[0]}`, { session: dealerA }));
    expect(res.vehicle).toMatchObject({ emissionClass: 'EURO_6D', holderType: 'COMMERCIAL' });
    expect(res.vehicle.seller).toBeUndefined();
    expect(res.vehicle.licensePlate).toBeUndefined();
    expect(res.vehicle.location.street).toBeUndefined();
    expect(res.contact).toEqual({ name: expect.any(String), email: null, phone: null });

    const settings = json(await api('GET', '/admin/settings', { session: superadmin }));
    const invalid = await api('PUT', '/admin/settings', { session: superadmin, body: { ...settings, supportEmail: 'keine-adresse' } });
    expect(invalid.statusCode).toBe(400);
    const put = await api('PUT', '/admin/settings', { session: superadmin, body: { ...settings, supportEmail: 'support@plattform.test', supportPhone: '+49 511 1234567' } });
    expect(put.statusCode).toBe(200);
    try {
      const again = json(await api('GET', `/auctions/${auctionIds[0]}`, { session: dealerA }));
      expect(again.contact).toMatchObject({ email: 'support@plattform.test', phone: '+49 511 1234567' });
    } finally {
      await api('PUT', '/admin/settings', { session: superadmin, body: settings });
    }
  });

  it('filtert die Auktionsliste nach Katalog und nennt den Katalog nur bei sichtbaren Auktionen', async () => {
    const listA = json(await api('GET', `/auctions?catalogId=${catalogId}`, { session: dealerA }));
    expect(listA.items.map((i: { id: string }) => i.id).sort()).toEqual([...auctionIds].sort());
    expect(listA.catalog).toMatchObject({ id: catalogId, name: 'Hannover Auktion' });

    const listB = json(await api('GET', `/auctions?catalogId=${catalogId}`, { session: dealerB }));
    expect(listB.items).toHaveLength(2);

    // Ein Katalog ohne für den Händler sichtbare Auktionen verrät keinen Namen.
    const hidden = json(await api('POST', '/admin/catalogs', { session: superadmin, body: { name: 'Interner Gruppenkatalog' } }));
    const listHidden = json(await api('GET', `/auctions?catalogId=${hidden.id}`, { session: dealerB }));
    expect(listHidden.items).toEqual([]);
    expect(listHidden.catalog).toBeNull();
    expect((await api('GET', '/auctions?catalogId=kein-uuid', { session: dealerB })).statusCode).toBe(400);
  });

  it('übernimmt Schadstoffklasse und Haltertyp nachvollziehbar per Korrektur und lehnt unbekannte Werte ab', async () => {
    const v = await fixtureApprovedVehicle(dealership.companyId);
    const bad = await api('POST', `/admin/vehicles/${v.id}/correct`, { session: superadmin, body: { reason: 'Test', changes: { emissionClass: 'EURO_9' } } });
    expect(bad.statusCode).toBe(400);
    const ok = await api('POST', `/admin/vehicles/${v.id}/correct`, { session: superadmin, body: { reason: 'Laut Zulassungsbescheinigung', changes: { emissionClass: 'EURO_6E', holderType: 'PRIVATE' } } });
    expect(ok.statusCode).toBe(200);
    const [row] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id));
    expect(row).toMatchObject({ emissionClass: 'EURO_6E', holderType: 'PRIVATE' });
    const revisions = await db.select().from(schema.vehicleRevisions).where(eq(schema.vehicleRevisions.vehicleId, v.id));
    expect(revisions.map((r) => r.field).sort()).toEqual(['emissionClass', 'holderType']);
  });
});
