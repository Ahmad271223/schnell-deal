'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AUCTION_STATUS_LABELS, formatDateTimeDe } from '@sd/shared';
import { api, photoUrl } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { Countdown } from './countdown';
import { EmptyState, PageHeader, QueryState, StatusBadge, statusBadge, Table, Td } from './ui';

interface Row {
  id: string;
  number: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  endsAt: string;
  currentBid: number | null;
  bidCount: number;
  myHighestBid: number;
  myBidCount: number;
  myMaxBid: number | null;
  vehicleId: string;
  make: string | null;
  model: string | null;
  mainPhotoId: string | null;
  dealId: string | null;
  result: 'LEADING' | 'OUTBID' | 'WON' | 'LOST' | 'RESERVE_NOT_MET';
}

const RESULT: Record<Row['result'], [string, 'success' | 'danger' | 'neutral' | 'warning']> = {
  LEADING: ['Sie führen', 'success'],
  OUTBID: ['Überboten', 'danger'],
  WON: ['Gewonnen', 'success'],
  LOST: ['Nicht gewonnen', 'neutral'],
  RESERVE_NOT_MET: ['Mindestpreis nicht erreicht', 'warning'],
};

export function MyAuctions({ state, title }: { state: 'all' | 'won' | 'lost' | 'active'; title: string }) {
  const q = useQuery({ queryKey: ['me-auctions', state], queryFn: () => api<{ items: Row[] }>(`/me/auctions?state=${state}`), refetchInterval: 30_000 });
  return (
    <div>
      <PageHeader title={title} subtitle="Alle Auktionen, auf die Ihr Unternehmen geboten hat." />
      <QueryState query={q}>
        {q.data?.items.length === 0 ? (
          <EmptyState title="Keine Einträge" />
        ) : (
          <Table head={['Fahrzeug', 'Auktion', 'Status', 'Ihr Höchstgebot', 'Ihr Maximalgebot', 'Aktuelles Gebot', 'Ende', 'Ergebnis']}>
            {q.data?.items.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={r.dealId ? `/haendler/kaeufe/${r.dealId}` : `/haendler/auktionen/${r.id}`} className="flex items-center gap-2 text-brand-700 hover:underline">
                    {r.mainPhotoId && (
                      <img src={photoUrl(r.vehicleId, r.mainPhotoId, 'thumb')} alt="" className="h-10 w-14 rounded object-cover" />
                    )}
                    {r.make} {r.model}
                  </Link>
                </Td>
                <Td>{r.number}</Td>
                <Td>{statusBadge(AUCTION_STATUS_LABELS, r.status)}</Td>
                <Td className="tabular">{formatEuro(r.myHighestBid)}</Td>
                <Td className="tabular">{r.myMaxBid ? formatEuro(r.myMaxBid) : '–'}</Td>
                <Td className="tabular font-medium">{formatEuro(r.currentBid)}</Td>
                <Td>{r.status === 'ACTIVE' ? <Countdown endsAt={r.endsAt} status={r.status} size="sm" /> : formatDateTimeDe(r.endsAt)}</Td>
                <Td>
                  <StatusBadge label={RESULT[r.result][0]} tone={RESULT[r.result][1]} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryState>
    </div>
  );
}
