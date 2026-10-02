'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, ChevronRight, Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VEHICLE_STATUS_LABELS } from '@sd/shared';
import { api, newId } from '@/lib/api';
import { loadDraft, outbox, saveDraft, useOutbox } from '@/lib/outbox';
import type { InspectionRequestItem } from '@/lib/types';
import { AppointmentCard, UploadStatusBar } from '@/components/inspector';
import { Alert, Button, Card, ErrorAlert, PageHeader, QueryState, StatusBadge, statusBadge } from '@/components/ui';

interface LocalVehicle {
  id: string;
  createdAt: number;
}

export default function InspectionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { items } = useOutbox();
  const q = useQuery({ queryKey: ['inspection-request', id], queryFn: () => api<InspectionRequestItem>(`/inspection-requests/${id}`), refetchInterval: 20_000 });
  const [local, setLocal] = useState<LocalVehicle[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadDraft<LocalVehicle[]>(`localVehicles:${id}`).then((v) => setLocal(v ?? []));
  }, [id]);
  useEffect(() => outbox.onDone(() => void qc.invalidateQueries({ queryKey: ['inspection-request', id] })), [id, qc]);

  const addVehicle = async () => {
    // Offline-fähig: ID wird lokal erzeugt, der Server übernimmt sie (idempotent).
    const vehicleId = newId();
    const next = [...local, { id: vehicleId, createdAt: Date.now() }];
    setLocal(next);
    await saveDraft(`localVehicles:${id}`, next);
    await outbox.enqueue({ id: `create-${vehicleId}`, vehicleId, requestId: id, kind: 'json', method: 'POST', url: `/inspector/requests/${id}/vehicles`, body: { clientVehicleId: vehicleId }, label: 'Fahrzeug anlegen' });
    router.push(`/aussendienst/fahrzeug/${vehicleId}?auftrag=${id}`);
  };

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/inspector/requests/${id}/status`, { method: 'POST', body: { status: 'COMPLETED' } });
      await q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const serverVehicles = q.data?.vehicles ?? [];
  const pendingLocal = local.filter((l) => !serverVehicles.some((s) => s.id === l.id));
  const openUploads = items.filter((i) => i.requestId === id || serverVehicles.some((v) => v.id === i.vehicleId) || local.some((l) => l.id === i.vehicleId)).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <UploadStatusBar />
      <PageHeader back="/aussendienst" title={q.data ? q.data.company.name : 'Auftrag'} subtitle={q.data?.number} />
      <QueryState query={q}>
        {q.data && (
          <>
            {q.data.status !== 'IN_PROGRESS' && q.data.status !== 'COMPLETED' && <AppointmentCard r={q.data} />}
            <Card title={`Fahrzeuge (${serverVehicles.length + pendingLocal.length} von ${q.data.vehicleCount} erwartet)`}>
              <ul className="divide-y divide-slate-100">
                {serverVehicles.map((v) => (
                  <li key={v.id}>
                    <Link href={`/aussendienst/fahrzeug/${v.id}?auftrag=${id}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="flex items-center gap-3">
                        <Car className="h-6 w-6 text-slate-400" aria-hidden />
                        <span>
                          <span className="block font-medium">
                            {v.make ?? 'Neues Fahrzeug'} {v.model ?? ''}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {v.internalNumber} · {v.vin ?? 'FIN fehlt'} · {v.completenessPct} %
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {statusBadge(VEHICLE_STATUS_LABELS, v.status)}
                        <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
                {pendingLocal.map((v) => (
                  <li key={v.id}>
                    <Link href={`/aussendienst/fahrzeug/${v.id}?auftrag=${id}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="flex items-center gap-3">
                        <Car className="h-6 w-6 text-slate-400" aria-hidden />
                        <span className="font-medium">Neues Fahrzeug (lokal)</span>
                      </span>
                      <StatusBadge label="Wartet auf Synchronisierung" tone="warning" />
                    </Link>
                  </li>
                ))}
              </ul>
              {q.data.status === 'IN_PROGRESS' && (
                <Button size="xl" className="mt-3 w-full" icon={<Plus className="h-6 w-6" />} onClick={addVehicle}>
                  Fahrzeug hinzufügen
                </Button>
              )}
            </Card>
            {q.data.status === 'IN_PROGRESS' && (
              <Card title="Auftrag abschließen">
                {openUploads > 0 ? (
                  <Alert tone="warning">Es sind noch {openUploads} Upload(s) offen. Bitte warten, bis alle Daten übertragen sind.</Alert>
                ) : (
                  <p className="mb-3 text-sm text-slate-600">Alle Fahrzeugaufnahmen müssen abgeschlossen sein. Danach prüft der Administrator die Fahrzeuge.</p>
                )}
                <Button variant="success" size="lg" className="mt-2 w-full" onClick={complete} loading={busy} disabled={openUploads > 0}>
                  Auftrag abschließen
                </Button>
                <ErrorAlert error={error} className="mt-2" />
              </Card>
            )}
            {q.data.status === 'COMPLETED' && <Alert tone="success" title="Auftrag abgeschlossen">Die Fahrzeuge warten auf die Prüfung durch den Administrator.</Alert>}
          </>
        )}
      </QueryState>
    </div>
  );
}
