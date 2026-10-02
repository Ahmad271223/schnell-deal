'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { VEHICLE_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import { AdminVehicleActions } from '@/components/admin-vehicle';
import { VehicleFileView } from '@/components/vehicle-file';
import { VehicleMediaManager } from '@/components/vehicle-media-manager';
import { Card, PageHeader, QueryState, statusBadge } from '@/components/ui';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['vehicle', id], queryFn: () => api<VehicleFile>(`/vehicles/${id}`) });
  return (
    <QueryState query={q}>
      {q.data && (
        <div>
          <PageHeader
            back="/admin/fahrzeuge"
            title={`${q.data.make ?? 'Fahrzeug'} ${q.data.model ?? ''}`}
            subtitle={`${q.data.internalNumber} · ${q.data.seller?.name ?? ''}${q.data.inspectorName ? ` · Aufnahme: ${q.data.inspectorName}` : ''}`}
            actions={statusBadge(VEHICLE_STATUS_LABELS, q.data.status)}
          />
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              <Card>
                <VehicleMediaManager file={q.data} onChange={() => void q.refetch()} />
              </Card>
              <Card>
                <VehicleFileView file={q.data} showQuality />
              </Card>
            </div>
            <AdminVehicleActions file={q.data} />
          </div>
        </div>
      )}
    </QueryState>
  );
}
