import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '../core/db/client';

/**
 * Demo-Auktionen (nur Entwicklung/Staging): legt freigegebene Fahrzeuge, einen veröffentlichten
 * Katalog und laufende Auktionen an, damit Katalog, Dashboard und Live-Bieten befüllt sind.
 * Idempotent über die Auktionsnummer. Gebote werden bewusst NICHT hier erzeugt – sie entstehen
 * über die echte Gebots-API (siehe scripts/demo-bids). Fahrzeugfotos bleiben leer (Platzhalter).
 *
 *   pnpm --filter @sd/api exec tsx src/scripts/seed-demo-auctions.ts
 */

const EUR = (euro: number) => Math.round(euro * 100);
const MIN = 60 * 1000;
const H = 60 * MIN;

interface Demo {
  nr: string;
  make: string;
  model: string;
  variant: string;
  reg: string; // YYYY-MM-DD
  km: number;
  fuel: (typeof schema.vehicles.fuel._.data) | string;
  powerKw: number;
  transmission: string;
  body: string;
  color: string;
  doors: number;
  seats: number;
  owners: number;
  huUntil: string;
  emission: string;
  startEuro: number;
  incrementEuro: number;
  reserveEuro: number | null;
  buyNowEuro: number | null;
  tax: 'REGELBESTEUERT' | 'DIFFERENZBESTEUERT';
  endsInMs: number;
  city: string;
  zip: string;
  equipment: string[];
}

