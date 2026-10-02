'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTimeDe, formatIsoDateDe, INSPECTION_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import type { InspectionRequestItem } from '@/lib/types';
import { Button, EmptyState, ErrorAlert, Field, Input, LinkButton, Modal, PageHeader, QueryState, statusBadge, Table, Tabs, Td } from '@/components/ui';

export default function AppointmentsPage() {
  const [view, setView] = useState<'open' | 'done' | 'cancelled'>('open');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['inspection-requests', view], queryFn: () => api<InspectionRequestItem[]>(`/inspection-requests?view=${view}`) });
  const [cancel, setCancel] = useState<InspectionRequestItem | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const doCancel = async () => {
    if (!cancel) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/inspection-requests/${cancel.id}/cancel`, { method: 'POST', body: { reason } });
      setCancel(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['inspection-requests'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Termine" subtitle="Aufnahmeaufträge und deren Status" actions={<LinkButton href="/autohaus/melden">Neue Anfrage</LinkButton>} />
      <Tabs tabs={[{ id: 'open', label: 'Offen' }, { id: 'done', label: 'Vergangene Aufnahmen' }, { id: 'cancelled', label: 'Storniert' }]} value={view} onChange={setView} />
      <div className="mt-4">
        <QueryState query={q} empty={<EmptyState title="Keine Einträge" />}>
          <Table head={['Auftrag', 'Fahrzeuge', 'Wunschtermin', 'Geplant', 'Status', 'Information', '']}>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.number}</Td>
                <Td>
                  {r.vehiclesRecorded}/{r.vehicleCount}
                </Td>
                <Td>
                  {formatIsoDateDe(r.requestedDate)} {r.earliestTime}–{r.latestTime}
                </Td>
                <Td>{r.scheduledAt ? formatDateTimeDe(r.scheduledAt) : '–'}</Td>
                <Td>{statusBadge(INSPECTION_STATUS_LABELS, r.status)}</Td>
                <Td className="max-w-md whitespace-normal text-slate-700">{r.statusText}</Td>
                <Td>
                  {(r.status === 'NEW' || r.status === 'PLANNED') && (
                    <Button size="sm" variant="ghost" onClick={() => setCancel(r)}>
                      Stornieren
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </div>
      <Modal
        open={!!cancel}
        onClose={() => setCancel(null)}
        title={`Auftrag ${cancel?.number ?? ''} stornieren`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancel(null)}>
              Abbrechen
            </Button>
            <Button variant="danger" onClick={doCancel} disabled={reason.length < 3} loading={busy}>
              Stornieren
            </Button>
          </>
        }
      >
        <Field label="Grund" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorAlert error={error} className="mt-3" />
      </Modal>
    </div>
  );
}
