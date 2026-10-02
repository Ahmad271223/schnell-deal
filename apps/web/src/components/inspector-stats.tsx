'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtNum, fmtPct } from '@/lib/stats';
import { Alert, QueryState, Table, Td } from './ui';

export interface InspectorStatRow {
  id: string;
  firstName: string;
  lastName: string;
  appointments: number;
  vehiclesInspected: number;
  activeDays: number;
  avgInspectionMinutes: number | null;
  photosRejectedByQualityCheck: number;
  photosNotFullyVisible: number;
  photosRequestedByAdmin: number;
  vehiclesReturned: number;
  returnsTotal: number;
  vehiclesPerDay: number | null;
  reworkRate: number | null;
}

export function InspectorsTab() {
  const q = useQuery({ queryKey: ['stats-inspectors'], queryFn: () => api<InspectorStatRow[]>('/admin/stats/inspectors') });
  return (
    <div className="space-y-3">
      <Alert tone="info">Betriebskennzahlen zur Planung und Qualitätssicherung – bewusst ohne Ranking (alphabetisch sortiert).</Alert>
      <QueryState query={q}>
        <Table head={['Mitarbeiter', 'Aufnahmetermine', 'Fahrzeuge', 'Fahrzeuge/Tag', 'Ø Aufnahmezeit', 'Qualitätswarnungen Fotos', 'Fahrzeug abgeschnitten (KI)', 'Fotos nachgefordert', 'Nachbearbeitungsquote', 'Zurückgewiesen']}>
          {q.data?.map((r) => (
            <tr key={r.id}>
              <Td>
                {r.firstName} {r.lastName}
              </Td>
              <Td>{fmtNum(r.appointments)}</Td>
              <Td>{fmtNum(r.vehiclesInspected)}</Td>
              <Td>{fmtNum(r.vehiclesPerDay, 1)}</Td>
              <Td>{r.avgInspectionMinutes !== null ? `${fmtNum(r.avgInspectionMinutes, 1)} Min.` : '–'}</Td>
              <Td>{fmtNum(r.photosRejectedByQualityCheck)}</Td>
              <Td>{fmtNum(r.photosNotFullyVisible)}</Td>
              <Td>{fmtNum(r.photosRequestedByAdmin)}</Td>
              <Td>{fmtPct(r.reworkRate)}</Td>
              <Td>{fmtNum(r.returnsTotal)}</Td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
