'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatKm } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { useChannel } from '@/lib/realtime';
import type { AuctionCard } from '@/lib/types';
import { Countdown } from '@/components/countdown';
import { EmptyState, PageHeader, QueryState, StatusBadge, Table, Td } from '@/components/ui';

function LiveRow({ a }: { a: AuctionCard }) {
  const qc = useQueryClient();
  useChannel(`auction:${a.id}`, () => void qc.invalidateQueries({ queryKey: ['dealership-auctions'] }));
  const reserveMet = a.reservePrice === null || a.reservePrice === undefined ? null : (a.currentBid ?? 0) >= a.reservePrice;
  return (
    <tr>
      <Td>
        <Link href={`/autohaus/fahrzeuge/${a.vehicleId}`} className="font-medium text-brand-700 hover:underline">
          {a.make} {a.model}
        </Link>
        <div className="text-xs text-slate-500">
          {a.number} · {formatKm(a.mileageKm)}
        </div>
      </Td>
      <Td className="tabular text-lg font-semibold">{formatEuro(a.currentBid ?? a.startPrice, { whole: true })}</Td>
      <Td>{a.bidCount}</Td>
      <Td>
        {a.reservePrice ? (
          <span className="flex items-center gap-2">
            <span className="tabular">{formatEuro(a.reservePrice, { whole: true })}</span>
            <StatusBadge label={reserveMet ? 'erreicht' : 'nicht erreicht'} tone={reserveMet ? 'success' : 'warning'} />
          </span>
        ) : (
          'keiner'
        )}
      </Td>
      <Td>
        <Countdown endsAt={a.endsAt} startsAt={a.startsAt} status={a.status} />
      </Td>
    </tr>
  );
}

export default function DealershipAuctionsPage() {
  const q = useQuery({ queryKey: ['dealership-auctions'], queryFn: () => api<{ items: AuctionCard[] }>('/auctions?status=active'), refetchInterval: 60_000 });
  const scheduled = useQuery({ queryKey: ['dealership-auctions', 'scheduled'], queryFn: () => api<{ items: AuctionCard[] }>('/auctions?status=scheduled') });
  return (
    <div className="space-y-6">
      <PageHeader title="Aktive Auktionen" subtitle="Live-Stand Ihrer Fahrzeuge. Bieteridentitäten werden nicht angezeigt." />
      <QueryState query={q}>
        {q.data?.items.length ? (
          <Table head={['Fahrzeug', 'Aktuelles Gebot', 'Gebote', 'Ihr Mindestpreis', 'Restzeit']}>
            {q.data.items.map((a) => (
              <LiveRow key={a.id} a={a} />
            ))}
          </Table>
        ) : (
          <EmptyState title="Derzeit keine laufenden Auktionen" />
        )}
      </QueryState>
      {scheduled.data?.items.length ? (
        <div>
          <h2 className="mb-2 font-semibold">Geplant</h2>
          <Table head={['Fahrzeug', 'Startpreis', 'Gebote', 'Ihr Mindestpreis', 'Start']}>
            {scheduled.data.items.map((a) => (
              <LiveRow key={a.id} a={a} />
            ))}
          </Table>
        </div>
      ) : null}
    </div>
  );
}
