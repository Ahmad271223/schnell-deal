'use client';

import Link from 'next/link';
import { AlertTriangle, Building2, Gavel, Inbox, ListChecks, MessageSquare, ServerCrash, Wallet } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { useChannel } from '@/lib/realtime';
import { fmtNum, fmtPct, type Overview } from '@/lib/stats';
import { BarSeries, monthLabel } from '@/components/charts';
import { Card, KpiCard, PageHeader, QueryState } from '@/components/ui';


function QueueItem({ href, icon, label, count }: { href: string; icon: React.ReactNode; label: string; count: number }) {
  return (
    <Link href={href} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${count > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600'}`}>
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="tabular font-semibold">{count}</span>
    </Link>
  );
}

export default function AdminDashboard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/stats/overview'), refetchInterval: 60_000 });
  useChannel('admin', (e) => {
    if (['auction.ended', 'auction.started', 'inspection.created', 'vehicle.waiting_review', 'resync'].includes(e.event)) void qc.invalidateQueries({ queryKey: ['admin-overview'] });
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Live-Kennzahlen der Plattform" />
      <QueryState query={q}>
        {q.data && (
          <>
            <Card title="Arbeitsvorrat">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <QueueItem href="/admin/pruefung" icon={<ListChecks className="h-4 w-4" />} label="Fahrzeuge warten auf Prüfung" count={q.data.queue.waitingReview} />
                <QueueItem href="/admin/disposition" icon={<Inbox className="h-4 w-4" />} label="Ungeplante Aufnahmeanfragen" count={q.data.queue.unplannedRequests} />
                <QueueItem href="/admin/autohaeuser" icon={<Building2 className="h-4 w-4" />} label="Registrierungen in Prüfung" count={q.data.queue.companiesInReview} />
                <QueueItem href="/admin/auktionen?outcome=RESERVE_NOT_MET" icon={<Gavel className="h-4 w-4" />} label="Mindestpreis-Entscheidungen" count={q.data.queue.reserveDecisions} />
                <QueueItem href="/admin/reklamationen" icon={<MessageSquare className="h-4 w-4" />} label="Offene Reklamationen" count={q.data.queue.openComplaints} />
                <QueueItem href="/admin/verkaeufe" icon={<Wallet className="h-4 w-4" />} label="Überfällige Zahlungen" count={q.data.queue.overduePayments} />
                <QueueItem href="/admin/einstellungen?tab=system" icon={q.data.queue.failedJobs ? <ServerCrash className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} label="Fehlgeschlagene Hintergrundjobs" count={q.data.queue.failedJobs} />
              </div>
            </Card>
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Heute</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiCard label="Neue Aufnahmeaufträge" value={fmtNum(q.data.today.newRequests)} />
                <KpiCard label="Aufgenommene Fahrzeuge" value={fmtNum(q.data.today.vehiclesInspected)} />
                <KpiCard label="Freigegebene Fahrzeuge" value={fmtNum(q.data.today.vehiclesApproved)} />
                <KpiCard label="Aktive Auktionen" value={fmtNum(q.data.today.activeAuctions)} emphasis />
                <KpiCard label="Verkaufte Fahrzeuge" value={fmtNum(q.data.today.sold)} />
                <KpiCard label="Umsatz (Zuschläge)" value={formatEuro(q.data.today.revenue, { whole: true })} />
                <KpiCard label="Plattformgebühren" value={formatEuro(q.data.today.platformFees, { whole: true })} hint="netto" />
                <KpiCard label="Verkaufsquote" value={fmtPct(q.data.today.saleRate)} hint={`${q.data.today.auctionsEnded} Auktion(en) beendet`} />
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Dieser Monat</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                <KpiCard label="Fahrzeuge aufgenommen" value={fmtNum(q.data.month.vehiclesInspected)} />
                <KpiCard label="Versteigert" value={fmtNum(q.data.month.auctioned)} />
                <KpiCard label="Verkauft" value={fmtNum(q.data.month.sold)} />
                <KpiCard label="Nicht verkauft" value={fmtNum(q.data.month.unsold)} />
                <KpiCard label="Gesamtzuschlagswert" value={formatEuro(q.data.month.totalHammer, { whole: true })} />
                <KpiCard label="Ø Preis" value={formatEuro(q.data.month.avgPrice, { whole: true })} />
                <KpiCard label="Gebote insgesamt" value={fmtNum(q.data.month.bids)} />
                <KpiCard label="Gebote je Fahrzeug" value={fmtNum(q.data.month.bidsPerVehicle, 1)} />
                <KpiCard label="Ø Bieter" value={fmtNum(q.data.month.avgBidders, 1)} />
                <KpiCard label="Verkaufsquote" value={fmtPct(q.data.month.saleRate)} />
                <KpiCard label="Ø Zeit bis Verkauf" value={q.data.month.avgDaysToSale !== null ? `${fmtNum(q.data.month.avgDaysToSale, 1)} Tage` : '–'} />
                <KpiCard label="Plattformgebühren" value={formatEuro(q.data.month.platformFees, { whole: true })} />
              </div>
            </section>
            <Card title="Entwicklung (12 Monate)">
              <BarSeries data={q.data.series.map((s) => ({ ...s, label: monthLabel(s.month) }))} bars={[{ key: 'inspected', label: 'Aufgenommen' }, { key: 'ended', label: 'Versteigert' }, { key: 'sold', label: 'Verkauft' }]} />
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
