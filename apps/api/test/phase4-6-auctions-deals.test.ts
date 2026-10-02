import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/core/db/client';
import { api, approvedDealer, approvedDealership, auditEvents, createPlatformUser, json, type Session } from './helpers';
import { activeAuction, bid, createAuction, crid, drainJobs, endAuctionNow, fixtureApprovedVehicle, tick } from './flows';

let admin: Session;
let ah: Session;
let otherAh: Session;
let d1: Session;
let d2: Session;
let d3: Session;

beforeAll(async () => {
  admin = await createPlatformUser('ADMIN');
  ah = await approvedDealership(admin);
  otherAh = await approvedDealership(admin);
  d1 = await approvedDealer(admin);
  d2 = await approvedDealer(admin);
  d3 = await approvedDealer(admin);
});

describe('Auktion planen & automatisch starten', () => {
  it('nur freigegebene Fahrzeuge; unvollständige Fahrzeuge können nicht in die Auktion', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!, { status: 'WAITING_REVIEW', approvedAt: null });
    const res = await api('POST', '/admin/auctions', {
      session: admin,
      body: { vehicleId: v.id, startsAt: new Date().toISOString(), durationMinutes: 720, startPrice: 500_000, reservePrice: null, reserveVisible: false, bidIncrement: 10_000, taxType: 'DIFFERENZBESTEUERT', antiSnipeMinutes: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('VEHICLE_NOT_READY');
  });

  it('Mindestpreis unter Startpreis wird abgelehnt; ein Fahrzeug nur in einer offenen Auktion', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const bad = await api('POST', '/admin/auctions', {
      session: admin,
      body: { vehicleId: v.id, startsAt: new Date().toISOString(), durationMinutes: 720, startPrice: 500_000, reservePrice: 100_000, reserveVisible: false, bidIncrement: 10_000, taxType: 'REGELBESTEUERT', antiSnipeMinutes: 0 },
    });
    expect(bad.statusCode).toBe(400);
    await createAuction(admin, v.id);
    const second = await api('POST', '/admin/auctions', {
      session: admin,
      body: { vehicleId: v.id, startsAt: new Date().toISOString(), durationMinutes: 720, startPrice: 500_000, reservePrice: null, reserveVisible: false, bidIncrement: 10_000, taxType: 'REGELBESTEUERT', antiSnipeMinutes: 0 },
    });
    expect(second.statusCode).toBe(409);
  });

  it('Scheduler startet geplante Auktionen zur Startzeit; Fahrzeugstatus folgt', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await createAuction(admin, v.id);
    expect((await api('POST', `/admin/auctions/${id}/schedule`, { session: admin })).statusCode).toBe(200);
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('SCHEDULED');
    // Vor Startzeit: kein Start, keine Gebote.
    await tick();
    expect((await db.select().from(schema.auctions).where(eq(schema.auctions.id, id)))[0]!.status).toBe('SCHEDULED');
    expect((await bid(d1, id, 1_000_000)).statusCode).toBe(409);
    await db.update(schema.auctions).set({ startsAt: new Date(Date.now() - 500) }).where(eq(schema.auctions.id, id));
    await tick();
    expect((await db.select().from(schema.auctions).where(eq(schema.auctions.id, id)))[0]!.status).toBe('ACTIVE');
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('IN_AUCTION');
  });

  it('Auktion startet nicht, wenn das Fahrzeug zwischenzeitlich nicht mehr freigegeben ist', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await createAuction(admin, v.id);
    await api('POST', `/admin/auctions/${id}/schedule`, { session: admin });
    await db.update(schema.vehicles).set({ approvedAt: null }).where(eq(schema.vehicles.id, v.id));
    await db.update(schema.auctions).set({ startsAt: new Date(Date.now() - 500) }).where(eq(schema.auctions.id, id));
    await tick();
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    expect(a!.status).toBe('CANCELLED');
    expect(a!.cancelledReason).toContain('nicht freigegeben');
  });
});

