'use client';

import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical, MapPin, Phone, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateDe, formatDateTimeDe, formatIsoDateDe, formatTimeDe, INSPECTION_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import { isoToLocalInput, localInputToIso } from '@/lib/format';
import type { InspectionRequestItem } from '@/lib/types';
import { Button, ErrorAlert, Field, Input, Modal, Select, StatusBadge, statusBadge, Textarea } from './ui';

export interface Inspector {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string;
}

export function defaultSlot(r: InspectionRequestItem): string {
  if (r.assignment?.scheduledAt) return isoToLocalInput(r.assignment.scheduledAt);
  if (r.scheduledAt) return isoToLocalInput(r.scheduledAt);
  return `${r.requestedDate}T${r.earliestTime}`;
}

export function RequestCard({ r, onAssign, onSchedule, onCancel, draggable = true, compact }: { r: InspectionRequestItem; onAssign?: () => void; onSchedule?: () => void; onCancel?: () => void; draggable?: boolean; compact?: boolean }) {
  const open = ['NEW', 'PLANNED', 'ASSIGNED'].includes(r.status);
  return (
    <article
      draggable={draggable && open}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/request-id', r.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={clsx('rounded-lg border border-slate-200 bg-white p-3 shadow-sm', draggable && open && 'cursor-grab active:cursor-grabbing')}
      aria-label={`Aufnahmeauftrag ${r.company.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          {draggable && open && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{r.company.name}</p>
            <p className="text-xs text-slate-500">{r.number}</p>
          </div>
        </div>
        {statusBadge(INSPECTION_STATUS_LABELS, r.status)}
      </div>
      <p className="mt-2 flex items-start gap-1 text-sm text-slate-700">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {r.location.street}, {r.location.zip} {r.location.city}
      </p>
      <p className="mt-1 text-sm">
        <strong>{r.vehicleCount}</strong> Fahrzeug(e) · Wunsch: {formatIsoDateDe(r.requestedDate)}, {r.earliestTime}–{r.latestTime}
      </p>
      {!compact && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
          <Phone className="h-3 w-3" aria-hidden /> {r.contactName}, {r.contactPhone}
        </p>
      )}
      {r.assignment ? (
        <p className="mt-2 flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-900">
          <UserRound className="h-3.5 w-3.5" aria-hidden /> {r.assignment.inspectorName} · {formatDateTimeDe(r.assignment.scheduledAt)}
        </p>
      ) : r.scheduledAt ? (
        <p className="mt-2 flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-xs text-sky-900">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden /> geplant {formatDateTimeDe(r.scheduledAt)}
        </p>
      ) : null}
      {r.vehiclesWaitingReview > 0 && (
        <p className="mt-2">
          <StatusBadge label={`Fahrzeuge warten auf Prüfung (${r.vehiclesWaitingReview})`} tone="warning" />
        </p>
      )}
      {!compact && r.notes && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">{r.notes}</p>}
      {open && (onAssign || onSchedule || onCancel) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {onAssign && (
            <Button size="sm" onClick={onAssign}>
              {r.assignment ? 'Umdisponieren' : 'Mitarbeiter zuweisen'}
            </Button>
          )}
          {onSchedule && !r.assignment && (
            <Button size="sm" variant="secondary" onClick={onSchedule}>
              Termin setzen
            </Button>
          )}
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Stornieren
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function InspectorColumn({ inspector, requests, onDropRequest, children }: { inspector: Inspector; requests: InspectionRequestItem[]; onDropRequest: (requestId: string) => void; children?: React.ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/request-id')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/request-id');
        if (id) onDropRequest(id);
      }}
      className={clsx('flex min-h-40 flex-col rounded-lg border-2 p-2 transition-colors', over ? 'border-brand-500 bg-brand-50' : 'border-dashed border-slate-300 bg-slate-50')}
      aria-label={`Spalte ${inspector.firstName} ${inspector.lastName}`}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <span className="font-semibold text-slate-800">
          {inspector.firstName} {inspector.lastName}
        </span>
        <span className="text-xs text-slate-500">{requests.length} Termin(e)</span>
      </header>
      <div className="space-y-2">
        {requests
          .slice()
          .sort((a, b) => (a.assignment?.scheduledAt ?? '').localeCompare(b.assignment?.scheduledAt ?? ''))
          .map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 bg-white p-2 text-sm">
              <p className="tabular font-semibold">{r.assignment ? formatTimeDe(r.assignment.scheduledAt) : '–'} · {r.company.name}</p>
              <p className="text-xs text-slate-600">
                {r.vehicleCount} Fzg. · {r.location.zip} {r.location.city} · {INSPECTION_STATUS_LABELS[r.status][0]}
              </p>
            </div>
          ))}
        {requests.length === 0 && <p className="px-1 py-4 text-center text-xs text-slate-500">Auftrag hierher ziehen</p>}
      </div>
      {children}
    </section>
  );
}

/** Dialog: Mitarbeiter zuweisen bzw. Termin setzen (barrierefreie Alternative zu Drag & Drop). */
export function AssignDialog({ request, inspectors, presetInspectorId, mode, onClose }: { request: InspectionRequestItem | null; inspectors: Inspector[]; presetInspectorId?: string | null; mode: 'assign' | 'schedule' | 'cancel'; onClose: () => void }) {
  const qc = useQueryClient();
  const [inspectorId, setInspectorId] = useState(presetInspectorId ?? request?.assignment?.inspectorUserId ?? '');
  const [when, setWhen] = useState(request ? defaultSlot(request) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setInspectorId(presetInspectorId ?? request?.assignment?.inspectorUserId ?? '');
    setWhen(request ? defaultSlot(request) : '');
    setNote('');
    setError(null);
  }, [request, presetInspectorId]);
  if (!request) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'assign') await api(`/admin/inspection-requests/${request.id}/assign`, { method: 'POST', body: { inspectorUserId: inspectorId, scheduledAt: localInputToIso(when), note: note || null } });
      else if (mode === 'schedule') await api(`/admin/inspection-requests/${request.id}/schedule`, { method: 'POST', body: { scheduledAt: localInputToIso(when), note: note || null } });
      else await api(`/inspection-requests/${request.id}/cancel`, { method: 'POST', body: { reason: note } });
      await qc.invalidateQueries({ queryKey: ['dispatch'] });
      await qc.invalidateQueries({ queryKey: ['inspection-requests'] });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const title = mode === 'assign' ? 'Mitarbeiter zuweisen' : mode === 'schedule' ? 'Termin setzen' : 'Auftrag stornieren';
  return (
    <Modal
      open
      onClose={onClose}
      title={`${title}: ${request.company.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant={mode === 'cancel' ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={(mode === 'assign' && !inspectorId) || (mode !== 'cancel' && !when) || (mode === 'cancel' && note.trim().length < 3)}>
            {title}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Wunschtermin: {formatIsoDateDe(request.requestedDate)}, {request.earliestTime}–{request.latestTime} Uhr · {request.vehicleCount} Fahrzeug(e)
        </p>
        {mode === 'assign' && (
          <Field label="Außendienstmitarbeiter" required>
            <Select value={inspectorId} onChange={(e) => setInspectorId(e.target.value)}>
              <option value="">Bitte wählen</option>
              {inspectors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.firstName} {i.lastName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode !== 'cancel' && (
          <Field label="Termin" required>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        )}
        <Field label={mode === 'cancel' ? 'Grund (Pflicht)' : 'Notiz (optional)'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <ErrorAlert error={error} />
      </div>
    </Modal>
  );
}

/** Wochenkalender: Termine nach (geplantem bzw. gewünschtem) Tag. */
export function WeekCalendar({ requests, weekStart, onWeek, onPick }: { requests: InspectionRequestItem[]; weekStart: Date; onWeek: (d: Date) => void; onPick: (r: InspectionRequestItem) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400_000));
  const key = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const byDay = new Map<string, InspectionRequestItem[]>();
  for (const r of requests) {
    const k = r.assignment?.scheduledAt ? key(new Date(r.assignment.scheduledAt)) : r.scheduledAt ? key(new Date(r.scheduledAt)) : r.requestedDate;
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onWeek(new Date(weekStart.getTime() - 7 * 86400_000))} icon={<ChevronLeft className="h-4 w-4" />}>
          Vorwoche
        </Button>
        <span className="text-sm font-medium">
          {formatDateDe(days[0])} – {formatDateDe(days[6])}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onWeek(new Date(weekStart.getTime() + 7 * 86400_000))}>
          Folgewoche <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const items = (byDay.get(key(d)) ?? []).sort((a, b) => (a.assignment?.scheduledAt ?? a.earliestTime).localeCompare(b.assignment?.scheduledAt ?? b.earliestTime));
          return (
            <div key={key(d)} className="min-h-32 rounded-lg border border-slate-200 bg-white p-2">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })}</p>
              <div className="space-y-1.5">
                {items.map((r) => (
                  <button key={r.id} onClick={() => onPick(r)} className={clsx('w-full rounded border px-2 py-1 text-left text-xs', r.assignment ? 'border-indigo-200 bg-indigo-50' : 'border-amber-200 bg-amber-50')}>
                    <span className="tabular font-semibold">{r.assignment ? formatTimeDe(r.assignment.scheduledAt) : `${r.earliestTime}?`}</span> {r.company.name}
                    <span className="block text-slate-600">
                      {r.vehicleCount} Fzg. · {r.assignment?.inspectorName ?? 'nicht zugewiesen'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Kartenansicht (Leaflet, OpenStreetMap). Positionen sind PLZ-Regions-Näherungen. */
export function RequestMap({ requests, onPick }: { requests: InspectionRequestItem[]; onPick: (r: InspectionRequestItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !ref.current) return;
      map = L.map(ref.current).setView([51.2, 10.4], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
      const located = requests.filter((r) => r.lat !== null && r.lng !== null);
      // Gleiche Region → leicht versetzen, damit Marker unterscheidbar bleiben.
      const seen = new Map<string, number>();
      for (const r of located) {
        const k = `${r.lat},${r.lng}`;
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        const lat = r.lat! + n * 0.03;
        const lng = r.lng! + n * 0.03;
        const color = r.assignment ? '#4f46e5' : r.status === 'NEW' ? '#d97706' : '#0284c7';
        L.circleMarker([lat, lng], { radius: 9, color, fillColor: color, fillOpacity: 0.8, weight: 2 })
          .addTo(map)
          .bindTooltip(`${r.company.name} – ${r.vehicleCount} Fzg. (${INSPECTION_STATUS_LABELS[r.status][0]})`)
          .on('click', () => onPick(r));
      }
      if (located.length) map.fitBounds(L.latLngBounds(located.map((r) => [r.lat!, r.lng!] as [number, number])).pad(0.3), { maxZoom: 9 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [requests, onPick]);
  return (
    <div>
      <div ref={ref} className="h-[560px] w-full rounded-lg border border-slate-200" role="application" aria-label="Karte der Aufnahmeaufträge" />
      <p className="mt-2 text-xs text-slate-500">
        Orange: ungeplant · Blau: geplant · Violett: zugewiesen. Positionen sind auf PLZ-Region genähert – die Navigation nutzt immer die vollständige Adresse.
      </p>
    </div>
  );
}
