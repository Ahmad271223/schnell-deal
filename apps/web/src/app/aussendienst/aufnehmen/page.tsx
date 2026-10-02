'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { InspectionRequestItem } from '@/lib/types';
import { AppointmentCard } from '@/components/inspector';
import { EmptyState, PageHeader, QueryState } from '@/components/ui';

export default function StartInspectionPage() {
  const q = useQuery({ queryKey: ['inspection-requests', 'open'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=open') });
  const active = (q.data ?? []).filter((r) => r.status === 'ON_SITE' || r.status === 'IN_PROGRESS' || r.status === 'EN_ROUTE' || r.status === 'ASSIGNED');
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Fahrzeug aufnehmen" subtitle="Wählen Sie den Auftrag, in dem Sie Fahrzeuge erfassen." />
      <QueryState query={q}>
        {active.length === 0 ? (
          <EmptyState title="Kein aktiver Auftrag">Melden Sie sich zuerst beim Termin als „angekommen“ und starten Sie die Aufnahme.</EmptyState>
        ) : (
          <div className="space-y-4">
            {active.map((r) => (
              <AppointmentCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