const DEMOS: Demo[] = [
  {
    nr: '100459', make: 'BMW', model: '3er 330e Touring', variant: 'M-Sport', reg: '2022-05-01', km: 38000, fuel: 'HYBRID_PETROL', powerKw: 215, transmission: 'AUTOMATIC', body: 'ESTATE', color: 'Saphirschwarz Metallic', doors: 5, seats: 5, owners: 1, huUntil: '2027-06', emission: 'EURO_6', startEuro: 28000, incrementEuro: 500, reserveEuro: 29000, buyNowEuro: 39500, tax: 'REGELBESTEUERT', endsInMs: 13 * MIN, city: 'Hannover', zip: '30159',
    equipment: ['M-Sportpaket', 'LED-Scheinwerfer', 'Navigationssystem Professional', 'Head-Up Display', 'Sitzheizung vorne', 'Harman Kardon Soundsystem', 'Rückfahrkamera', 'Parksensoren vorne & hinten', 'Keyless Go', 'Elektr. Heckklappe', 'Panorama-Glasdach', 'Adaptive Cruise Control', 'Sportsitze', '3-Zonen Klimaautomatik', '19" M Leichtmetallfelgen', 'Ambientebeleuchtung'],
  },
  {
    nr: '100460', make: 'Audi', model: 'A6 Avant 50 TDI', variant: 'quattro S line', reg: '2021-03-01', km: 74000, fuel: 'DIESEL', powerKw: 210, transmission: 'AUTOMATIC', body: 'ESTATE', color: 'Daytonagrau', doors: 5, seats: 5, owners: 1, huUntil: '2026-09', emission: 'EURO_6', startEuro: 24800, incrementEuro: 500, reserveEuro: 25800, buyNowEuro: 34900, tax: 'REGELBESTEUERT', endsInMs: 2 * H + 15 * MIN, city: 'Hannover', zip: '30159',
    equipment: ['S line Sportpaket', 'Matrix-LED', 'Virtual Cockpit', 'MMI Navigation plus', 'Leder Valcona', 'Standheizung', '360° Kamera', 'ACC', 'Luftfederung', 'Anhängerkupplung'],
  },
  {
    nr: '100461', make: 'Mercedes-Benz', model: 'GLC 300 de', variant: '4MATIC AMG Line', reg: '2021-06-01', km: 52000, fuel: 'HYBRID_DIESEL', powerKw: 143, transmission: 'AUTOMATIC', body: 'SUV', color: 'Obsidianschwarz', doors: 5, seats: 5, owners: 1, huUntil: '2026-07', emission: 'EURO_6', startEuro: 37800, incrementEuro: 500, reserveEuro: null, buyNowEuro: 46900, tax: 'REGELBESTEUERT', endsInMs: 58 * MIN, city: 'Laatzen', zip: '30880',
    equipment: ['AMG Line', 'MBUX', 'Burmester Sound', 'Panoramadach', 'Distronic', 'Memory-Paket', 'Keyless-Go', 'LED High Performance'],
  },
  {
    nr: '100462', make: 'VW', model: 'Passat Variant 2.0 TDI', variant: 'Elegance DSG', reg: '2020-04-01', km: 56000, fuel: 'DIESEL', powerKw: 110, transmission: 'AUTOMATIC', body: 'ESTATE', color: 'Reflexsilber', doors: 5, seats: 5, owners: 2, huUntil: '2026-05', emission: 'EURO_6', startEuro: 21900, incrementEuro: 250, reserveEuro: 22400, buyNowEuro: 28900, tax: 'REGELBESTEUERT', endsInMs: 3 * H + 5 * MIN, city: 'Burgwedel', zip: '30938',
    equipment: ['Discover Pro', 'ACC', 'LED-Matrix', 'Sitzheizung', 'AHK schwenkbar', 'Ergo Comfort Sitze'],
  },
  {
    nr: '100463', make: 'Porsche', model: 'Macan S', variant: '', reg: '2020-02-01', km: 64000, fuel: 'PETROL', powerKw: 260, transmission: 'AUTOMATIC', body: 'SUV', color: 'Vulkangraumetallic', doors: 5, seats: 5, owners: 1, huUntil: '2026-02', emission: 'EURO_6', startEuro: 41500, incrementEuro: 500, reserveEuro: 42500, buyNowEuro: 52900, tax: 'DIFFERENZBESTEUERT', endsInMs: 5 * H + 42 * MIN, city: 'Hannover', zip: '30159',
    equipment: ['Luftfederung', 'Sport Chrono', 'BOSE', 'Panoramadach', 'LED-Matrix PDLS', '21" Zoll', 'Lederausstattung'],
  },
  {
    nr: '100464', make: 'Skoda', model: 'Kodiaq 2.0 TDI', variant: '4x4 Style', reg: '2021-01-01', km: 81000, fuel: 'DIESEL', powerKw: 147, transmission: 'AUTOMATIC', body: 'SUV', color: 'Mondsteingrau', doors: 5, seats: 7, owners: 1, huUntil: '2026-01', emission: 'EURO_6', startEuro: 26200, incrementEuro: 250, reserveEuro: null, buyNowEuro: 32900, tax: 'REGELBESTEUERT', endsInMs: 4 * H + 10 * MIN, city: 'Garbsen', zip: '30823',
    equipment: ['7 Sitze', 'Columbus Navi', 'Canton Sound', 'AHK', 'Virtual Cockpit', 'Panoramadach'],
  },
  {
    nr: '100465', make: 'Tesla', model: 'Model 3 Long Range', variant: 'AWD', reg: '2022-07-01', km: 45000, fuel: 'ELECTRIC', powerKw: 324, transmission: 'AUTOMATIC', body: 'SEDAN', color: 'Perlweiß', doors: 4, seats: 5, owners: 1, huUntil: '2027-07', emission: '', startEuro: 32900, incrementEuro: 500, reserveEuro: null, buyNowEuro: 33900, tax: 'DIFFERENZBESTEUERT', endsInMs: 90 * MIN, city: 'Hannover', zip: '30159',
    equipment: ['Autopilot', 'Premium Interieur', 'Wärmepumpe', 'Panoramaglasdach', '19" Sport', 'Premium Connectivity'],
  },
  {
    nr: '100466', make: 'Ford', model: 'Transit Custom', variant: '2.0 EcoBlue Trend', reg: '2021-09-01', km: 68000, fuel: 'DIESEL', powerKw: 96, transmission: 'MANUAL', body: 'VAN', color: 'Frozen White', doors: 4, seats: 3, owners: 1, huUntil: '2026-09', emission: 'EURO_6', startEuro: 22500, incrementEuro: 250, reserveEuro: 23000, buyNowEuro: 27900, tax: 'REGELBESTEUERT', endsInMs: 6 * H + 20 * MIN, city: 'Langenhagen', zip: '30853',
    equipment: ['Klimaanlage', 'Navi', 'Rückfahrkamera', 'Tempomat', '3-Sitzer', 'Trennwand'],
  },
];

