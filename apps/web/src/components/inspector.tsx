'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { CloudUpload, MapPin, Navigation, Phone, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatTimeDe, INSPECTION_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import { useOutbox } from '@/lib/outbox';
import type { InspectionRequestItem } from '@/lib/types';
import { Button, ErrorAlert, statusBadge } from './ui';

export function mapsUrl(r: Pick<InspectionRequestItem, 'location'>) {
  const q = encodeURIComponent(`${r.location.street}, ${r.location.zip} ${r.location.city}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/** Termin-Karte mit großen Touch-Buttons (Spec §7). */
export function AppointmentCard({ r }: { r: InspectionRequestItem }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const setStatus = async (status: 'EN_ROUTE' | 'ON_SITE' | 'IN_PROGRESS') => {
    setBusy(status);
    setError(null);
    try {
      await api(`/inspector/requests/${r.id}/status`, { method: 'POST', body: { status } });
      await qc.invalidateQueries({ queryKey: ['inspection-requests'] });
      await qc.invalidateQueries({ queryKey: ['inspection-request', r.id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const time = r.assignment?.scheduledAt ?? r.scheduledAt;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tabular text-2xl font-bold text-slate-900">{time ? formatTimeDe(time) : `${r.earliestTime}–${r.latestTime}`}</p>
          <p className="text-lg font-semibold">{r.company.name}</p>
          <p className="text-sm text-slate-600">{r.vehicleCount} Fahrzeug(e){r.vehiclesRecorded > 0 && ` · ${r.vehiclesRecorded} erfasst`}</p>
        </div>
        {statusBadge(INSPECTION_STATUS_LABELS, r.status)}
      </div>
      <p className="mt-2 flex items-start gap-1 text-sm text-slate-700">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {r.location.street}, {r.location.zip} {r.location.city}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        Ansprechpartner: {r.contactName}
        {r.notes && <span className="mt-1 block rounded bg-amber-50 p-2 text-amber-900">{r.notes}</span>}
      </p>
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        <span className={clsx('rounded-full px-2 py-0.5', r.vehiclesDrivable ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>{r.vehiclesDrivable ? 'fahrbereit' : 'nicht fahrbereit'}</span>
        <span className={clsx('rounded-full px-2 py-0.5', r.keysAvailable ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>{r.keysAvailable ? 'Schlüssel vorhanden' : 'Schlüssel fehlen'}</span>
        <span className={clsx('rounded-full px-2 py-0.5', r.papersAvailable ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>{r.papersAvailable ? 'Papiere vorhanden' : 'Papiere fehlen'}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={mapsUrl(r)} target="_blank" rel="noreferrer" onClick={() => r.status === 'ASSIGNED' && void setStatus('EN_ROUTE')} className="flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white font-medium text-slate-800">
          <Navigation className="h-5 w-5" aria-hidden /> Navigation
        </a>
        <a href={`tel:${r.contactPhone}`} className="flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white font-medium text-slate-800">
          <Phone className="h-5 w-5" aria-hidden /> Anrufen
        </a>
        {(r.status === 'ASSIGNED' || r.status === 'EN_ROUTE') && (
          <Button size="lg" variant="secondary" className="col-span-2" onClick={() => setStatus('ON_SITE')} loading={busy === 'ON_SITE'}>
            Angekommen
          </Button>
        )}
        {r.status === 'ON_SITE' && (
          <Button size="lg" className="col-span-2" onClick={() => setStatus('IN_PROGRESS')} loading={busy === 'IN_PROGRESS'}>
            Aufnahme starten
          </Button>
        )}
        {r.status === 'IN_PROGRESS' && (
          <Link href={`/aussendienst/auftrag/${r.id}`} className="col-span-2 flex h-12 items-center justify-center rounded-md bg-brand-600 font-medium text-white">
            Zur Fahrzeugaufnahme
          </Link>
        )}
        {r.status === 'COMPLETED' && (
          <Link href={`/aussendienst/auftrag/${r.id}`} className="col-span-2 flex h-12 items-center justify-center rounded-md border border-slate-300 font-medium text-slate-700">
            Auftrag ansehen
          </Link>
        )}
      </div>
      <ErrorAlert error={error} className="mt-2" />
    </article>
  );
}

/** Kompakter Upload-Status für die Kopfzeile der Aufnahme ("18/52 Bilder hochgeladen"). */
export function UploadStatusBar() {
  const { items, stats, online, processing } = useOutbox();
  const pending = items.filter((i) => i.status === 'pending').length;
  const failed = items.filter((i) => i.status === 'error').length;
  if (items.length === 0 && online) return null;
  return (
    <Link
      href="/aussendienst/uploads"
      className={clsx('mb-3 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm', !online ? 'bg-amber-100 text-amber-900' : failed ? 'bg-red-50 text-red-800' : 'bg-sky-50 text-sky-900')}
    >
      <span className="flex items-center gap-2">
        {online ? <CloudUpload className={clsx('h-4 w-4', processing && 'animate-pulse')} aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
        {!online ? 'Offline – Daten werden lokal gespeichert' : processing ? 'Wird hochgeladen …' : 'Upload-Warteschlange'}
      </span>
      <span className="tabular font-medium">
        {stats.filesTotal > 0 && `${stats.filesDone}/${stats.filesTotal} Bilder hochgeladen`}
        {pending > 0 && stats.filesTotal === 0 && `${pending} ausstehend`}
        {failed > 0 && ` · ${failed} Fehler`}
      </span>
    </Link>
  );
}
