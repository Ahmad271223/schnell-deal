'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { VEHICLE_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import type { VehicleRow } from '@/components/vehicles';
import { SellerAuctionBox } from '@/components/vehicles';
import { VehicleFileView } from '@/components/vehicle-file';
import { Card, PageHeader, QueryState, statusBadge } from '@/components/ui';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['vehicle', id], queryFn: () => api<VehicleFile>(`/vehicles/${id}`) });
  const list = useQuery({ queryKey: ['vehicles', 'all', ''], queryFn: () => api<VehicleRow[]>('/vehicles') });
  const auctionId = list.data?.find((v) => v.id === id)?.currentAuction?.id;
  return (
    <QueryState query={q}>
      {q.data && (
        <div className="space-y-4">
          <PageHeader back="/autohaus/fahrzeuge" title={`${q.data.make ?? 'Fahrzeug'} ${q.data.model ?? ''}`} subtitle={`${q.data.internalNumber}${q.data.inspectorName ? ` · aufgenommen von ${q.data.inspectorName}` : ''}`} actions={statusBadge(VEHICLE_STATUS_LABELS, q.data.status)} />
          {auctionId && <SellerAuctionBox auctionId={auctionId} />}
          <Card>
            <VehicleFileView file={q.data} />
          </Card>
        </div>
      )}
    </QueryState>
  );
}