async function main() {
  const [dealership] = await db.select().from(schema.companies).where(eq(schema.companies.contactEmail, 'autohaus@demo.schnell-deal.local'));
  if (!dealership) {
    console.error('Demo-Autohaus nicht gefunden. Bitte zuerst `pnpm --filter @sd/api db:seed:demo` ausführen.');
    process.exit(1);
  }
  const [admin] = await db.select().from(schema.users).where(sql`${schema.users.platformRole} IN ('ADMIN','SUPERADMIN')`).limit(1);
  const createdBy = admin?.id ?? null;

  // Veröffentlichter Katalog
  const catName = 'Hannover Auktion';
  let [catalog] = await db.select().from(schema.catalogs).where(eq(schema.catalogs.name, catName));
  if (!catalog) {
    [catalog] = await db
      .insert(schema.catalogs)
      .values({ name: catName, description: 'Täglich geprüfte Inzahlungnahmen aus der Region Hannover.', status: 'PUBLISHED', startsAt: new Date(Date.now() - H), endsAt: new Date(Date.now() + 7 * 24 * H), createdBy })
      .returning();
  }

  let created = 0;
  for (const d of DEMOS) {
    const [exists] = await db.select({ id: schema.auctions.id }).from(schema.auctions).where(eq(schema.auctions.number, d.nr));
    if (exists) continue;

    const now = Date.now();
    const startsAt = new Date(now - H);
    const endsAt = new Date(now + d.endsInMs);
    const durationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / MIN);

    const [v] = await db
      .insert(schema.vehicles)
      .values({
        internalNumber: `A-${d.nr}`,
        companyId: dealership.id,
        vin: `WDEMO${d.nr}0000${d.nr}`.slice(0, 17),
        vinCheck: 'VALID',
        make: d.make,
        model: d.model,
        variant: d.variant || null,
        firstRegistration: d.reg,
        modelYear: Number(d.reg.slice(0, 4)),
        mileageKm: d.km,
        fuel: d.fuel as never,
        powerKw: d.powerKw,
        transmission: d.transmission as never,
        body: d.body as never,
        color: d.color,
        doors: d.doors,
        seats: d.seats,
        ownersCount: d.owners,
        huUntil: d.huUntil,
        emissionClass: (d.emission || null) as never,
        holderType: 'COMMERCIAL' as never,
        keysCount: 2,
        equipment: d.equipment,
        status: 'IN_AUCTION',
        completenessPct: 100,
        hasDamages: false,
        paintFlagged: false,
        approvedBy: createdBy,
        approvedAt: new Date(),
        locationStreet: 'Industriestraße 12',
        locationZip: d.zip,
        locationCity: d.city,
      })
      .returning();

    await db.insert(schema.catalogVehicles).values({ catalogId: catalog!.id, vehicleId: v!.id, sort: created }).onConflictDoNothing();

    await db.insert(schema.auctions).values({
      number: d.nr,
      vehicleId: v!.id,
      catalogId: catalog!.id,
      status: 'ACTIVE',
      startsAt,
      endsAt,
      originalEndsAt: endsAt,
      durationMinutes,
      startPrice: EUR(d.startEuro),
      reservePrice: d.reserveEuro === null ? null : EUR(d.reserveEuro),
      reserveVisible: false,
      bidIncrement: EUR(d.incrementEuro),
      buyNowPrice: d.buyNowEuro === null ? null : EUR(d.buyNowEuro),
      buyerFeePctBp: 0,
      buyerFeeFixed: EUR(149),
      sellerFeePctBp: 0,
      sellerFeeFixed: EUR(99),
      taxType: d.tax,
      locationStreet: 'Industriestraße 12',
      locationZip: d.zip,
      locationCity: d.city,
      earliestPickup: new Date(now + 2 * 24 * H).toISOString().slice(0, 10),
      antiSnipeMinutes: 2,
      currentBid: null,
      bidCount: 0,
      bidderCount: 0,
      startedAt: startsAt,
      createdBy,
    });
    created++;
  }
  console.log(`Demo-Auktionen angelegt: ${created} neu (Katalog: ${catName}).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
