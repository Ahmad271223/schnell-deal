'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDateDe } from '@sd/shared';
import { api } from '@/lib/api';
import type { InspectionRequestItem } from '@/lib/types';
import { AppointmentCard } from '@/components/inspector';
import { EmptyState, PageHeader, QueryState } from '@/components/ui';

export default function AppointmentsPage() {
  const q = useQuery({ queryKey: ['inspection-requests', 'open'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=open') });
  const groups = new Map<string, InspectionRequestItem[]>();
  for (const r of q.data ?? []) {
    const day = formatDateDe(r.assignment?.scheduledAt ?? r.scheduledAt ?? r.requestedDate);
    groups.set(day, [...(groups.get(day) ?? []), r]);
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Meine Termine" />
      <QueryState query={q} empty={<EmptyState title="Keine offenen Termine" />}>
        <div className="space-y-6">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{day}</h2>
              <div className="space-y-4">
                {items.map((r) => (
                  <AppointmentCard key={r.id} r={r} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
