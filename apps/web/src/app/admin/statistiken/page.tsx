'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BIDDING_STATUS_LABELS, formatDateTimeDe, type BiddingStatus } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { fmtNum, fmtPct } from '@/lib/stats';
import { BarSeries, LineSeries, monthLabel } from '@/components/charts';
import { Card, PageHeader, QueryState, statusBadge, Table, Tabs, Td } from '@/components/ui';
import type { Overview } from '@/lib/stats';
import { InspectorsTab } from '@/components/inspector-stats';

export default function AdminStatsPage() {
  const [tab, setTab] = useState<'platform' | 'dealerships' | 'dealers' | 'inspectors'>('platform');
  return (
    <div>
      <PageHeader title="Statistiken" subtitle="Alle Werte werden live aus der Datenbank berechnet." />
      <Tabs tabs={[{ id: 'platform', label: 'Plattform' }, { id: 'dealerships', label: 'Autohäuser' }, { id: 'dealers', label: 'Händler' }, { id: 'inspectors', label: 'Außendienst' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'platform' && <PlatformTab />}
        {tab === 'dealerships' && <DealershipsTab />}
        {tab === 'dealers' && <DealersTab />}
        {tab === 'inspectors' && <InspectorsTab />}
      </div>
    </div>
  );
}

function PlatformTab() {
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/stats/overview') });
  return (
    <QueryState query={q}>
      {q.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Fahrzeuge pro Monat">
            <BarSeries data={q.data.series.map((s) => ({ ...s, label: monthLabel(s.month) }))} bars={[{ key: 'inspected', label: 'Aufgenommen' }, { key: 'sold', label: 'Verkauft' }]} />
          </Card>
          <Card title="Zuschlagswert pro Monat">
            <LineSeries data={q.data.series.map((s) => ({ ...s, label: monthLabel(s.month) }))} lines={[{ key: 'revenue', label: 'Zuschlagswert' }]} money />
          </Card>
          <Card title="Verkaufsquote pro Monat">
            <LineSeries data={q.data.series.map((s) => ({ label: monthLabel(s.month), rate: s.ended ? Math.round((s.sold / s.ended) * 1000) / 10 : null }))} lines={[{ key: 'rate', label: 'Verkaufsquote' }]} percent />
          </Card>
        </div>
      )}
    </QueryState>
  );
}

function DealershipsTab() {
  const q = useQuery({ queryKey: ['stats-dealerships'], queryFn: () => api<{ id: string; name: string; city: string; vehicles: number; vehiclesMonth: number; sold: number; totalSales: number }[]>('/admin/stats/dealerships') });
  return (
    <QueryState query={q}>
      <Table head={['Autohaus', 'Ort', 'Fahrzeuge gesamt', 'Diesen Monat', 'Verkauft', 'Gesamtverkaufswert']}>
        {q.data?.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link href={`/admin/unternehmen/${r.id}`} className="text-brand-700 hover:underline">
                {r.name}
              </Link>
            </Td>
            <Td>{r.city}</Td>
            <Td>{fmtNum(r.vehicles)}</Td>
            <Td>{fmtNum(r.vehiclesMonth)}</Td>
            <Td>{fmtNum(r.sold)}</Td>
            <Td className="tabular">{formatEuro(r.totalSales, { whole: true })}</Td>
          </tr>
        ))}
      </Table>
    </QueryState>
  );
}

function DealersTab() {
  const q = useQuery({
    queryKey: ['stats-dealers'],
    queryFn: () => api<{ id: string; name: string; city: string; biddingStatus: BiddingStatus | null; bids: number; auctionsParticipated: number; purchases: number; purchaseVolume: number; openPayments: number; lastBidAt: string | null }[]>('/admin/stats/dealers'),
  });
  return (
    <QueryState query={q}>
      <Table head={['Händler', 'Bieterstatus', 'Gebote', 'Auktionen', 'Käufe', 'Kaufquote', 'Einkaufsvolumen', 'Offene Zahlungen', 'Letzte Aktivität']}>
        {q.data?.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link href={`/admin/unternehmen/${r.id}`} className="text-brand-700 hover:underline">
                {r.name}
              </Link>
            </Td>
            <Td>{statusBadge(BIDDING_STATUS_LABELS, r.biddingStatus)}</Td>
            <Td>{fmtNum(r.bids)}</Td>
            <Td>{fmtNum(r.auctionsParticipated)}</Td>
            <Td>{fmtNum(r.purchases)}</Td>
            <Td>{fmtPct(r.auctionsParticipated ? Math.round((r.purchases / r.auctionsParticipated) * 1000) / 10 : null)}</Td>
            <Td className="tabular">{formatEuro(r.purchaseVolume, { whole: true })}</Td>
            <Td>{fmtNum(r.openPayments)}</Td>
            <Td>{formatDateTimeDe(r.lastBidAt)}</Td>
          </tr>
        ))}
      </Table>
    </QueryState>
  );
}

