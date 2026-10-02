'use client';

import { formatEuro } from '@/lib/format';
import { fmtNum, fmtPct, type DealershipStats } from '@/lib/stats';
import { BarSeries, LineSeries, monthLabel } from './charts';
import { Card, KpiCard } from './ui';

export function DealershipStatsView({ stats }: { stats: DealershipStats }) {
  const k = stats.kpis;
  const series = stats.series.map((s) => ({ ...s, label: monthLabel(s.month) }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Fahrzeuge heute" value={fmtNum(k.vehiclesToday)} />
        <KpiCard label="Diese Woche" value={fmtNum(k.vehiclesWeek)} />
        <KpiCard label="Diesen Monat" value={fmtNum(k.vehiclesMonth)} />
        <KpiCard label="Dieses Jahr" value={fmtNum(k.vehiclesYear)} />
        <KpiCard label="Insgesamt" value={fmtNum(k.vehiclesTotal)} />
        <KpiCard label="Verkauft" value={fmtNum(k.sold)} />
        <KpiCard label="Nicht verkauft" value={fmtNum(k.unsold)} />
        <KpiCard label="Verkaufsquote" value={fmtPct(k.saleRate)} />
        <KpiCard label="Gesamtverkaufswert" value={formatEuro(k.totalSales, { whole: true })} />
        <KpiCard label="Ø Zuschlag" value={formatEuro(k.avgSalePrice, { whole: true })} />
        <KpiCard label="Ø Gebote je Auktion" value={fmtNum(k.avgBids, 1)} />
        <KpiCard label="Ø Bieter je Auktion" value={fmtNum(k.avgBidders, 1)} />
        <KpiCard label="Aufnahmetermine" value={fmtNum(k.inspectionAppointments)} />
        <KpiCard label="Fahrzeuge je Termin" value={fmtNum(k.vehiclesPerAppointment, 1)} />
        <KpiCard label="Ø Tage bis Verkauf" value={fmtNum(k.avgDaysToSale, 1)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Fahrzeuge pro Monat">
          <BarSeries data={series} bars={[{ key: 'vehicles', label: 'Aufgenommen' }, { key: 'sold', label: 'Verkauft' }]} />
        </Card>
        <Card title="Ø Verkaufspreis pro Monat">
          <LineSeries data={series} lines={[{ key: 'avgPrice', label: 'Ø Zuschlag' }]} money />
        </Card>
        <Card title="Verkaufsquote pro Monat">
          <LineSeries data={series} lines={[{ key: 'saleRate', label: 'Verkaufsquote' }]} percent />
        </Card>
        <Card title="Fahrzeuge nach Marke">
          <BarSeries data={stats.byMake.map((m) => ({ label: m.make, count: m.count }))} bars={[{ key: 'count', label: 'Fahrzeuge' }]} />
        </Card>
      </div>
    </div>
  );
}
