import { beforeAll, describe, expect, it } from 'vitest';
import { api, approvedDealer, approvedDealership, createPlatformUser, json, type Session } from './helpers';
import { activeAuction, bid, drainJobs, endAuctionNow, fixtureApprovedVehicle } from './flows';

let admin: Session;
let ah: Session;
let d1: Session;
let d2: Session;

beforeAll(async () => {
  admin = await createPlatformUser('ADMIN');
  ah = await approvedDealership(admin);
  d1 = await approvedDealer(admin);
  d2 = await approvedDealer(admin);

  // Fixture: 4 Fahrzeuge (2× BMW, 2× Audi): 2 verkauft (10.000 € / 14.000 €), 1 Mindestpreis verfehlt, 1 noch freigegeben.
  const v1 = await fixtureApprovedVehicle(ah.companyId!, { make: 'BMW' });
  const v2 = await fixtureApprovedVehicle(ah.companyId!, { make: 'BMW' });
  const v3 = await fixtureApprovedVehicle(ah.companyId!, { make: 'Audi' });
  await fixtureApprovedVehicle(ah.companyId!, { make: 'Audi' });
  const a1 = await activeAuction(admin, v1.id, { antiSnipeMinutes: 0 });
  await bid(d1, a1, 1_000_000);
  const a2 = await activeAuction(admin, v2.id, { antiSnipeMinutes: 0 });
  await bid(d1, a2, 1_000_000);
  await bid(d2, a2, 1_400_000);
  const a3 = await activeAuction(admin, v3.id, { antiSnipeMinutes: 0, reservePrice: 3_000_000 });
  await bid(d2, a3, 1_000_000);
  for (const a of [a1, a2, a3]) await endAuctionNow(a);
  await drainJobs();
});

describe('Statistiken aus echten Datenbankwerten', () => {
  it('Autohaus-Statistik', async () => {
    const s = json(await api('GET', '/company/stats', { session: ah }));
    expect(s.type).toBe('DEALERSHIP');
    expect(s.kpis).toMatchObject({
      vehiclesTotal: 4,
      vehiclesMonth: 4,
      vehiclesYear: 4,
      inAuction: 0,
      sold: 2,
      unsold: 1,
      auctionsEnded: 3,
      totalSales: 2_400_000,
      avgSalePrice: 1_200_000,
    });
    expect(s.kpis.saleRate).toBeCloseTo(66.7, 1);
    expect(s.kpis.avgBids).toBeCloseTo(4 / 3, 1);
    expect(s.byMake).toEqual(expect.arrayContaining([{ make: 'BMW', count: 2 }, { make: 'Audi', count: 2 }]));
    const thisMonth = s.series[s.series.length - 1];
    expect(thisMonth).toMatchObject({ vehicles: 4, sold: 2, ended: 3 });
  });

  it('Händler-Statistik (intern, Admin) und eigene Sicht', async () => {
    const s = json(await api('GET', `/admin/stats/companies/${d2.companyId}`, { session: admin }));
    expect(s.stats).toMatchObject({ bids: 2, auctionsParticipated: 2, purchases: 1, purchaseVolume: 1_400_000, openPayments: 1, cancellations: 0 });
    expect(s.stats.purchaseRate).toBe(50);
    const own = json(await api('GET', '/company/stats', { session: d1 }));
    expect(own.stats).toMatchObject({ purchases: 1, purchaseVolume: 1_000_000 });
  });

  it('Plattform-Übersicht enthält aktuelle Tages- und Monatswerte', async () => {
    const o = json(await api('GET', '/admin/stats/overview', { session: admin }));
    expect(o.today.sold).toBeGreaterThanOrEqual(2);
    expect(o.month.sold).toBeGreaterThanOrEqual(2);
    expect(o.month.totalHammer).toBeGreaterThanOrEqual(2_400_000);
    expect(o.queue.reserveDecisions).toBeGreaterThanOrEqual(1);
    expect(o.series).toHaveLength(12);
  });

  it('Statistiken sind mandantengetrennt', async () => {
    expect((await api('GET', `/admin/stats/companies/${ah.companyId}`, { session: ah })).statusCode).toBe(403);
    expect((await api('GET', '/admin/stats/overview', { session: d1 })).statusCode).toBe(403);
  });

  it('Mitarbeiter-Statistik als Betriebskennzahl', async () => {
    const inspector = await createPlatformUser('INSPECTOR');
    const own = json(await api('GET', '/inspector/stats', { session: inspector }));
    expect(own).toMatchObject({ appointments: 0, vehiclesInspected: 0, vehiclesPerDay: null, reworkRate: null });
    const all = json(await api('GET', '/admin/stats/inspectors', { session: admin }));
    expect(all.some((r: { id: string }) => r.id === inspector.userId)).toBe(true);
  });
});
