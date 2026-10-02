'use client';

import Link from 'next/link';
import { Car } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AUCTION_OUTCOME_LABELS, AUCTION_STATUS_LABELS, formatDateTimeDe, formatKm, VEHICLE_STATUS_LABELS, type AuctionOutcome, type AuctionStatus, type VehicleStatus } from '@sd/shared';
import { api, photoUrl } from '@/lib/api';
import { formatEuro, yearOf } from '@/lib/format';
import { useChannel } from '@/lib/realtime';
import type { SellerAuctionState } from '@/lib/types';
import { Countdown } from './countdown';
import { Card, DescriptionList, EmptyState, QueryState, statusBadge, Table, Td } from './ui';

export interface VehicleRow {
  id: string;
  internalNumber: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  firstRegistration: string | null;
  mileageKm: number | null;
  status: VehicleStatus;
  completenessPct: number;
  hasDamages: boolean;
  companyName: string;
  locationCity: string | null;
  createdAt: string;
  thumbPhotoId: string | null;
  currentAuction: { id: string; status: AuctionStatus; currentBid: number | null; endsAt: string; outcome: AuctionOutcome | null } | null;
}

export function VehicleTable({ statuses, basePath, showCompany, q: search }: { statuses?: string; basePath: string; showCompany?: boolean; q?: string }) {
  const params = new URLSearchParams();
  if (statuses) params.set('status', statuses);
  if (search) params.set('q', search);
  const query = useQuery({ queryKey: ['vehicles', statuses ?? 'all', search ?? ''], queryFn: () => api<VehicleRow[]>(`/vehicles?${params.toString()}`) });
  return (
    <QueryState query={query} empty={<EmptyState title="Keine Fahrzeuge" icon={<Car className="h-8 w-8" />} />}>
      <Table head={['', 'Fahrzeug', 'FIN', 'EZ', 'km', ...(showCompany ? ['Autohaus'] : []), 'Status', 'Vollständig', 'Auktion']}>
        {query.data?.map((v) => (
          <tr key={v.id} className="hover:bg-slate-50">
            <Td className="w-16">
              {v.thumbPhotoId ? (
                <img src={photoUrl(v.id, v.thumbPhotoId, 'thumb')} alt="" className="h-10 w-14 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-14 items-center justify-center rounded bg-slate-100 text-slate-400">
                  <Car className="h-5 w-5" aria-hidden />
                </div>
              )}
            </Td>
            <Td>
              <Link href={`${basePath}/${v.id}`} className="font-medium text-brand-700 hover:underline">
                {v.make ?? 'Unbekannt'} {v.model ?? ''}
              </Link>
              <div className="text-xs text-slate-500">{v.internalNumber}</div>
            </Td>
            <Td className="font-mono text-xs">{v.vin ?? '–'}</Td>
            <Td>{yearOf(v.firstRegistration)}</Td>
            <Td>{formatKm(v.mileageKm)}</Td>
            {showCompany && <Td>{v.companyName}</Td>}
            <Td>{statusBadge(VEHICLE_STATUS_LABELS, v.status)}</Td>
            <Td className="tabular">{v.completenessPct} %</Td>
            <Td>
              {v.currentAuction ? (
                <span className="flex flex-col">
                  {v.currentAuction.status === 'ENDED' && v.currentAuction.outcome ? statusBadge(AUCTION_OUTCOME_LABELS, v.currentAuction.outcome) : statusBadge(AUCTION_STATUS_LABELS, v.currentAuction.status)}
                  <span className="tabular text-xs text-slate-600">{v.currentAuction.currentBid !== null ? formatEuro(v.currentAuction.currentBid, { whole: true }) : ''}</span>
                </span>
              ) : (
                '–'
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </QueryState>
  );
}

/** Live-Auktionsstatus für den Einlieferer (eigener Mindestpreis, keine Bieteridentitäten). */
export function SellerAuctionBox({ auctionId }: { auctionId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-auction', auctionId], queryFn: () => api<{ state: SellerAuctionState }>(`/auctions/${auctionId}`) });
  useChannel(`auction:${auctionId}`, () => void qc.invalidateQueries({ queryKey: ['seller-auction', auctionId] }));
  const s = q.data?.state;
  return (
    <Card title="Auktion">
      <QueryState query={q}>
        {s && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">{s.currentBid !== null ? 'Aktuelles Gebot' : 'Startpreis'}</p>
                <p className="tabular text-3xl font-bold">{formatEuro(s.currentBid ?? s.startPrice, { whole: true })}</p>
              </div>
              <Countdown endsAt={s.endsAt} startsAt={s.startsAt} status={s.status} />
            </div>
            <DescriptionList
              cols={2}
              items={[
                ['Auktion', s.number],
                ['Status', s.status === 'ENDED' && s.outcome ? statusBadge(AUCTION_OUTCOME_LABELS, s.outcome) : statusBadge(AUCTION_STATUS_LABELS, s.status)],
                ['Gebote / Bieter', `${s.bidCount} / ${s.bidderCount}`],
                ['Mindestpreis', s.reservePrice !== null ? `${formatEuro(s.reservePrice, { whole: true })} (${s.reserveMet ? 'erreicht' : 'nicht erreicht'})` : 'keiner'],
                ['Start', formatDateTimeDe(s.startsAt)],
                ['Ende', formatDateTimeDe(s.endsAt)],
              ]}
            />
          </div>
        )}
      </QueryState>
    </Card>
  );
}
