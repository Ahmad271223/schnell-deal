'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AUCTION_OUTCOME_LABELS, AUCTION_STATUS_LABELS, formatDateTimeDe, type AuctionOutcome, type AuctionStatus } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { useChannel } from '@/lib/realtime';
import { Countdown } from '@/components/countdown';
import { EmptyState, LinkButton, PageHeader, QueryState, StatusBadge, statusBadge, Table, Tabs, Td } from '@/components/ui';

interface Row {
  id: string;
  number: string;
  status: AuctionStatus;
  outcome: AuctionOutcome | null;
  startsAt: string;
  endsAt: string;
  startPrice: number;
  reservePrice: number | null;
  currentBid: number | null;
  bidCount: number;
  bidderCount: number;
  resolvedAt: string | null;
  vehicleId: string;
  internalNumber: string;
  make: string | null;
  model: string | null;
  companyName: string;
  catalogName: string | null;
  dealId: string | null;
}

function AuctionsList() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuctionStatus | 'ALL' | 'DECISION'>(params.get('outcome') === 'RESERVE_NOT_MET' ? 'DECISION' : 'ACTIVE');
  const query = status === 'ALL' ? '' : status === 'DECISION' ? '?outcome=RESERVE_NOT_MET' : `?status=${status}`;
  const q = useQuery({ queryKey: ['admin-auctions', status], queryFn: () => api<Row[]>(`/admin/auctions${query}`), refetchInterval: 30_000 });
  useChannel('admin', (e) => e.event.startsWith('auction.') && void qc.invalidateQueries({ queryKey: ['admin-auctions'] }));
  const rows = status === 'DECISION' ? (q.data ?? []).filter((r) => !r.resolvedAt) : (q.data ?? []);
  return (
    <div>
      <PageHeader title="Auktionen" actions={<LinkButton href="/admin/auktionen/neu" icon={<Plus className="h-4 w-4" />}>Auktion anlegen</LinkButton>} />
      <Tabs
        tabs={[
          { id: 'ACTIVE', label: 'Laufend' },
          { id: 'SCHEDULED', label: 'Geplant' },
          { id: 'DRAFT', label: 'Entwürfe' },
          { id: 'ENDED', label: 'Beendet' },
          { id: 'DECISION', label: 'Mindestpreis-Entscheidung' },
          { id: 'CANCELLED', label: 'Abgebrochen' },
          { id: 'ALL', label: 'Alle' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <div className="mt-4">
        <QueryState query={q}>
          {rows.length === 0 ? (
            <EmptyState title="Keine Auktionen" />
          ) : (
            <Table head={['Auktion', 'Fahrzeug', 'Autohaus', 'Katalog', 'Status', 'Gebot / Mindestpreis', 'Gebote', 'Zeit', 'Deal']}>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/admin/auktionen/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.number}
                    </Link>
                  </Td>
                  <Td>
                    {r.make} {r.model}
                    <div className="text-xs text-slate-500">{r.internalNumber}</div>
                  </Td>
                  <Td>{r.companyName}</Td>
                  <Td>{r.catalogName ?? '–'}</Td>
                  <Td>{r.status === 'ENDED' && r.outcome ? statusBadge(AUCTION_OUTCOME_LABELS, r.outcome) : statusBadge(AUCTION_STATUS_LABELS, r.status)}</Td>
                  <Td className="tabular">
                    {formatEuro(r.currentBid ?? r.startPrice, { whole: true })}
                    {r.reservePrice !== null && <span className="text-xs text-slate-500"> / {formatEuro(r.reservePrice, { whole: true })}</span>}
                  </Td>
                  <Td>
                    {r.bidCount} ({r.bidderCount} Bieter)
                  </Td>
                  <Td>{r.status === 'ACTIVE' || r.status === 'SCHEDULED' ? <Countdown endsAt={r.endsAt} startsAt={r.startsAt} status={r.status} size="sm" /> : formatDateTimeDe(r.endsAt)}</Td>
                  <Td>{r.dealId ? <Link href={`/admin/verkaeufe/${r.dealId}`} className="text-brand-700 hover:underline">Deal</Link> : r.outcome === 'RESERVE_NOT_MET' && !r.resolvedAt ? <StatusBadge label="Entscheidung offen" tone="warning" /> : '–'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AuctionsList />
    </Suspense>
  );
}