describe('Sichtbarkeit für Händler', () => {
  it('Händlergruppen beschränken den Zugriff; Mindestpreis und Bieteridentitäten bleiben verborgen', async () => {
    const group = json(await api('POST', '/admin/dealer-groups', { session: admin, body: { name: `Gruppe ${crid().slice(0, 6)}`, description: null } }));
    await api('PUT', `/admin/dealer-groups/${group.id}/members`, { session: admin, body: { companyIds: [d1.companyId] } });
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { dealerGroupId: group.id, reservePrice: 1_500_000, reserveVisible: false });

    expect((await api('GET', `/auctions/${id}`, { session: d1 })).statusCode).toBe(200);
    expect((await api('GET', `/auctions/${id}`, { session: d2 })).statusCode).toBe(404);
    expect((await bid(d2, id, 1_000_000)).statusCode).toBe(404);
    const list2 = json(await api('GET', '/auctions', { session: d2 }));
    expect(list2.items.some((i: { id: string }) => i.id === id)).toBe(false);

    const detail = json(await api('GET', `/auctions/${id}`, { session: d1 }));
    expect(detail.state.reservePrice).toBeUndefined();
    expect(detail.state.reserveMet).toBeUndefined();
    expect(detail.vehicle.seller).toBeUndefined();
    expect(detail.vehicle.licensePlate).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain(ah.companyId!);
    // Seller-Fees sind für Käufer nicht sichtbar.
    expect(detail.state.sellerFeeFixed).toBeUndefined();
  });

  it('Autohaus sieht eigene Auktion mit Mindestpreis, fremdes Autohaus nicht', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { reservePrice: 1_200_000 });
    const own = json(await api('GET', `/auctions/${id}`, { session: ah }));
    expect(own.state.reservePrice).toBe(1_200_000);
    expect((await api('GET', `/auctions/${id}`, { session: otherAh })).statusCode).toBe(404);
  });
});

