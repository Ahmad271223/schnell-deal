'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatDateTimeDe } from '@sd/shared';
import { api } from '@/lib/api';
import { EmptyState, PageHeader, QueryState, StatusBadge, Table, Td } from '@/components/ui';

interface QueueRow {
  id: string;
  internalNumber: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  completenessPct: number;
  hasDamages: boolean;
  paintFlagged: boolean;
  returnCount: number;
  companyName: string;
  inspectionCompletedAt: string | null;
  photoCount: number;
  badPhotoCount: number;
  damageCount: number;
  documentCount: number;
  dtcCount: number;
}

export default function ReviewQueuePage() {
  const q = useQuery({ queryKey: ['review-queue'], queryFn: () => api<QueueRow[]>('/admin/review-queue'), refetchInterval: 30_000 });
  return (
    <div>
      <PageHeader title="Prüfung" subtitle="Neue Fahrzeugaufnahmen – älteste zuerst" />
      <QueryState query={q} empty={<EmptyState title="Keine Fahrzeuge in der Prüfung" />}>
        <Table head={['Fahrzeug', 'Autohaus', 'Vollständigkeit', 'Fotos', 'Schäden', 'Diagnose', 'Dokumente', 'Hinweise', 'Abgeschlossen']}>
          {q.data?.map((v) => (
            <tr key={v.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/pruefung/${v.id}`} className="font-medium text-brand-700 hover:underline">
                  {v.make} {v.model}
                </Link>
                <div className="text-xs text-slate-500">
                  {v.internalNumber} · {v.vin}
                </div>
              </Td>
              <Td>{v.companyName}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                    <div className={v.completenessPct === 100 ? 'h-full bg-emerald-500' : 'h-full bg-amber-500'} style={{ width: `${v.completenessPct}%` }} />
                  </div>
                  <span className="tabular text-sm">{v.completenessPct} %</span>
                </div>
              </Td>
              <Td>
                {v.photoCount}
                {v.badPhotoCount > 0 && <span className="ml-1 text-xs text-amber-700">({v.badPhotoCount} mit Warnung)</span>}
              </Td>
              <Td>{v.damageCount}</Td>
              <Td>{v.dtcCount > 0 ? `${v.dtcCount} Codes` : '–'}</Td>
              <Td>{v.documentCount}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {v.paintFlagged && <StatusBadge label="Lackwerte" tone="warning" />}
                  {v.returnCount > 0 && <StatusBadge label={`${v.returnCount}× korrigiert`} tone="info" />}
                </div>
              </Td>
              <Td>{formatDateTimeDe(v.inspectionCompletedAt)}</Td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
