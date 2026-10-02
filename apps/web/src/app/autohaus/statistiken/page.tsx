'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DealershipStats } from '@/lib/stats';
import { DealershipStatsView } from '@/components/dealership-stats';
import { PageHeader, QueryState } from '@/components/ui';

export default function Page() {
  const q = useQuery({ queryKey: ['company-stats'], queryFn: () => api<{ type: 'DEALERSHIP' } & DealershipStats>('/company/stats') });
  return (
    <div>
      <PageHeader title="Statistiken" subtitle="Alle Werte werden live aus Ihren Fahrzeug- und Verkaufsdaten berechnet." />
      <QueryState query={q}>{q.data && <DealershipStatsView stats={q.data} />}</QueryState>
    </div>
  );
}
