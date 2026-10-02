import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { REQUIRED_PHOTO_SLOTS, PAINT_POINTS, FEATURES, TIRE_POSITIONS } from '@sd/shared';
import { db, schema } from '../src/core/db/client';
import { createWorker } from '../src/jobs/handlers';
import { AuctionScheduler } from '../src/modules/auctions/scheduler';
import { api, json, PDF_BYTES, sharpJpeg, upload, type Session } from './helpers';

const worker = createWorker();
const scheduler = new AuctionScheduler();

/** Verarbeitet alle fälligen Hintergrundjobs (Bilder, PDFs, E-Mails) synchron. */
export async function drainJobs(): Promise<number> {
  return worker.drain();
}

/** Ein Takt des Auktions-Schedulers (Start/Ende). */
export async function tick() {
  // Ein noch laufender Takt aus einem früheren Test würde sonst still übersprungen (Auktion bliebe SCHEDULED).
  if (scheduler.isTicking()) throw new Error('Auktionstakt eines früheren Tests läuft noch – hängende Datenbankverbindung?');
  return scheduler.tick();
}

const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
export function randomVin(): string {
  const bytes = crypto.randomBytes(11);
  let s = 'WVWZZZ';
  for (let i = 0; i < 11; i++) s += VIN_CHARS[bytes[i]! % VIN_CHARS.length];
  return s;
}

/** Fixture: freigegebenes Fahrzeug direkt in der DB (für Auktions-, Last- und Concurrency-Tests). */
export async function fixtureApprovedVehicle(companyId: string, overrides: Partial<typeof schema.vehicles.$inferInsert> = {}) {
  const [{ n }] = (await db.execute<{ n: string }>(sql`select nextval('vehicle_number_seq')::text as n`)).rows as [{ n: string }];
  const [v] = await db
    .insert(schema.vehicles)
    .values({
      internalNumber: `FZ-${n.padStart(6, '0')}`,
      companyId,
      vin: randomVin(),
      vinCheck: 'UNVERIFIED',
      make: 'Volkswagen',
      model: 'Golf',
      variant: '1.5 TSI Life',
      firstRegistration: '2021-03-15',
      mileageKm: 48_500,
      fuel: 'PETROL',
      powerKw: 110,
      transmission: 'MANUAL',
      body: 'HATCHBACK',
      color: 'Grau',
      status: 'APPROVED',
      approvedAt: new Date(),
      inspectionStartedAt: new Date(Date.now() - 3600_000),
      inspectionCompletedAt: new Date(Date.now() - 1800_000),
      completenessPct: 100,
      locationStreet: 'Hauptstraße 1',
      locationZip: '30159',
      locationCity: 'Hannover',
      lat: 52.37,
      lng: 9.73,
      ...overrides,
    })
    .returning();
  return v!;
}

export async function createAuction(admin: Session, vehicleId: string, overrides: Record<string, unknown> = {}) {
  const res = await api('POST', '/admin/auctions', {
    session: admin,
    body: {
      vehicleId,
      startsAt: new Date(Date.now() + 60_000).toISOString(),
      durationMinutes: 60 * 24,
      startPrice: 1_000_000,
      reservePrice: null,
      reserveVisible: false,
      bidIncrement: 10_000,
      buyNowPrice: null,
      taxType: 'DIFFERENZBESTEUERT',
      antiSnipeMinutes: 2,
      ...overrides,
    },
  });
  if (res.statusCode !== 201) throw new Error(`Auktion anlegen fehlgeschlagen: ${res.body}`);
  return json<{ id: string; number: string }>(res).id;
}

/** Auktion anlegen, einplanen und per Scheduler-Takt starten. */
export async function activeAuction(admin: Session, vehicleId: string, overrides: Record<string, unknown> = {}) {
  const id = await createAuction(admin, vehicleId, overrides);
  const s = await api('POST', `/admin/auctions/${id}/schedule`, { session: admin });
  if (s.statusCode !== 200) throw new Error(`Einplanen fehlgeschlagen: ${s.body}`);
  await db.update(schema.auctions).set({ startsAt: new Date(Date.now() - 1000) }).where(eq(schema.auctions.id, id));
  await tick();
  const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
  if (a?.status !== 'ACTIVE') throw new Error(`Auktion nicht gestartet: ${a?.status}`);
  return id;
}

/** Simuliert den Ablauf der Zeit: Endzeit in die Vergangenheit setzen und Scheduler ticken lassen. */
export async function endAuctionNow(id: string) {
  await db.update(schema.auctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.auctions.id, id));
  await tick();
}

export function crid(): string {
  return crypto.randomUUID();
}

export async function bid(session: Session, auctionId: string, amount: number, clientRequestId = crid()) {
  return api('POST', `/auctions/${auctionId}/bids`, { session, body: { amount, clientRequestId, confirmBinding: true } });
}

