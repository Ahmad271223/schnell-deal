'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { VehicleTable } from '@/components/vehicles';

interface InspectorStats {
  appointments: number;
  vehiclesInspected: number;
  vehiclesPerDay: number | null;
  avgInspectionMinutes: number | null;
  reworkRate: number | null;
}

export default function CompletedPage() {
  const stats = useQuery({ queryKey: ['inspector-stats'], queryFn: () => api<InspectorStats | null>('/inspector/stats') });
  const s = stats.data;
  return (
    <div>
      <PageHeader title="Abgeschlossene Aufnahmen" subtitle={s ? `${s.vehiclesInspected} Fahrzeuge in ${s.appointments} Terminen · Ø ${s.avgInspectionMinutes ?? '–'} Min. je Fahrzeug` : undefined} />
      <VehicleTable statuses="WAITING_REVIEW,REQUIRES_CORRECTION,APPROVED,SCHEDULED,IN_AUCTION,SOLD,UNSOLD,COMPLETED" basePath="/aussendienst/fahrzeug" />
    </div>
  );
}
