'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VEHICLE_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import { AdminVehicleActions, ReviewPanel } from '@/components/admin-vehicle';
import { VehicleFileView } from '@/components/vehicle-file';
import { Alert, Card, PageHeader, QueryState, statusBadge } from '@/components/ui';

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['vehicle', id], queryFn: () => api<VehicleFile>(`/vehicles/${id}`) });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['review-queue'] });
    router.push('/admin/pruefung');
  };
  return (
    <QueryState query={q}>
      {q.data && (
        <div>
          <PageHeader
            back="/admin/pruefung"
            title={`Prüfung: ${q.data.make ?? ''} ${q.data.model ?? ''}`}
            subtitle={`${q.data.internalNumber} · ${q.data.seller?.name ?? ''} · Aufnahme: ${q.data.inspectorName ?? '–'}`}
            actions={statusBadge(VEHICLE_STATUS_LABELS, q.data.status)}
          />
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <VehicleFileView file={q.data} showQuality />
            </Card>
            <div className="space-y-4">
              {q.data.status === 'WAITING_REVIEW' ? <ReviewPanel file={q.data} onDone={done} /> : <Alert tone="info">Dieses Fahrzeug wartet nicht auf Prüfung.</Alert>}
              <AdminVehicleActions file={q.data} />
            </div>
          </div>
        </div>
      )}
    </QueryState>
  );
}
