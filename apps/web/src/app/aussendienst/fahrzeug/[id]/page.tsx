'use client';

import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { Suspense, use, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PHOTO_SLOT_LABELS, VEHICLE_STATUS_LABELS, type PhotoSlot } from '@sd/shared';
import { api, ApiError } from '@/lib/api';
import { idbGet, idbPut } from '@/lib/idb';
import { outbox, useDraft, useOutbox } from '@/lib/outbox';
import type { VehicleFile } from '@/lib/types';
import { UploadStatusBar } from '@/components/inspector';
import {
  BasicDataStep,
  BatteryStep,
  DamagesStep,
  DocumentsStep,
  FeaturesStep,
  MileageStep,
  ObdStep,
  PaintStep,
  PdrStep,
  PhotosStep,
  TiresStep,
  VinStep,
  type StepProps,
} from '@/components/inspection-steps';
import { Alert, Button, ErrorAlert, Spinner, statusBadge } from '@/components/ui';

const STEPS: { id: string; title: string; Component: (p: StepProps) => React.ReactNode }[] = [
  { id: 'vin', title: 'FIN', Component: VinStep },
  { id: 'km', title: 'Kilometerstand', Component: MileageStep },
  { id: 'docs', title: 'Dokumente', Component: DocumentsStep },
  { id: 'basic', title: 'Stammdaten', Component: BasicDataStep },
  { id: 'photos', title: 'Pflichtfotos', Component: PhotosStep },
  { id: 'damages', title: 'Schäden', Component: DamagesStep },
  { id: 'pdr', title: 'Dellenprüfung', Component: PdrStep },
  { id: 'paint', title: 'Lackmessung', Component: PaintStep },
  { id: 'tires', title: 'Reifen', Component: TiresStep },
  { id: 'obd', title: 'OBD / Diagnose', Component: ObdStep },
  { id: 'battery', title: 'Batterie', Component: BatteryStep },
  { id: 'features', title: 'Funktionsprüfung', Component: FeaturesStep },
  { id: 'summary', title: 'Zusammenfassung', Component: () => null },
];

