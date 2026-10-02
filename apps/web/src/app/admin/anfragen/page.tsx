'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTimeDe, formatIsoDateDe, INSPECTION_STATUS_LABELS, INSPECTION_STATUSES, type InspectionStatus } from '@sd/shared';
import { api } from '@/lib/api';
import type { InspectionRequestItem } from '@/lib/types';
import { RequestCard } from '@/components/dispatch';
import { EmptyState, Input, Modal, PageHeader, QueryState, Select, statusBadge, Table, Td } from '@/components/ui';

export default function RequestsPage() {
  const q = useQuery({ queryKey: ['inspection-requests', 'all'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=all'), refetchInterval: 30_000 });
  const [status, setStatus] = useState<InspectionStatus | ''>('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<InspectionRequestItem | null>(null);
  const rows = (q.data ?? []).filter((r) => (!status || r.status === status) && (!search || `${r.company.name} ${r.number} ${r.location.city}`.toLowerCase().includes(search.toLowerCase())));
  return (
    <div>
      <PageHeader title="Aufnahme-Anfragen" subtitle="Alle Anfragen der Autohäuser" actions={<Link href="/admin/disposition" className="text-sm font-medium text-brand-700 hover:underline">Zur Disposition</Link>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Suche Autohaus, Nummer, Ort" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={status} onChange={(e) => setStatus(e.target.value as InspectionStatus)} className="w-56">
          <option value="">Alle Status</option>
          {INSPECTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INSPECTION_STATUS_LABELS[s][0]}
            </option>
          ))}
        </Select>
      </div>
      <QueryState query={q}>
        {rows.length === 0 ? (
          <EmptyState title="Keine Anfragen" />
        ) : (
          <Table head={['Nummer', 'Autohaus', 'Ort', 'Fahrzeuge', 'Wunschtermin', 'Geplant', 'Mitarbeiter', 'Status', 'Eingang']}>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetail(r)}>
                <Td className="font-medium text-brand-700">{r.number}</Td>
                <Td>{r.company.name}</Td>
                <Td>
                  {r.location.zip} {r.location.city}
                </Td>
                <Td>
                  {r.vehiclesRecorded}/{r.vehicleCount}
                </Td>
                <Td>
                  {formatIsoDateDe(r.requestedDate)} {r.earliestTime}–{r.latestTime}
                </Td>
                <Td>{formatDateTimeDe(r.assignment?.scheduledAt ?? r.scheduledAt)}</Td>
                <Td>{r.assignment?.inspectorName ?? '–'}</Td>
                <Td>{statusBadge(INSPECTION_STATUS_LABELS, r.status)}</Td>
                <Td>{formatDateTimeDe(r.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryState>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Anfrage ${detail.number}` : ''} size="lg">
        {detail && (
          <div className="space-y-3">
            <RequestCard r={detail} draggable={false} />
            <p className="text-sm text-slate-600">{detail.statusText}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
