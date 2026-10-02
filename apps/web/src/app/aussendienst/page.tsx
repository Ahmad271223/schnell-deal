'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDateDe } from '@sd/shared';
import { api } from '@/lib/api';
import type { InspectionRequestItem } from '@/lib/types';
import { AppointmentCard, UploadStatusBar } from '@/components/inspector';
import { EmptyState, PageHeader, QueryState } from '@/components/ui';

export default function TodayPage() {
  const q = useQuery({ queryKey: ['inspection-requests', 'today'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=today'), refetchInterval: 60_000 });
  return (
    <div className="mx-auto max-w-2xl">
      <UploadStatusBar />
      <PageHeader title="Heute" subtitle={formatDateDe(new Date())} />
      <QueryState query={q} empty={<EmptyState title="Heute sind keine Termine geplant" />}>
        <div className="space-y-4">
          {q.data?.map((r) => (
            <AppointmentCard key={r.id} r={r} />
          ))}
        </div>
      </QueryState>
    </div>
  );
}