describe('Gebotsregeln', () => {
  it('Verbindlichkeitsbestätigung ist Pflicht; Gebote unter Mindestgebot werden abgelehnt', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    const noConfirm = await api('POST', `/auctions/${id}/bids`, { session: d1, body: { amount: 1_000_000, clientRequestId: crid() } });
    expect(noConfirm.statusCode).toBe(400);
    const low = await bid(d1, id, 999_000);
    expect(low.statusCode).toBe(409);
    expect(json(low).error.code).toBe('BID_TOO_LOW');
    expect(json(low).error.details.minNextBid).toBe(1_000_000);
  });

  it('Gebot wird mit Serverzeit, IP, User-Agent und Transaktions-ID gespeichert; Führender kann sich nicht selbst überbieten', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    const r1 = await api('POST', `/auctions/${id}/bids`, { session: d1, body: { amount: 1_000_000, clientRequestId: crid(), confirmBinding: true }, headers: { 'user-agent': 'TestBrowser/1.0' } });
    expect(r1.statusCode).toBe(201);
    expect(json(r1).status).toBe('LEADING');
    const [b] = await db.select().from(schema.bids).where(eq(schema.bids.auctionId, id));
    expect(b).toMatchObject({ companyId: d1.companyId, userId: d1.userId, amount: 1_000_000, status: 'WINNING', sequence: 1, userAgent: 'TestBrowser/1.0' });
    expect(b!.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(b!.ip).toBeTruthy();
    expect(b!.serverTime).toBeInstanceOf(Date);
    const self = await bid(d1, id, 1_100_000);
    expect(json(self).error.code).toBe('ALREADY_LEADING');
    expect(await auditEvents(id)).toContain('BID_PLACED');
  });

  it('Idempotenz: derselbe clientRequestId erzeugt kein zweites Gebot (Doppelklick, mehrere Tabs, Retry)', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    const key = crid();
    const [a, b] = await Promise.all([bid(d1, id, 1_000_000, key), bid(d1, id, 1_000_000, key)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from bids where auction_id = ${id}`)).rows as [{ n: number }];
    expect(n).toBe(1);
  });

  it('Bietagent (Spec-Beispiel): A Maximalgebot 12.000 €, B bietet 10.100 € → A führt mit 10.200 €; Maximum bleibt geheim', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { startPrice: 1_000_000, bidIncrement: 10_000 });
    expect((await bid(d1, id, 1_000_000)).statusCode).toBe(201);
    const max = await api('PUT', `/auctions/${id}/max-bid`, { session: d1, body: { maxAmount: 1_200_000, clientRequestId: crid(), confirmBinding: true } });
    expect(max.statusCode).toBe(200);
    const b = await bid(d2, id, 1_010_000);
    expect(b.statusCode).toBe(201);
    expect(json(b).status).toBe('OUTBID');
    expect(json(b).currentBid).toBe(1_020_000);
    const state = json(await api('GET', `/auctions/${id}/state`, { session: d2 }));
    expect(state.currentBid).toBe(1_020_000);
    expect(state.me.status).toBe('OUTBID');
    expect(JSON.stringify(state)).not.toContain('1200000');
    const history = json(await api('GET', `/auctions/${id}/bids`, { session: d2 }));
    expect(JSON.stringify(history)).not.toContain(d1.companyId!);
    expect(history[0]).toMatchObject({ amount: 1_020_000, kind: 'PROXY', mine: false });
    // d2 überbietet das Maximum → d2 führt.
    const c = await bid(d2, id, 1_250_000);
    expect(json(c).status).toBe('LEADING');
    expect(json(c).currentBid).toBe(1_250_000);
    const s1 = json(await api('GET', `/auctions/${id}/state`, { session: d1 }));
    expect(s1.me.status).toBe('OUTBID');
    expect(s1.me.maxBidExhausted).toBe(true);
    // d1 wurde benachrichtigt.
    const notes = json(await api('GET', '/notifications', { session: d1 }));
    expect(notes.items.some((n: { type: string }) => n.type === 'OUTBID')).toBe(true);
  });

  it('Anti-Sniping verlängert die Auktion bei Geboten in den letzten Minuten', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { antiSnipeMinutes: 2 });
    const endsAt = new Date(Date.now() + 60_000);
    await db.update(schema.auctions).set({ endsAt }).where(eq(schema.auctions.id, id));
    const r = await bid(d1, id, 1_000_000);
    expect(json(r).extended).toBe(true);
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    expect(a!.endsAt.getTime()).toBe(endsAt.getTime() + 120_000);
    expect(a!.extensionCount).toBe(1);
  });

  it('Gebot nach Ablauf der Endzeit wird abgelehnt, auch bevor der Scheduler beendet hat', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await db.update(schema.auctions).set({ endsAt: new Date(Date.now() - 10) }).where(eq(schema.auctions.id, id));
    const r = await bid(d1, id, 1_000_000);
    expect(r.statusCode).toBe(409);
    expect(json(r).error.code).toBe('AUCTION_ENDED');
  });

  it('Händler, der während der Auktion gesperrt wird, kann nicht mehr bieten; sein Bietagent stoppt', async () => {
    const dealer = await approvedDealer(admin);
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await bid(dealer, id, 1_000_000);
    await api('PUT', `/auctions/${id}/max-bid`, { session: dealer, body: { maxAmount: 2_000_000, clientRequestId: crid(), confirmBinding: true } });
    await api('POST', `/admin/companies/${dealer.companyId}/bidding-status`, { session: admin, body: { status: 'BLOCKED', note: 'Zahlungsausfall' } });
    const after = await bid(dealer, id, 3_000_000);
    expect(after.statusCode).toBe(403);
    // Bietagent greift nicht mehr: d2 übernimmt zum Mindestschritt.
    const r = await bid(d2, id, 1_010_000);
    expect(json(r).status).toBe('LEADING');
    expect(json(r).currentBid).toBe(1_010_000);
  });

  it('neue Bieterbedingungen müssen vor dem nächsten Gebot akzeptiert werden', async () => {
    const dealer = await approvedDealer(admin);
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await api('POST', '/admin/legal', { session: admin, body: { kind: 'BIDDER_TERMS', version: `0.3-${crid().slice(0, 8)}`, title: 'Bieterbedingungen (Vorlage 0.3)', content: '[VORLAGE]' } });
    const blocked = await bid(dealer, id, 1_000_000);
    expect(blocked.statusCode).toBe(403);
    expect(json(blocked).error.code).toBe('BIDDER_TERMS_REQUIRED');
    const pending = json(await api('GET', '/auth/me', { session: dealer })).pendingLegal;
    await api('POST', '/auth/accept-legal', { session: dealer, body: { legalDocumentIds: pending.map((p: { id: string }) => p.id) } });
    expect((await bid(dealer, id, 1_000_000)).statusCode).toBe(201);
    // Andere Händler müssen ebenfalls zustimmen.
    for (const s of [d1, d2, d3]) {
      const p = json(await api('GET', '/auth/me', { session: s })).pendingLegal;
      if (p.length) await api('POST', '/auth/accept-legal', { session: s, body: { legalDocumentIds: p.map((x: { id: string }) => x.id) } });
    }
  });
});

describe('Auktionsende, Zuschlag, Deal, PDFs', () => {
  it('Reserve erreicht → genau ein Deal, unveränderliche Zuschlagsdaten, drei PDFs, korrekte Dokumentrechte', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { reservePrice: 1_050_000, taxType: 'REGELBESTEUERT' });
    await bid(d1, id, 1_000_000);
    await bid(d2, id, 1_060_000);
    await endAuctionNow(id);
    await tick(); // zweiter Takt darf nichts doppelt erzeugen
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    expect(a!.status).toBe('ENDED');
    expect(a!.outcome).toBe('SOLD');
    const deals = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    expect(deals).toHaveLength(1);
    const deal = deals[0]!;
    expect(deal.buyerCompanyId).toBe(d2.companyId);
    expect(deal.salePrice).toBe(1_060_000);
    expect(deal.vehicleVat).toBe(201_400);
    expect(deal.dealNumber).toMatch(/^D-\d{4}-\d{6}$/);
    expect(deal.vinSnapshot).toBe(v.vin);
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('SOLD');
    // Unveränderlich auf DB-Ebene
    await expect(db.execute(sql`update deals set sale_price = 1 where id = ${deal.id}`)).rejects.toBeTruthy();
    await expect(db.execute(sql`delete from deals where id = ${deal.id}`)).rejects.toBeTruthy();

    // Dritter Händler ohne Gebot sieht die beendete Auktion nicht.
    expect((await api('GET', `/auctions/${id}`, { session: d3 })).statusCode).toBe(404);
    // Verlierer sieht "verloren", Gewinner "gewonnen".
    expect(json(await api('GET', `/auctions/${id}/state`, { session: d1 })).me.status).toBe('LOST');
    expect(json(await api('GET', `/auctions/${id}/state`, { session: d2 })).me.status).toBe('WON');
    const won = json(await api('GET', '/me/auctions?state=won', { session: d2 }));
    expect(won.items.some((i: { id: string }) => i.id === id)).toBe(true);

    // PDFs
    await drainJobs();
    const docs = await db.select().from(schema.generatedDocuments).where(eq(schema.generatedDocuments.dealId, deal.id));
    expect(docs.map((d) => d.kind).sort()).toEqual(['BUYER', 'INTERNAL', 'SELLER']);
    expect(docs.every((d) => d.version === 1 && d.sha256.length === 64)).toBe(true);
    const [after] = await db.select().from(schema.deals).where(eq(schema.deals.id, deal.id));
    expect(after!.status).toBe('PAYMENT_PENDING');

    const buyerView = json(await api('GET', `/deals/${deal.id}`, { session: d2 }));
    expect(buyerView.documents.map((d: { kind: string }) => d.kind)).toEqual(['BUYER']);
    expect(buyerView.deal.sellerFeeNet).toBeUndefined();
    expect(buyerView.pickup.pickupCode).toMatch(/^[A-Z2-9]{8}$/);
    const sellerView = json(await api('GET', `/deals/${deal.id}`, { session: ah }));
    expect(sellerView.documents.map((d: { kind: string }) => d.kind)).toEqual(['SELLER']);
    expect(sellerView.pickup.pickupCode).toBeUndefined();
    expect(sellerView.deal.buyerFeeNet).toBeUndefined();

    const internal = docs.find((d) => d.kind === 'INTERNAL')!;
    const buyerDoc = docs.find((d) => d.kind === 'BUYER')!;
    expect((await api('GET', `/documents/${internal.id}/file`, { session: d2 })).statusCode).toBe(404);
    expect((await api('GET', `/documents/${buyerDoc.id}/file`, { session: ah })).statusCode).toBe(404);
    expect((await api('GET', `/documents/${buyerDoc.id}/file`, { session: d1 })).statusCode).toBe(404);
    expect((await api('GET', `/documents/${buyerDoc.id}/file`, { session: d2 })).statusCode).toBe(302);
    expect((await api('GET', `/deals/${deal.id}`, { session: d1 })).statusCode).toBe(404);
    expect((await api('GET', `/deals/${deal.id}`, { session: otherAh })).statusCode).toBe(404);

    // PDF ist ein echtes PDF
    const signed = String((await api('GET', `/documents/${buyerDoc.id}/file`, { session: d2 })).headers.location);
    const pdf = Buffer.from(await (await fetch(signed)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    expect(await auditEvents(id)).toEqual(expect.arrayContaining(['AUCTION_ENDED', 'BID_PLACED']));
    expect(await auditEvents(deal.id)).toEqual(expect.arrayContaining(['DEAL_CREATED', 'PDF_GENERATED', 'DEAL_STATUS_CHANGED']));
  });

  it('Mindestpreis nicht erreicht → kein Deal; Admin erteilt nach Rücksprache Zuschlag zum Höchstgebot', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { reservePrice: 2_000_000 });
    await bid(d1, id, 1_500_000);
    await endAuctionNow(id);
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    expect(a!.outcome).toBe('RESERVE_NOT_MET');
    expect(await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id))).toHaveLength(0);
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('UNSOLD');
    expect(json(await api('GET', `/auctions/${id}/state`, { session: d1 })).me.status).toBe('RESERVE_NOT_MET');
    const res = await api('POST', `/admin/auctions/${id}/accept-highest`, { session: admin, body: { note: 'Verkäufer telefonisch einverstanden' } });
    expect(res.statusCode).toBe(200);
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    expect(deal!.origin).toBe('MANUAL_ACCEPT');
    expect(deal!.salePrice).toBe(1_500_000);
    expect((await api('POST', `/admin/auctions/${id}/accept-highest`, { session: admin, body: { note: 'nochmal' } })).statusCode).toBe(409);
  });

  it('keine Gebote → nicht verkauft, erneut einstellen möglich', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await endAuctionNow(id);
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    expect(a!.outcome).toBe('NO_BIDS');
    const relist = await api('POST', `/admin/auctions/${id}/relist`, { session: admin, body: { startsAt: new Date(Date.now() + 3600_000).toISOString(), startPrice: 800_000, reservePrice: null } });
    expect(relist.statusCode).toBe(201);
    expect((await api('POST', `/admin/auctions/${json(relist).id}/schedule`, { session: admin })).statusCode).toBe(200);
  });

  it('Sofortkauf beendet die Auktion sofort mit Deal', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id, { buyNowPrice: 1_800_000 });
    await bid(d1, id, 1_000_000);
    const r = await api('POST', `/auctions/${id}/buy-now`, { session: d3, body: { clientRequestId: crid(), confirmBinding: true } });
    expect(r.statusCode).toBe(200);
    expect(json(r).status).toBe('WON');
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    expect(a!.status).toBe('ENDED');
    expect(a!.outcome).toBe('BUY_NOW');
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    expect(deal!.buyerCompanyId).toBe(d3.companyId);
    expect(deal!.salePrice).toBe(1_800_000);
  });

  it('Admin stoppt laufende Auktion (ohne Zuschlag) und ändert Endzeiten live', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await bid(d1, id, 1_000_000);
    const tooSoon = await api('POST', `/admin/auctions/${id}/end-time`, { session: admin, body: { endsAt: new Date(Date.now() + 10_000).toISOString(), reason: 'Test' } });
    expect(tooSoon.statusCode).toBe(400);
    const newEnd = new Date(Date.now() + 2 * 86400_000).toISOString();
    expect((await api('POST', `/admin/auctions/${id}/end-time`, { session: admin, body: { endsAt: newEnd, reason: 'Feiertag' } })).statusCode).toBe(200);
    expect(json(await api('GET', `/auctions/${id}/state`, { session: d1 })).endsAt).toBe(newEnd);
    const cancel = await api('POST', `/admin/auctions/${id}/cancel`, { session: admin, body: { reason: 'Fahrzeug beschädigt' } });
    expect(cancel.statusCode).toBe(200);
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('APPROVED');
    expect((await bid(d2, id, 1_010_000)).statusCode).not.toBe(201);
  });

  it('beendete Auktion mit Zuschlag kann nicht gestoppt werden', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await bid(d1, id, 1_000_000);
    await endAuctionNow(id);
    const res = await api('POST', `/admin/auctions/${id}/cancel`, { session: admin, body: { reason: 'zu spät' } });
    expect(res.statusCode).toBe(409);
  });
});

describe('Abwicklung & Abholung', () => {
  it('Statuskette bis ABGESCHLOSSEN mit Abholcode-Prüfung; Stornierung erzeugt neue PDF-Version', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await bid(d1, id, 1_000_000);
    await endAuctionNow(id);
    await drainJobs();
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    const dealId = deal!.id;

    // Abholbereit erst mit vollständigen Abholinfos.
    expect((await api('POST', `/admin/deals/${dealId}/status`, { session: admin, body: { status: 'PAID' } })).statusCode).toBe(200);
    expect((await api('POST', `/deals/${dealId}/ready-for-pickup`, { session: ah })).statusCode).toBe(409);
    expect((await api('PUT', `/deals/${dealId}/pickup`, { session: d1, body: { locationStreet: 'x', locationZip: '30159', locationCity: 'H', contactName: 'X', contactPhone: '+49 1', openingHours: 'x' } })).statusCode).toBe(403);
    const info = await api('PUT', `/deals/${dealId}/pickup`, {
      session: ah,
      body: { locationStreet: 'Hauptstraße 1', locationZip: '30159', locationCity: 'Hannover', contactName: 'Herr Ahrens', contactPhone: '+49 511 123456', openingHours: 'Mo–Fr 8–18 Uhr' },
    });
    expect(info.statusCode).toBe(200);
    expect((await api('POST', `/deals/${dealId}/ready-for-pickup`, { session: ah })).statusCode).toBe(200);
    const buyerView = json(await api('GET', `/deals/${dealId}`, { session: d1 }));
    expect(buyerView.deal.status).toBe('READY_FOR_PICKUP');
    const code = buyerView.pickup.pickupCode as string;

    expect((await api('POST', `/deals/${dealId}/pickup/schedule`, { session: d1, body: { scheduledAt: new Date(Date.now() + 86400_000).toISOString() } })).statusCode).toBe(200);
    const wrong = await api('POST', `/deals/${dealId}/pickup/handed-over`, { session: ah, body: { pickupCode: 'FALSCH12' } });
    expect(wrong.statusCode).toBe(400);
    expect((await api('POST', `/deals/${dealId}/pickup/handed-over`, { session: ah, body: { pickupCode: code } })).statusCode).toBe(200);
    expect((await api('POST', `/deals/${dealId}/pickup/taken-over`, { session: ah, body: {} })).statusCode).toBe(403);
    expect((await api('POST', `/deals/${dealId}/pickup/taken-over`, { session: d1, body: {} })).statusCode).toBe(200);
    let view = json(await api('GET', `/deals/${dealId}`, { session: admin }));
    expect(view.deal.status).toBe('PICKED_UP');
    expect(view.pickup.handedOverAt).toBeTruthy();
    expect(view.pickup.takenOverAt).toBeTruthy();
    expect((await api('POST', `/admin/deals/${dealId}/status`, { session: admin, body: { status: 'COMPLETED' } })).statusCode).toBe(200);
    view = json(await api('GET', `/deals/${dealId}`, { session: admin }));
    expect(view.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['CREATED', 'PAYMENT_PENDING', 'PAID', 'READY_FOR_PICKUP', 'PICKUP_SCHEDULED', 'PICKED_UP', 'COMPLETED']);
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('COMPLETED');
    expect(await auditEvents(dealId)).toContain('PICKUP_CONFIRMED');
  });

  it('Reklamation setzt den Deal auf REKLAMATION; Lösung stellt den vorherigen Status wieder her', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await bid(d2, id, 1_000_000);
    await endAuctionNow(id);
    await drainJobs();
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    const c = await api('POST', `/deals/${deal!.id}/complaints`, { session: d2, body: { reason: 'Kilometerstand abweichend', description: 'Tacho zeigt 2.000 km mehr als angegeben.' } });
    expect(c.statusCode).toBe(201);
    expect((await db.select().from(schema.deals).where(eq(schema.deals.id, deal!.id)))[0]!.status).toBe('DISPUTED');
    const r = await api('POST', `/admin/complaints/${json(c).id}/resolve`, { session: admin, body: { status: 'RESOLVED', resolution: 'Preisnachlass vereinbart' } });
    expect(r.statusCode).toBe(200);
    expect((await db.select().from(schema.deals).where(eq(schema.deals.id, deal!.id)))[0]!.status).toBe('PAYMENT_PENDING');
  });

  it('Neuerzeugung von PDFs legt neue Versionen an und behält alte', async () => {
    const v = await fixtureApprovedVehicle(ah.companyId!);
    const id = await activeAuction(admin, v.id);
    await bid(d3, id, 1_000_000);
    await endAuctionNow(id);
    await drainJobs();
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    await api('POST', `/admin/deals/${deal!.id}/documents/regenerate`, { session: admin, body: { reason: 'Abholadresse korrigiert' } });
    await drainJobs();
    const docs = await db.select().from(schema.generatedDocuments).where(eq(schema.generatedDocuments.dealId, deal!.id));
    expect(docs).toHaveLength(6);
    expect(new Set(docs.map((d) => d.version))).toEqual(new Set([1, 2]));
    await expect(db.execute(sql`delete from generated_documents where deal_id = ${deal!.id}`)).rejects.toBeTruthy();
    const cancel = await api('POST', `/admin/deals/${deal!.id}/status`, { session: admin, body: { status: 'CANCELLED', note: 'Käufer zahlt nicht' } });
    expect(cancel.statusCode).toBe(200);
    await drainJobs();
    const all = await db.select().from(schema.generatedDocuments).where(eq(schema.generatedDocuments.dealId, deal!.id));
    expect(all).toHaveLength(9);
    expect((await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)))[0]!.status).toBe('UNSOLD');
  });
});