/** Vollständiger Aufnahmeauftrag: Autohaus meldet → Admin plant → Außendienst startet die Aufnahme. */
export async function startedInspection(admin: Session, dealership: Session, inspector: Session, vehicleCount = 1) {
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const r = await api('POST', '/inspection-requests', {
    session: dealership,
    body: {
      vehicleCount,
      locationStreet: 'Hauptstraße 1',
      locationZip: '30159',
      locationCity: 'Hannover',
      requestedDate: tomorrow,
      earliestTime: '09:00',
      latestTime: '15:00',
      contactName: 'Herr Ahrens',
      contactPhone: '+49 511 123456',
      notes: 'Fahrzeuge stehen auf dem Hof',
      vehiclesDrivable: true,
      keysAvailable: true,
      papersAvailable: true,
    },
  });
  if (r.statusCode !== 201) throw new Error(`Anfrage fehlgeschlagen: ${r.body}`);
  const requestId = json(r).id as string;
  const assign = await api('POST', `/admin/inspection-requests/${requestId}/assign`, {
    session: admin,
    body: { inspectorUserId: inspector.userId, scheduledAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  if (assign.statusCode !== 200) throw new Error(`Zuweisung fehlgeschlagen: ${assign.body}`);
  for (const status of ['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS']) {
    const s = await api('POST', `/inspector/requests/${requestId}/status`, { session: inspector, body: { status } });
    if (s.statusCode !== 200) throw new Error(`Status ${status} fehlgeschlagen: ${s.body}`);
  }
  return requestId;
}

/** Erfasst eine komplette Fahrzeugakte über die API und schließt die Aufnahme ab. */
export async function inspectFullVehicle(inspector: Session, requestId: string, opts: { complete?: boolean } = {}) {
  const created = await api('POST', `/inspector/requests/${requestId}/vehicles`, { session: inspector, body: {} });
  if (created.statusCode !== 201) throw new Error(`Fahrzeug anlegen fehlgeschlagen: ${created.body}`);
  const vehicleId = json(created).id as string;
  const vin = await api('POST', `/vehicles/${vehicleId}/vin`, { session: inspector, body: { vin: randomVin() } });
  if (vin.statusCode !== 200) throw new Error(`VIN fehlgeschlagen: ${vin.body}`);
  const data = await api('PATCH', `/vehicles/${vehicleId}`, {
    session: inspector,
    body: {
      make: 'BMW',
      model: '320d',
      variant: 'Touring',
      firstRegistration: '2020-06-01',
      mileageKm: 87_300,
      fuel: 'DIESEL',
      powerKw: 140,
      transmission: 'AUTOMATIC',
      body: 'ESTATE',
      color: 'Schwarz',
      doors: 5,
      seats: 5,
      ownersCount: 1,
      huUntil: '2027-05',
      keysCount: 2,
      equipment: ['Navigation', 'Sitzheizung'],
    },
  });
  if (data.statusCode !== 200) throw new Error(`Stammdaten fehlgeschlagen: ${data.body}`);
  let seed = Math.floor(Math.random() * 1e6);
  for (const slot of REQUIRED_PHOTO_SLOTS) {
    const img = await sharpJpeg(640, 480, seed++);
    const res = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot, clientUploadId: crid() }, { name: `${slot}.jpg`, content: img, type: 'image/jpeg' });
    if (res.statusCode !== 201) throw new Error(`Foto ${slot} fehlgeschlagen: ${res.body}`);
  }
  await upload(`/vehicles/${vehicleId}/documents`, inspector, { kind: 'REGISTRATION_1', clientUploadId: crid() }, { name: 'zb1.pdf', content: PDF_BYTES, type: 'application/pdf' });
  await api('PUT', `/vehicles/${vehicleId}/paint`, { session: inspector, body: { measurements: PAINT_POINTS.map((point) => ({ point, valueUm: 110 })) } });
  await api('PUT', `/vehicles/${vehicleId}/tires`, {
    session: inspector,
    body: { tires: TIRE_POSITIONS.map((position) => ({ position, brand: 'Michelin', dimension: '225/45 R17', season: 'SUMMER', treadMm: 5.5, damage: null, dot: '2321', rimCondition: 'gut' })) },
  });
  await api('PUT', `/vehicles/${vehicleId}/features`, { session: inspector, body: { features: FEATURES.map((feature) => ({ feature, result: 'OK', note: null })) } });
  if (opts.complete !== false) {
    const done = await api('POST', `/vehicles/${vehicleId}/complete`, { session: inspector });
    if (done.statusCode !== 200) throw new Error(`Abschluss fehlgeschlagen: ${done.body}`);
  }
  return vehicleId;
}