function GuidedInspection({ vehicleId }: { vehicleId: string }) {
  const params = useSearchParams();
  const requestId = params.get('auftrag');
  const router = useRouter();
  const qc = useQueryClient();
  const { items, online } = useOutbox();
  const pending = useMemo(() => items.filter((i) => i.vehicleId === vehicleId), [items, vehicleId]);
  const creating = pending.some((i) => i.id === `create-${vehicleId}`);
  const [step, setStep, stepLoaded] = useDraft(`step:${vehicleId}`, 0);
  const [cached, setCached] = useState<VehicleFile | null>(null);

  const q = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api<VehicleFile>(`/vehicles/${vehicleId}`),
    enabled: online && !creating,
    retry: false,
    // Solange Fotos serverseitig verarbeitet werden (Ableitungen, KI-Bildprüfung), den Stand regelmäßig nachladen.
    refetchInterval: (query) => (query.state.data?.photos.some((p) => !p.replaced && (!p.processed || p.quality === 'PENDING')) ? 5_000 : false),
  });
  useEffect(() => {
    if (q.data) void idbPut('vehicleCache', { ...q.data, id: vehicleId });
  }, [q.data, vehicleId]);
  useEffect(() => {
    void idbGet<VehicleFile>('vehicleCache', vehicleId).then((v) => v && setCached(v));
  }, [vehicleId]);
  // Nach jeder erfolgreichen Übertragung den Serverstand (Vollständigkeit) neu laden.
  useEffect(() => outbox.onDone((item) => item.vehicleId === vehicleId && void qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] })), [vehicleId, qc]);

  const server = q.data ?? cached;
  const locked = server && !['DRAFT', 'INSPECTION_IN_PROGRESS', 'REQUIRES_CORRECTION'].includes(server.status);
  const current = STEPS[Math.min(step, STEPS.length - 1)]!;
  const go = (i: number) => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, i)));
    window.scrollTo({ top: 0 });
  };

  // Schritte erst rendern, wenn der Ausgangsstand bekannt ist (Server, lokaler Cache oder neue Offline-Anlage),
  // damit Formulare nicht nachträglich neu initialisiert werden und Eingaben verlieren.
  const waitingForData = online && !creating && !cached && q.isPending && q.isFetching;
  if (!stepLoaded || waitingForData) return <Spinner />;
  if (q.error instanceof ApiError && q.error.status === 404 && !creating && !cached) {
    return <Alert tone="danger">Fahrzeug nicht gefunden oder nicht Ihrem Auftrag zugeordnet.</Alert>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <UploadStatusBar />
      <div className="mb-3 flex items-center justify-between gap-2">
        <button onClick={() => router.push(requestId ? `/aussendienst/auftrag/${requestId}` : '/aussendienst')} className="flex items-center gap-1 text-sm text-slate-600">
          <ChevronLeft className="h-4 w-4" /> Auftrag
        </button>
        <div className="text-right">
          <p className="text-sm font-semibold">{server?.internalNumber ?? 'Neues Fahrzeug'}</p>
          <p className="text-xs text-slate-500">
            {server ? `${server.make ?? ''} ${server.model ?? ''}`.trim() || 'Daten werden erfasst' : creating ? 'Wird angelegt …' : ''}
          </p>
        </div>
      </div>

      {server?.status === 'REQUIRES_CORRECTION' && (
        <Alert tone="danger" title="Korrektur erforderlich" className="mb-3">
          <p>{server.reviewNote}</p>
          {server.requestedPhotoSlots && server.requestedPhotoSlots.length > 0 && <p className="mt-1">Neu aufzunehmen: {server.requestedPhotoSlots.map((s) => PHOTO_SLOT_LABELS[s as PhotoSlot] ?? s).join(', ')}</p>}
        </Alert>
      )}

      {locked ? (
        <div className="space-y-3">
          <Alert tone="info" title="Fahrzeugakte abgeschlossen">
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Die Akte ist gesperrt. Änderungen sind nur noch als nachvollziehbare Korrektur durch den Administrator möglich.
            </span>
          </Alert>
          <div>{statusBadge(VEHICLE_STATUS_LABELS, server.status)}</div>
        </div>
      ) : (
        <>
          {/* Schrittleiste */}
          <nav aria-label="Aufnahmeschritte" className="-mx-3 mb-4 overflow-x-auto px-3">
            <ol className="flex gap-1.5">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    onClick={() => go(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={clsx('flex h-9 items-center gap-1 whitespace-nowrap rounded-full px-3 text-xs font-medium', i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}
                  >
                    {i < step && <Check className="h-3.5 w-3.5" aria-hidden />}
                    {i + 1}. {s.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <h1 className="mb-3 text-xl font-semibold">
            Schritt {step + 1}: {current.title}
          </h1>
          {current.id === 'summary' ? (
            <SummaryStep vehicleId={vehicleId} requestId={requestId} server={q.data ?? null} pendingCount={pending.length} online={online} onGoto={go} />
          ) : (
            <current.Component key={current.id} vehicleId={vehicleId} requestId={requestId} server={server} pending={pending} onNext={() => go(step + 1)} />
          )}
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0} icon={<ChevronLeft className="h-4 w-4" />}>
              Zurück
            </Button>
            {step < STEPS.length - 1 && (
              <Button variant="ghost" onClick={() => go(step + 1)}>
                Überspringen <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryStep({ vehicleId, requestId, server, pendingCount, online, onGoto }: { vehicleId: string; requestId: string | null; server: VehicleFile | null; pendingCount: number; online: boolean; onGoto: (i: number) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const c = server?.completeness;
  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/vehicles/${vehicleId}/complete`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      await qc.invalidateQueries({ queryKey: ['inspection-request'] });
      router.push(requestId ? `/aussendienst/auftrag/${requestId}` : '/aussendienst');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!online) return <Alert tone="warning">Für den Abschluss wird eine Internetverbindung benötigt. Alle Daten sind lokal gesichert.</Alert>;
  if (!c) return <Spinner label="Stand wird geladen …" />;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">Vollständigkeit</span>
          <span className="tabular text-2xl font-bold">{c.percent} %</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
          <div className={clsx('h-full', c.canComplete ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${c.percent}%` }} />
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Pflichtfotos: {c.photoStats.present}/{c.photoStats.required}
          {c.photoStats.badQuality > 0 && ` · ${c.photoStats.badQuality} mit Qualitätsmangel`}
        </p>
      </div>
      {pendingCount > 0 && <Alert tone="progress">Noch {pendingCount} Änderung(en) in der Upload-Warteschlange. Der Abschluss ist möglich, sobald alles übertragen ist.</Alert>}
      {c.missing.length > 0 && (
        <Alert tone={c.canComplete ? 'info' : 'danger'} title={c.canComplete ? 'Optionale Angaben fehlen' : 'Pflichtangaben fehlen'}>
          <ul className="list-disc pl-5">
            {c.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {c.missingPhotoSlots.length > 0 && (
            <>
              <p className="mt-2">Fehlende Pflichtfotos: {c.missingPhotoSlots.map((s) => PHOTO_SLOT_LABELS[s]).join(', ')}</p>
              <Button size="sm" className="mt-2" onClick={() => onGoto(4)}>
                Zu den Fotos
              </Button>
            </>
          )}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Button size="xl" variant="success" className="w-full" disabled={!c.canComplete || pendingCount > 0} loading={busy} onClick={complete}>
        Fahrzeugaufnahme abschließen
      </Button>
      <p className="text-center text-xs text-slate-500">Nach dem Abschluss wird die Akte gesperrt und an den Administrator zur Prüfung übergeben.</p>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <GuidedInspection vehicleId={id} />
    </Suspense>
  );
}
