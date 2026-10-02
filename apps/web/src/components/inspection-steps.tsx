'use client';

import clsx from 'clsx';
import { Camera, CheckCircle2, CircleAlert, Clock, FileText, Plus, ScanLine, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BATTERY_KIND_LABELS,
  BATTERY_KINDS,
  BODY_LABELS,
  BODY_TYPES,
  EMISSION_CLASS_LABELS,
  EMISSION_CLASSES,
  HOLDER_TYPE_LABELS,
  HOLDER_TYPES,
  DAMAGE_KIND_LABELS,
  DAMAGE_KINDS,
  DAMAGE_SEVERITIES,
  DAMAGE_SEVERITY_LABELS,
  DAMAGE_ZONE_LABELS,
  DEFAULT_PAINT_THRESHOLDS,
  DRIVE_LABELS,
  DRIVE_TYPES,
  DTC_STATUS_LABELS,
  DTC_STATUSES,
  EXTERIOR_PHOTO_SLOTS,
  FEATURE_LABELS,
  FEATURE_RESULT_LABELS,
  FEATURE_RESULTS,
  FEATURES,
  FUEL_LABELS,
  FUEL_TYPES,
  isPaintValueFlagged,
  PAINT_FLAG_HINT,
  PAINT_POINT_LABELS,
  PAINT_POINTS,
  PHOTO_SLOT_LABELS,
  PHOTO_QUALITY_LABELS,
  QUALITY_RETAKE_MESSAGE,
  REQUIRED_PHOTO_SLOTS,
  TIRE_POSITION_LABELS,
  TIRE_POSITIONS,
  TIRE_SEASON_LABELS,
  TIRE_SEASONS,
  TRANSMISSION_LABELS,
  TRANSMISSIONS,
  validateVin,
  VEHICLE_DOCUMENT_KIND_LABELS,
  VEHICLE_DOCUMENT_KINDS,
  type BatteryKind,
  type DamageKind,
  type DamageSeverity,
  type DamageZone,
  type DtcStatus,
  type Feature,
  type FeatureResult,
  type PhotoQuality,
  type PhotoSlot,
  type VehicleDocumentKind,
} from '@sd/shared';
import { api, errorMessage, newId, photoUrl } from '@/lib/api';
import { useMe } from '@/lib/session';
import { barcodeSupported, checkPhotoQuality, scanBarcode } from '@/lib/image';
import { outbox, useDraft, type OutboxItem } from '@/lib/outbox';
import type { VehicleFile } from '@/lib/types';
import { DamageSketch } from './damage-sketch';
import { Alert, Button, Field, Input, Modal, Select, StatusBadge, Textarea, YesNo } from './ui';

export interface StepProps {
  vehicleId: string;
  requestId: string | null;
  server: VehicleFile | null;
  pending: OutboxItem[];
  onNext: () => void;
}

// ------------------------------------------------------------------ Helfer
export function enqueueJson(vehicleId: string, label: string, method: OutboxItem['method'], path: string, body: unknown) {
  return outbox.enqueue({ id: newId(), vehicleId, kind: 'json', method, url: `/vehicles/${vehicleId}${path}`, body, label });
}

function enqueuePhoto(vehicleId: string, slot: PhotoSlot, file: Blob, overrideReason?: string) {
  const id = newId();
  const fields: Record<string, string> = { slot, clientUploadId: id, takenAt: new Date().toISOString() };
  if (overrideReason) fields.qualityOverrideReason = overrideReason;
  return outbox.enqueue({ id, vehicleId, kind: 'file', method: 'POST', url: `/vehicles/${vehicleId}/photos`, file, fileName: `${slot}.jpg`, fields, label: `Foto: ${PHOTO_SLOT_LABELS[slot]}` });
}

function StepFooter({ onSave, saveLabel = 'Speichern und weiter', disabled, children }: { onSave: () => void | Promise<void>; saveLabel?: string; disabled?: boolean; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="sticky bottom-16 z-10 -mx-3 mt-6 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:bottom-0">
      {children}
      <Button
        size="xl"
        className="w-full"
        disabled={disabled}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave();
          } finally {
            setBusy(false);
          }
        }}
      >
        {saveLabel}
      </Button>
    </div>
  );
}

function PendingHint({ pending, match }: { pending: OutboxItem[]; match: (i: OutboxItem) => boolean }) {
  const items = pending.filter(match);
  if (!items.length) return null;
  const failed = items.filter((i) => i.status === 'error');
  return failed.length ? (
    <Alert tone="danger" title="Übertragung fehlgeschlagen" className="mt-3">
      {failed.map((f) => (
        <p key={f.id}>
          {f.label}: {f.lastError}
        </p>
      ))}
    </Alert>
  ) : (
    <Alert tone="progress" className="mt-3">
      {items.length} Änderung(en) werden übertragen …
    </Alert>
  );
}

/** Kamera-Auslöser: öffnet auf Mobilgeräten direkt die Rückkamera. */
function CameraInput({ onFile, children, accept = 'image/*', capture = true, className, inputLabel }: { onFile: (f: File) => void; children: ReactNode; accept?: string; capture?: boolean; className?: string; inputLabel?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        aria-label={inputLabel}
        type="file"
        accept={accept}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
    </>
  );
}

/** Foto aufnehmen mit sofortiger Qualitätsprüfung (offline-fähig). */
function usePhotoCapture(vehicleId: string) {
  const [review, setReview] = useState<{ slot: PhotoSlot; file: File; quality: PhotoQuality } | null>(null);
  const [reason, setReason] = useState('');
  const capture = async (slot: PhotoSlot, file: File) => {
    const quality = await checkPhotoQuality(file);
    if (quality !== 'OK') {
      setReason('');
      setReview({ slot, file, quality });
      return null;
    }
    return enqueuePhoto(vehicleId, slot, file);
  };
  const dialog = (
    <Modal
      open={!!review}
      onClose={() => setReview(null)}
      title={QUALITY_RETAKE_MESSAGE}
      footer={
        <>
          <Button variant="secondary" disabled={reason.trim().length < 3} onClick={() => review && (void enqueuePhoto(vehicleId, review.slot, review.file, reason.trim()), setReview(null))}>
            Trotzdem verwenden
          </Button>
          <CameraInput onFile={(f) => review && (setReview(null), void capture(review.slot, f))} className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white">
            <Camera className="h-4 w-4" /> Neu aufnehmen
          </CameraInput>
        </>
      }
    >
      {review && (
        <div className="space-y-3">
          <Alert tone="danger">
            {review.quality === 'DARK' ? 'Das Foto ist zu dunkel.' : review.quality === 'BRIGHT' ? 'Das Foto ist überbelichtet.' : 'Das Foto ist unscharf oder verwackelt.'} {QUALITY_RETAKE_MESSAGE}
          </Alert>
          <Field label="Begründung, falls keine bessere Aufnahme möglich ist" hint="Wird dem Administrator angezeigt">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Motorraum bauartbedingt dunkel" />
          </Field>
        </div>
      )}
    </Modal>
  );
  return { capture, dialog };
}

function usePreviews(items: OutboxItem[]) {
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.file) m.set(i.id, URL.createObjectURL(i.file));
    return m;
  }, [items]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function SlotTile({ slot, vehicleId, server, pending, previews, onCapture, highlight }: { slot: PhotoSlot; vehicleId: string; server: VehicleFile | null; pending: OutboxItem[]; previews: Map<string, string>; onCapture: (slot: PhotoSlot, f: File) => void; highlight?: boolean }) {
  const local = [...pending].reverse().find((i) => i.kind === 'file' && i.fields?.slot === slot);
  const remote = server?.photos.find((p) => p.slot === slot && !p.replaced);
  const ok = remote && (remote.quality === 'OK' || remote.qualityOverride);
  return (
    <CameraInput inputLabel={`Foto aufnehmen: ${PHOTO_SLOT_LABELS[slot]}`} onFile={(f) => onCapture(slot, f)} className={clsx('relative flex aspect-[4/3] w-full flex-col overflow-hidden rounded-lg border-2 bg-slate-50 text-left', highlight ? 'border-red-500' : local ? 'border-sky-400' : ok ? 'border-emerald-500' : remote ? 'border-red-400' : 'border-dashed border-slate-300')}>
      {local && previews.get(local.id) ? (
        <img src={previews.get(local.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : remote ? (
        <img src={photoUrl(vehicleId, remote.id, 'thumb')} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="flex flex-1 items-center justify-center text-slate-400">
          <Camera className="h-7 w-7" aria-hidden />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 py-1 text-xs font-medium text-white">
        <span className="truncate">{PHOTO_SLOT_LABELS[slot]}</span>
        {local ? (
          local.status === 'error' ? <CircleAlert className="h-4 w-4 text-red-300" aria-label="Upload fehlgeschlagen" /> : <Clock className="h-4 w-4" aria-label="wartet auf Upload" />
        ) : ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-label="in Ordnung" />
        ) : remote ? (
          <CircleAlert className="h-4 w-4 text-red-300" aria-label="Qualität mangelhaft" />
        ) : null}
      </span>
    </CameraInput>
  );
}

// ------------------------------------------------------------------ Schritt 1: FIN
interface VinSuggestion {
  vin: string;
  confidence: 'high' | 'medium' | 'low';
  formatValid: boolean;
  checkDigitValid: boolean;
  errors: string[];
  uncertainPositions: number[];
  notes: string | null;
}

const CONFIDENCE_LABEL: Record<VinSuggestion['confidence'], string> = { high: 'hohe Sicherheit', medium: 'mittlere Sicherheit', low: 'geringe Sicherheit' };

export function VinStep({ vehicleId, server, pending, onNext }: StepProps) {
  const me = useMe();
  const aiVision = me.data?.features.aiVision ?? false;
  const [vin, setVin] = useDraft(`vin:${vehicleId}`, server?.vin ?? '');
  const [scanError, setScanError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ state: 'idle' } | { state: 'busy' } | { state: 'done'; suggestion: VinSuggestion } | { state: 'error'; message: string }>({ state: 'idle' });
  const { capture, dialog } = usePhotoCapture(vehicleId);
  const previews = usePreviews(pending);
  const check = vin ? validateVin(vin) : null;
  const vinItems = pending.filter((i) => i.url.endsWith('/vin'));
  const duplicate = vinItems.find((i) => i.status === 'error' && /früher auf der Plattform/.test(i.lastError ?? ''));
  const hasVinPhoto = server?.photos.some((p) => p.slot === 'VIN_PLATE' && !p.replaced) ?? false;

  const scan = async (file: File) => {
    setScanError(null);
    const found = await scanBarcode(file).catch(() => null);
    if (found) setVin(found);
    else setScanError('Kein FIN-Barcode erkannt. Bitte FIN manuell eingeben.');
  };
  /** KI liest die FIN vom Foto; sie wird nur als Vorschlag eingetragen und vom Mitarbeiter bestätigt. */
  const recognize = async (file: File | null) => {
    if (!aiVision) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setAi({ state: 'error', message: 'FIN-Erkennung benötigt eine Internetverbindung. Das Foto ist gespeichert; bitte FIN manuell eingeben oder später erneut erkennen lassen.' });
      return;
    }
    setAi({ state: 'busy' });
    try {
      let suggestion: VinSuggestion;
      if (file) {
        const fd = new FormData();
        fd.append('file', file, file.name || 'fin.jpg');
        suggestion = await api<VinSuggestion>(`/vehicles/${vehicleId}/vin/recognize`, { method: 'POST', body: fd });
      } else {
        suggestion = await api<VinSuggestion>(`/vehicles/${vehicleId}/vin/recognize`, { method: 'POST', body: {} });
      }
      setVin(suggestion.vin);
      setAi({ state: 'done', suggestion });
    } catch (e) {
      setAi({ state: 'error', message: errorMessage(e) });
    }
  };
  const save = async () => {
    if (!check?.formatValid) return;
    await enqueueJson(vehicleId, 'FIN', 'POST', '/vin', { vin: check.normalized });
    onNext();
  };
  return (
    <div className="space-y-4">
      <Field label="FIN / VIN" required hint="17 Zeichen, ohne I, O, Q" error={check && !check.formatValid ? check.errors[0] : undefined}>
        <Input value={vin} onChange={(e) => (setVin(e.target.value.toUpperCase()), ai.state === 'done' && setAi({ state: 'idle' }))} className="h-14 font-mono text-xl tracking-wider" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={20} />
      </Field>
      {check?.formatValid && !check.checkDigitValid && <Alert tone="info">Prüfziffer nicht bestätigt (bei europäischen FIN üblich). Bitte mit dem Fahrzeugschein abgleichen.</Alert>}
      <div className="grid grid-cols-2 gap-2">
        {barcodeSupported() && (
          <CameraInput inputLabel="FIN-Barcode fotografieren" onFile={scan} className="flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white font-medium">
            <ScanLine className="h-5 w-5" /> Barcode scannen
          </CameraInput>
        )}
        <div className={barcodeSupported() ? '' : 'col-span-2'}>
          <SlotTile
            slot="VIN_PLATE"
            vehicleId={vehicleId}
            server={server}
            pending={pending}
            previews={previews}
            onCapture={(s, f) => {
              void capture(s, f);
              void recognize(f);
            }}
          />
        </div>
      </div>
      {aiVision && (
        <div className="space-y-2">
          {ai.state === 'idle' && <p className="text-xs text-slate-500">{hasVinPhoto ? 'Die FIN kann aus dem gespeicherten FIN-Foto gelesen werden.' : 'Nach dem FIN-Foto wird die FIN automatisch gelesen und hier eingetragen.'}</p>}
          {ai.state === 'busy' && (
            <p className="flex items-center gap-2 text-sm text-slate-700" role="status">
              <Sparkles className="h-4 w-4 animate-pulse text-brand-700" aria-hidden /> FIN wird vom Foto gelesen …
            </p>
          )}
          {ai.state === 'done' && (
            <Alert tone={ai.suggestion.confidence === 'high' && ai.suggestion.formatValid ? 'success' : 'warning'} title={`FIN vom Foto gelesen (${CONFIDENCE_LABEL[ai.suggestion.confidence]})`}>
              <p>Bitte jedes Zeichen mit dem Typenschild oder Fahrzeugschein vergleichen, bevor Sie weitergehen.</p>
              {ai.suggestion.uncertainPositions.length > 0 && <p className="mt-1">Unsicher gelesen: Position {ai.suggestion.uncertainPositions.join(', ')}.</p>}
              {!ai.suggestion.formatValid && <p className="mt-1">{ai.suggestion.errors[0]}</p>}
              {ai.suggestion.notes && <p className="mt-1 text-xs">{ai.suggestion.notes}</p>}
            </Alert>
          )}
          {ai.state === 'error' && <Alert tone="warning">{ai.message}</Alert>}
          {(hasVinPhoto || ai.state === 'error') && ai.state !== 'busy' && (
            <Button variant="secondary" size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={() => void recognize(null)} disabled={!hasVinPhoto}>
              FIN aus gespeichertem Foto lesen
            </Button>
          )}
        </div>
      )}
      {!barcodeSupported() && !aiVision && <p className="text-xs text-slate-500">Barcode-Scan wird von diesem Browser nicht unterstützt. Das FIN-Foto wird zur Kontrolle gespeichert.</p>}
      {scanError && <Alert tone="warning">{scanError}</Alert>}
      {duplicate && (
        <Alert tone="warning" title="FIN bereits bekannt">
          <p>{duplicate.lastError}</p>
          <Button
            size="sm"
            className="mt-2"
            onClick={async () => {
              await outbox.discard(duplicate.id);
              await enqueueJson(vehicleId, 'FIN (Wiederaufnahme bestätigt)', 'POST', '/vin', { vin: check?.normalized ?? vin, confirmDuplicate: true });
            }}
          >
            Wiederaufnahme bestätigen
          </Button>
        </Alert>
      )}
      <PendingHint pending={pending} match={(i) => i.url.endsWith('/vin') && i !== duplicate} />
      {dialog}
      <StepFooter onSave={save} disabled={!check?.formatValid} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 2: Kilometer
export function MileageStep({ vehicleId, server, pending, onNext }: StepProps) {
  const [km, setKm] = useDraft(`km:${vehicleId}`, server?.mileageKm?.toString() ?? '');
  const { capture, dialog } = usePhotoCapture(vehicleId);
  const previews = usePreviews(pending);
  const hasOdometer = pending.some((i) => i.fields?.slot === 'ODOMETER') || server?.photos.some((p) => p.slot === 'ODOMETER' && !p.replaced);
  const valid = /^\d{1,7}$/.test(km.replace(/\./g, ''));
  return (
    <div className="space-y-4">
      <Field label="Kilometerstand" required htmlFor={`km-${vehicleId}`}>
        <div className="relative">
          <Input id={`km-${vehicleId}`} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d.]/g, ''))} className="h-14 pr-12 text-xl" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">km</span>
        </div>
      </Field>
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">
          Tachofoto <span className="text-red-600">*</span>
        </p>
        <div className="max-w-xs">
          <SlotTile slot="ODOMETER" vehicleId={vehicleId} server={server} pending={pending} previews={previews} onCapture={(s, f) => void capture(s, f)} highlight={!hasOdometer} />
        </div>
      </div>
      {dialog}
      <PendingHint pending={pending} match={(i) => i.label === 'Kilometerstand'} />
      <StepFooter disabled={!valid || !hasOdometer} onSave={async () => (await enqueueJson(vehicleId, 'Kilometerstand', 'PATCH', '', { mileageKm: Number(km.replace(/\./g, '')) }), onNext())} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 3: Dokumente
export function DocumentsStep({ vehicleId, server, pending, onNext }: StepProps) {
  const upload = (kind: VehicleDocumentKind, file: File) => {
    const id = newId();
    void outbox.enqueue({ id, vehicleId, kind: 'file', method: 'POST', url: `/vehicles/${vehicleId}/documents`, file, fileName: file.name || `${kind}.jpg`, fields: { kind, clientUploadId: id }, label: `Dokument: ${VEHICLE_DOCUMENT_KIND_LABELS[kind]}` });
  };
  return (
    <div className="space-y-3">
      <Alert tone="info">Sensible Dokumente (z. B. Zulassungsbescheinigung) sind für Käufer erst nach Freigabe durch den Administrator sichtbar.</Alert>
      {VEHICLE_DOCUMENT_KINDS.map((kind) => {
        const remote = server?.documents.filter((d) => d.kind === kind) ?? [];
        const local = pending.filter((i) => i.fields?.kind === kind && i.url.endsWith('/documents'));
        return (
          <div key={kind} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div>
              <p className="font-medium">{VEHICLE_DOCUMENT_KIND_LABELS[kind]}</p>
              <p className="text-xs text-slate-500">
                {remote.length > 0 && `${remote.length} hochgeladen`}
                {local.length > 0 && ` · ${local.length} wartet`}
                {remote.length + local.length === 0 && (kind === 'REGISTRATION_1' ? 'empfohlen' : 'optional')}
              </p>
            </div>
            <div className="flex gap-2">
              <CameraInput inputLabel={`Dokument fotografieren: ${VEHICLE_DOCUMENT_KIND_LABELS[kind]}`} onFile={(f) => upload(kind, f)} className="flex h-11 items-center gap-1 rounded-md bg-brand-600 px-3 text-sm font-medium text-white">
                <Camera className="h-4 w-4" /> Foto
              </CameraInput>
              <CameraInput inputLabel={`Dokument-Datei: ${VEHICLE_DOCUMENT_KIND_LABELS[kind]}`} onFile={(f) => upload(kind, f)} capture={false} accept="application/pdf,image/*" className="flex h-11 items-center gap-1 rounded-md border border-slate-300 px-3 text-sm font-medium">
                <FileText className="h-4 w-4" /> Datei
              </CameraInput>
            </div>
          </div>
        );
      })}
      <StepFooter onSave={onNext} saveLabel="Weiter" />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 4: Stammdaten
export function BasicDataStep({ vehicleId, server, onNext }: StepProps) {
  const [d, setD] = useDraft(`basic:${vehicleId}`, {
    licensePlate: server?.licensePlate ?? '',
    make: server?.make ?? '',
    model: server?.model ?? '',
    variant: server?.variant ?? '',
    firstRegistration: server?.firstRegistration ?? '',
    fuel: server?.fuel ?? '',
    powerKw: server?.powerKw?.toString() ?? '',
    displacementCcm: server?.displacementCcm?.toString() ?? '',
    transmission: server?.transmission ?? '',
    drive: server?.drive ?? '',
    body: server?.body ?? '',
    color: server?.color ?? '',
    doors: server?.doors?.toString() ?? '',
    seats: server?.seats?.toString() ?? '',
    ownersCount: server?.ownersCount?.toString() ?? '',
    huUntil: server?.huUntil ?? '',
    origin: server?.origin ?? '',
    emissionClass: server?.emissionClass ?? '',
    holderType: server?.holderType ?? '',
    keysCount: server?.keysCount?.toString() ?? '',
    equipment: (server?.equipment ?? []).join('\n'),
  });
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((o) => ({ ...o, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid = d.make && d.model && d.firstRegistration && d.fuel && d.transmission;
  const save = async () => {
    await enqueueJson(vehicleId, 'Stammdaten', 'PATCH', '', {
      licensePlate: d.licensePlate || null,
      make: d.make,
      model: d.model,
      variant: d.variant || null,
      firstRegistration: d.firstRegistration || null,
      fuel: d.fuel,
      powerKw: num(d.powerKw),
      displacementCcm: num(d.displacementCcm),
      transmission: d.transmission,
      drive: d.drive || null,
      body: d.body || null,
      color: d.color || null,
      doors: num(d.doors),
      seats: num(d.seats),
      ownersCount: num(d.ownersCount),
      huUntil: d.huUntil || null,
      origin: d.origin || null,
      emissionClass: d.emissionClass || null,
      holderType: d.holderType || null,
      keysCount: num(d.keysCount),
      equipment: d.equipment.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    });
    onNext();
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Hersteller" required><Input value={d.make} onChange={set('make')} /></Field>
      <Field label="Modell" required><Input value={d.model} onChange={set('model')} /></Field>
      <Field label="Variante"><Input value={d.variant} onChange={set('variant')} /></Field>
      <Field label="Kennzeichen"><Input value={d.licensePlate} onChange={set('licensePlate')} autoCapitalize="characters" /></Field>
      <Field label="Erstzulassung" required><Input type="date" value={d.firstRegistration} onChange={set('firstRegistration')} /></Field>
      <Field label="Kraftstoff" required>
        <Select value={d.fuel} onChange={set('fuel')}>
          <option value="">Bitte wählen</option>
          {FUEL_TYPES.map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}
        </Select>
      </Field>
      <Field label="Leistung (kW)"><Input inputMode="numeric" value={d.powerKw} onChange={set('powerKw')} /></Field>
      <Field label="Hubraum (cm³)"><Input inputMode="numeric" value={d.displacementCcm} onChange={set('displacementCcm')} /></Field>
      <Field label="Getriebe" required>
        <Select value={d.transmission} onChange={set('transmission')}>
          <option value="">Bitte wählen</option>
          {TRANSMISSIONS.map((t) => <option key={t} value={t}>{TRANSMISSION_LABELS[t]}</option>)}
        </Select>
      </Field>
      <Field label="Antrieb">
        <Select value={d.drive} onChange={set('drive')}>
          <option value="">–</option>
          {DRIVE_TYPES.map((t) => <option key={t} value={t}>{DRIVE_LABELS[t]}</option>)}
        </Select>
      </Field>
      <Field label="Karosserie">
        <Select value={d.body} onChange={set('body')}>
          <option value="">–</option>
          {BODY_TYPES.map((t) => <option key={t} value={t}>{BODY_LABELS[t]}</option>)}
        </Select>
      </Field>
      <Field label="Farbe"><Input value={d.color} onChange={set('color')} /></Field>
      <Field label="Türen"><Input inputMode="numeric" value={d.doors} onChange={set('doors')} /></Field>
      <Field label="Sitzplätze"><Input inputMode="numeric" value={d.seats} onChange={set('seats')} /></Field>
      <Field label="Anzahl Halter"><Input inputMode="numeric" value={d.ownersCount} onChange={set('ownersCount')} /></Field>
      <Field label="HU bis"><Input type="month" value={d.huUntil} onChange={set('huUntil')} /></Field>
      <Field label="Herkunft"><Input value={d.origin} onChange={set('origin')} placeholder="z. B. Deutsches Fahrzeug" /></Field>
      <Field label="Schadstoffklasse">
        <Select value={d.emissionClass ?? ''} onChange={set('emissionClass')}>
          <option value="">–</option>
          {EMISSION_CLASSES.map((c) => <option key={c} value={c}>{EMISSION_CLASS_LABELS[c]}</option>)}
        </Select>
      </Field>
      <Field label="Fahrzeughalter">
        <Select value={d.holderType ?? ''} onChange={set('holderType')}>
          <option value="">–</option>
          {HOLDER_TYPES.map((h) => <option key={h} value={h}>{HOLDER_TYPE_LABELS[h]}</option>)}
        </Select>
      </Field>
      <Field label="Anzahl Schlüssel"><Input inputMode="numeric" value={d.keysCount} onChange={set('keysCount')} /></Field>
      <Field label="Ausstattung" hint="Ein Merkmal pro Zeile" className="sm:col-span-2">
        <Textarea value={d.equipment} onChange={set('equipment')} rows={5} />
      </Field>
      <div className="sm:col-span-2">
        <StepFooter onSave={save} disabled={!valid} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 5: Pflichtfotos
export function PhotosStep({ vehicleId, server, pending, onNext }: StepProps) {
  const { capture, dialog } = usePhotoCapture(vehicleId);
  const previews = usePreviews(pending);
  const requested = new Set(server?.requestedPhotoSlots ?? []);
  const done = REQUIRED_PHOTO_SLOTS.filter((s) => pending.some((i) => i.fields?.slot === s && i.status !== 'error') || server?.photos.some((p) => p.slot === s && !p.replaced && (p.quality === 'OK' || p.qualityOverride))).length;
  const extras = [...(server?.photos.filter((p) => p.slot === 'EXTRA' && !p.replaced) ?? [])];
  const localExtras = pending.filter((i) => i.fields?.slot === 'EXTRA');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Pflichtfotos</p>
        <p className="tabular font-semibold">
          {done}/{REQUIRED_PHOTO_SLOTS.length}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={REQUIRED_PHOTO_SLOTS.length}>
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / REQUIRED_PHOTO_SLOTS.length) * 100}%` }} />
      </div>
      <Alert tone="info">Außenaufnahmen: Fahrzeug vollständig im Bild, ruhig halten, bei Tageslicht. Unscharfe oder dunkle Fotos werden sofort erkannt.</Alert>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {REQUIRED_PHOTO_SLOTS.map((slot) => (
          <div key={slot}>
            <SlotTile slot={slot} vehicleId={vehicleId} server={server} pending={pending} previews={previews} onCapture={(s, f) => void capture(s, f)} highlight={requested.has(slot)} />
            {EXTERIOR_PHOTO_SLOTS.includes(slot) && <p className="mt-0.5 text-[10px] text-slate-500">Fahrzeug vollständig im Bild</p>}
            {requested.has(slot) && <p className="mt-0.5 text-[11px] font-medium text-red-700">Vom Admin neu angefordert</p>}
            {(() => {
              // Beanstandung aus der serverseitigen Prüfung (z. B. KI: Fahrzeug abgeschnitten) – Foto gilt bis zur Neuaufnahme als fehlend.
              const bad = server?.photos.find((p) => p.slot === slot && !p.replaced && p.quality !== 'OK' && p.quality !== 'PENDING' && !p.qualityOverride);
              return bad ? (
                <p className="mt-0.5 text-[11px] font-medium text-red-700" role="status">
                  {PHOTO_QUALITY_LABELS[bad.quality][0]} – bitte neu aufnehmen
                </p>
              ) : null;
            })()}
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Zusatzfotos ({extras.length + localExtras.length})</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {extras.map((p) => (
            <img key={p.id} src={photoUrl(vehicleId, p.id, 'thumb')} alt="Zusatzfoto" className="aspect-[4/3] w-full rounded-lg object-cover" />
          ))}
          {localExtras.map((i) => (
            <img key={i.id} src={previews.get(i.id)} alt="Zusatzfoto (wartet)" className="aspect-[4/3] w-full rounded-lg border-2 border-sky-400 object-cover" />
          ))}
          <CameraInput inputLabel="Zusatzfoto aufnehmen" onFile={(f) => void capture('EXTRA', f)} className="flex aspect-[4/3] items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-500">
            <Plus className="h-6 w-6" aria-hidden /><span className="sr-only">Kamera für Zusatzfoto öffnen</span>
          </CameraInput>
        </div>
      </div>
      {dialog}
      <StepFooter onSave={onNext} saveLabel={done < REQUIRED_PHOTO_SLOTS.length ? `Weiter (${REQUIRED_PHOTO_SLOTS.length - done} fehlen noch)` : 'Weiter'} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 6: Schäden
interface DamageForm {
  id: string;
  kind: DamageKind;
  size: string;
  severity: DamageSeverity;
  description: string;
  photoIds: string[];
}

export function DamagesStep({ vehicleId, server, pending, onNext }: StepProps) {
  const [zone, setZone] = useState<DamageZone | null>(null);
  const [form, setForm] = useState<DamageForm | null>(null);
  const previews = usePreviews(pending);
  const localDamages = pending
    .filter((i) => i.url.endsWith('/damages') && i.method === 'POST')
    .map((i) => {
      const b = i.body as Omit<DamageForm, 'id'> & { clientId: string; zone: DamageZone; size: string | null; description: string | null };
      return { ...b, id: b.clientId, size: b.size ?? '', description: b.description ?? '' };
    });
  const all = [...(server?.damages ?? []), ...localDamages.filter((l) => !server?.damages.some((d) => d.id === l.id))];
  const counts: Partial<Record<DamageZone, number>> = {};
  for (const d of all) counts[d.zone] = (counts[d.zone] ?? 0) + 1;

  const open = (z: DamageZone) => {
    setZone(z);
    setForm({ id: newId(), kind: 'SCRATCH', size: '', severity: 'LOW', description: '', photoIds: [] });
  };
  const addPhoto = async (file: File) => {
    if (!form) return;
    const item = await enqueuePhoto(vehicleId, 'DAMAGE', file);
    setForm((f) => (f ? { ...f, photoIds: [...f.photoIds, item.id] } : f));
  };
  const save = async () => {
    if (!form || !zone) return;
    await outbox.enqueue({
      id: newId(),
      vehicleId,
      kind: 'json',
      method: 'POST',
      url: `/vehicles/${vehicleId}/damages`,
      body: { clientId: form.id, zone, kind: form.kind, size: form.size || null, severity: form.severity, description: form.description || null, photoIds: form.photoIds },
      label: `Schaden: ${DAMAGE_ZONE_LABELS[zone]}`,
    });
    setForm(null);
    setZone(null);
  };
  const remove = async (id: string) => {
    await enqueueJson(vehicleId, 'Schaden entfernen', 'DELETE', `/damages/${id}`, undefined);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Tippen Sie auf den beschädigten Bereich.</p>
      <DamageSketch counts={counts} selected={zone} onSelect={open} />
      {all.length > 0 && (
        <ul className="space-y-2">
          {all.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <div>
                <p className="font-medium">
                  {DAMAGE_ZONE_LABELS[d.zone]} · {DAMAGE_KIND_LABELS[d.kind]}
                </p>
                <p className="text-slate-600">
                  {DAMAGE_SEVERITY_LABELS[d.severity]}
                  {d.size && ` · ${d.size}`} · {d.photoIds.length} Foto(s)
                </p>
                {d.description && <p className="text-slate-600">{d.description}</p>}
              </div>
              {server?.damages.some((s) => s.id === d.id) ? (
                <button className="rounded p-2 text-slate-500 hover:text-red-600" onClick={() => void remove(d.id)} aria-label="Schaden entfernen">
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : (
                <StatusBadge label="wartet" tone="progress" />
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!form}
        onClose={() => (setForm(null), setZone(null))}
        title={zone ? `Schaden: ${DAMAGE_ZONE_LABELS[zone]}` : 'Schaden'}
        footer={
          <Button onClick={save} disabled={!form}>
            Schaden speichern
          </Button>
        }
      >
        {form && (
          <div className="space-y-3">
            <Field label="Schadenart" required>
              <div className="grid grid-cols-2 gap-1.5">
                {DAMAGE_KINDS.map((k) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, kind: k })} aria-pressed={form.kind === k} className={clsx('rounded-md border px-2 py-2 text-left text-sm', form.kind === k ? 'border-brand-600 bg-brand-50 font-medium text-brand-800' : 'border-slate-200')}>
                    {DAMAGE_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Größe">
                <Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="z. B. 3 cm" />
              </Field>
              <Field label="Stärke" required>
                <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as DamageSeverity })}>
                  {DAMAGE_SEVERITIES.map((s) => <option key={s} value={s}>{DAMAGE_SEVERITY_LABELS[s]}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Beschreibung">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium">Detailfotos</p>
              <div className="grid grid-cols-3 gap-2">
                {form.photoIds.map((pid) => (
                  <img key={pid} src={previews.get(pid) ?? photoUrl(vehicleId, pid, 'thumb')} alt="Detailfoto" className="aspect-square w-full rounded object-cover" />
                ))}
                <CameraInput inputLabel="Detailfoto aufnehmen" onFile={addPhoto} className="flex aspect-square items-center justify-center rounded border-2 border-dashed border-slate-300 text-slate-500">
                  <Camera className="h-6 w-6" aria-hidden /><span className="sr-only">Kamera für Detailfoto öffnen</span>
                </CameraInput>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <StepFooter onSave={onNext} saveLabel="Weiter" />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 7: PDR
export function PdrStep({ vehicleId, server, pending, onNext }: StepProps) {
  const [d, setD] = useDraft(`pdr:${vehicleId}`, {
    performed: server?.pdr?.performed ?? null,
    lineboardPhotoId: server?.pdr?.lineboardPhotoId ?? null,
    dentCount: server?.pdr?.dentCount?.toString() ?? '',
    positions: server?.pdr?.positions ?? '',
    size: server?.pdr?.size ?? '',
    paintDamaged: server?.pdr?.paintDamaged ?? null,
  } as { performed: boolean | null; lineboardPhotoId: string | null; dentCount: string; positions: string; size: string; paintDamaged: boolean | null });
  const previews = usePreviews(pending);
  const addLineboard = async (file: File) => {
    const item = await enqueuePhoto(vehicleId, 'PDR_LINEBOARD', file);
    setD((o) => ({ ...o, lineboardPhotoId: item.id }));
  };
  const save = async () => {
    await enqueueJson(vehicleId, 'Dellenprüfung', 'PUT', '/pdr', {
      performed: d.performed ?? false,
      lineboardPhotoId: d.lineboardPhotoId,
      dentCount: d.dentCount ? Number(d.dentCount) : null,
      positions: d.positions || null,
      size: d.size || null,
      paintDamaged: d.paintDamaged,
    });
    onNext();
  };
  return (
    <div className="space-y-4">
      <YesNo label="Dellenprüfung durchgeführt" value={d.performed} onChange={(v) => setD((o) => ({ ...o, performed: v }))} />
      {d.performed && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">PDR-Lineboard-Foto (optional)</p>
            <CameraInput inputLabel="PDR-Lineboard-Foto aufnehmen" onFile={addLineboard} className="flex aspect-[4/3] w-48 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 text-slate-500">
              {d.lineboardPhotoId ? (
                <img src={previews.get(d.lineboardPhotoId) ?? photoUrl(vehicleId, d.lineboardPhotoId, 'thumb')} alt="Lineboard" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-6 w-6" />
              )}
            </CameraInput>
          </div>
          <Field label="Anzahl Dellen"><Input inputMode="numeric" value={d.dentCount} onChange={(e) => setD((o) => ({ ...o, dentCount: e.target.value }))} /></Field>
          <Field label="Größe"><Input value={d.size} onChange={(e) => setD((o) => ({ ...o, size: e.target.value }))} /></Field>
          <Field label="Position" className="sm:col-span-2"><Input value={d.positions} onChange={(e) => setD((o) => ({ ...o, positions: e.target.value }))} /></Field>
          <YesNo label="Lack beschädigt" value={d.paintDamaged} onChange={(v) => setD((o) => ({ ...o, paintDamaged: v }))} />
        </div>
      )}
      <StepFooter onSave={save} disabled={d.performed === null} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 8: Lack
export function PaintStep({ vehicleId, server, onNext }: StepProps) {
  const initial = Object.fromEntries(PAINT_POINTS.map((p) => [p, server?.paint.find((x) => x.point === p)?.valueUm?.toString() ?? '']));
  const [values, setValues] = useDraft<Record<string, string>>(`paint:${vehicleId}`, initial);
  const filled = PAINT_POINTS.filter((p) => values[p]?.trim());
  const save = async () => {
    await enqueueJson(vehicleId, 'Lackschichtmessung', 'PUT', '/paint', { measurements: filled.map((point) => ({ point, valueUm: Number(values[point]) })) });
    onNext();
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PAINT_POINTS.map((p) => {
          const v = values[p] ?? '';
          const flagged = v !== '' && isPaintValueFlagged(Number(v), DEFAULT_PAINT_THRESHOLDS);
          return (
            <Field key={p} label={PAINT_POINT_LABELS[p]} htmlFor={`paint-${p}`}>
              <div className="relative">
                <Input id={`paint-${p}`} inputMode="numeric" value={v} onChange={(e) => setValues((o) => ({ ...o, [p]: e.target.value.replace(/\D/g, '') }))} className={clsx('pr-10 text-lg', flagged && 'border-amber-500 bg-amber-50')} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">µm</span>
              </div>
              {flagged && <span className="text-xs font-medium text-amber-800">Auffälliger Wert</span>}
            </Field>
          );
        })}
      </div>
      {PAINT_POINTS.some((p) => values[p] && isPaintValueFlagged(Number(values[p]))) && <Alert tone="warning">{PAINT_FLAG_HINT}</Alert>}
      <StepFooter onSave={save} saveLabel={`Speichern und weiter (${filled.length}/${PAINT_POINTS.length})`} disabled={filled.length === 0} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 9: Reifen
export function TiresStep({ vehicleId, server, onNext }: StepProps) {
  const initial = Object.fromEntries(
    TIRE_POSITIONS.map((pos) => {
      const t = server?.tires.find((x) => x.position === pos);
      return [pos, { brand: t?.brand ?? '', dimension: t?.dimension ?? '', season: t?.season ?? '', treadMm: t?.treadMm?.toString() ?? '', damage: t?.damage ?? '', dot: t?.dot ?? '', rimCondition: t?.rimCondition ?? '' }];
    }),
  ) as Record<string, { brand: string; dimension: string; season: string; treadMm: string; damage: string; dot: string; rimCondition: string }>;
  const [tires, setTires] = useDraft(`tires:${vehicleId}`, initial);
  const set = (pos: string, k: string, v: string) => setTires((o) => ({ ...o, [pos]: { ...o[pos]!, [k]: v } }));
  const copyFront = () => setTires((o) => ({ ...o, FR: { ...o.FL! }, RL: { ...o.FL!, treadMm: o.RL?.treadMm ?? '' }, RR: { ...o.FL!, treadMm: o.RR?.treadMm ?? '' } }));
  const save = async () => {
    await enqueueJson(vehicleId, 'Reifen', 'PUT', '/tires', {
      tires: TIRE_POSITIONS.map((position) => {
        const t = tires[position]!;
        return { position, brand: t.brand || null, dimension: t.dimension || null, season: t.season || null, treadMm: t.treadMm ? Number(t.treadMm.replace(',', '.')) : null, damage: t.damage || null, dot: t.dot || null, rimCondition: t.rimCondition || null };
      }),
    });
    onNext();
  };
  return (
    <div className="space-y-4">
      <Button variant="secondary" size="sm" onClick={copyFront}>
        Hersteller/Dimension von „vorne links“ übernehmen
      </Button>
      {TIRE_POSITIONS.map((pos) => (
        <fieldset key={pos} className="rounded-lg border border-slate-200 bg-white p-3">
          <legend className="px-1 text-sm font-semibold">{TIRE_POSITION_LABELS[pos]}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Hersteller"><Input value={tires[pos]!.brand} onChange={(e) => set(pos, 'brand', e.target.value)} /></Field>
            <Field label="Dimension"><Input value={tires[pos]!.dimension} onChange={(e) => set(pos, 'dimension', e.target.value)} placeholder="225/45 R17" /></Field>
            <Field label="Saison">
              <Select value={tires[pos]!.season} onChange={(e) => set(pos, 'season', e.target.value)}>
                <option value="">–</option>
                {TIRE_SEASONS.map((s) => <option key={s} value={s}>{TIRE_SEASON_LABELS[s]}</option>)}
              </Select>
            </Field>
            <Field label="Profil (mm)"><Input inputMode="decimal" value={tires[pos]!.treadMm} onChange={(e) => set(pos, 'treadMm', e.target.value)} /></Field>
            <Field label="DOT"><Input inputMode="numeric" value={tires[pos]!.dot} onChange={(e) => set(pos, 'dot', e.target.value)} placeholder="KKJJ" /></Field>
            <Field label="Beschädigung" className="sm:col-span-3"><Input value={tires[pos]!.damage} onChange={(e) => set(pos, 'damage', e.target.value)} placeholder="keine" /></Field>
            <Field label="Felgenzustand" className="col-span-2 sm:col-span-4"><Input value={tires[pos]!.rimCondition} onChange={(e) => set(pos, 'rimCondition', e.target.value)} placeholder="z. B. Bordsteinschaden 2 cm" /></Field>
          </div>
        </fieldset>
      ))}
      <StepFooter onSave={save} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 10: OBD
export function ObdStep({ vehicleId, server, onNext }: StepProps) {
  const [d, setD] = useDraft(`obd:${vehicleId}`, { device: '', performedAt: '', ecus: '', notes: '', codes: [] as { code: string; description: string; status: DtcStatus }[] });
  const existing = server?.diagnostics.length ?? 0;
  const save = async () => {
    if (!d.device) return onNext();
    await enqueueJson(vehicleId, 'OBD-Bericht', 'POST', '/diagnostics', {
      clientId: newId(),
      device: d.device,
      performedAt: d.performedAt ? new Date(d.performedAt).toISOString() : new Date().toISOString(),
      ecus: d.ecus.split(',').map((s) => s.trim()).filter(Boolean),
      notes: d.notes || null,
      codes: d.codes.filter((c) => c.code.trim()).map((c) => ({ code: c.code.trim(), description: c.description || null, status: c.status })),
    });
    setD({ device: '', performedAt: '', ecus: '', notes: '', codes: [] });
    onNext();
  };
  return (
    <div className="space-y-3">
      <Alert tone="info">Optional. Fehlercodes werden unverändert gespeichert und können über die Plattform nicht gelöscht werden.{existing > 0 && ` Bereits ${existing} Bericht(e) gespeichert.`}</Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Diagnosegerät"><Input value={d.device} onChange={(e) => setD((o) => ({ ...o, device: e.target.value }))} /></Field>
        <Field label="Datum/Uhrzeit"><Input type="datetime-local" value={d.performedAt} onChange={(e) => setD((o) => ({ ...o, performedAt: e.target.value }))} /></Field>
        <Field label="Erkannte Steuergeräte" hint="Kommagetrennt" className="sm:col-span-2"><Input value={d.ecus} onChange={(e) => setD((o) => ({ ...o, ecus: e.target.value }))} /></Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Fehlercodes</p>
        {d.codes.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr_1fr_auto] gap-2">
            <Input value={c.code} onChange={(e) => setD((o) => ({ ...o, codes: o.codes.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) }))} placeholder="P0420" aria-label="Code" />
            <Input value={c.description} onChange={(e) => setD((o) => ({ ...o, codes: o.codes.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) }))} placeholder="Beschreibung" aria-label="Beschreibung" />
            <Select value={c.status} onChange={(e) => setD((o) => ({ ...o, codes: o.codes.map((x, j) => (j === i ? { ...x, status: e.target.value as DtcStatus } : x)) }))} aria-label="Status">
              {DTC_STATUSES.map((s) => <option key={s} value={s}>{DTC_STATUS_LABELS[s]}</option>)}
            </Select>
            <button className="rounded p-2 text-slate-500" onClick={() => setD((o) => ({ ...o, codes: o.codes.filter((_, j) => j !== i) }))} aria-label="Zeile entfernen">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setD((o) => ({ ...o, codes: [...o.codes, { code: '', description: '', status: 'UNKNOWN' }] }))}>
          Fehlercode hinzufügen
        </Button>
      </div>
      <Field label="Notizen"><Textarea value={d.notes} onChange={(e) => setD((o) => ({ ...o, notes: e.target.value }))} /></Field>
      <StepFooter onSave={save} saveLabel={d.device ? 'Bericht speichern und weiter' : 'Ohne OBD-Bericht weiter'} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 11: Batterie
export function BatteryStep({ vehicleId, server, onNext }: StepProps) {
  const b = server?.battery;
  const [d, setD] = useDraft(`battery:${vehicleId}`, {
    kind: (b?.kind ?? (server?.fuel === 'ELECTRIC' ? 'EV' : server?.fuel?.includes('HYBRID') ? 'HYBRID' : 'ICE')) as BatteryKind,
    voltage: b?.voltage?.toString() ?? '',
    testResult: b?.testResult ?? '',
    coldCranking: b?.coldCranking?.toString() ?? '',
    soh: b?.hvInfo?.sohPercent?.toString() ?? '',
    capacity: b?.hvInfo?.capacityKwh?.toString() ?? '',
    hvSource: b?.hvSource ?? '',
  });
  const hv = d.kind !== 'ICE';
  const hasHv = hv && (d.soh || d.capacity);
  const save = async () => {
    await enqueueJson(vehicleId, 'Batterie', 'PUT', '/battery', {
      kind: d.kind,
      voltage: d.voltage ? Number(d.voltage.replace(',', '.')) : null,
      testResult: d.testResult || null,
      coldCranking: d.coldCranking ? Number(d.coldCranking) : null,
      hvInfo: hasHv ? { sohPercent: d.soh ? Number(d.soh) : null, capacityKwh: d.capacity ? Number(d.capacity.replace(',', '.')) : null } : null,
      hvSource: hasHv ? d.hvSource : null,
    });
    onNext();
  };
  return (
    <div className="space-y-3">
      <Field label="Antriebsart">
        <Select value={d.kind} onChange={(e) => setD((o) => ({ ...o, kind: e.target.value as BatteryKind }))}>
          {BATTERY_KINDS.map((k) => <option key={k} value={k}>{BATTERY_KIND_LABELS[k]}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Spannung 12 V-Batterie (V)"><Input inputMode="decimal" value={d.voltage} onChange={(e) => setD((o) => ({ ...o, voltage: e.target.value }))} /></Field>
        <Field label="Startleistung (A, optional)"><Input inputMode="numeric" value={d.coldCranking} onChange={(e) => setD((o) => ({ ...o, coldCranking: e.target.value }))} /></Field>
        <Field label="Testergebnis" className="col-span-2"><Input value={d.testResult} onChange={(e) => setD((o) => ({ ...o, testResult: e.target.value }))} placeholder="z. B. Gut – Batterie in Ordnung" /></Field>
      </div>
      {hv && (
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">HV-Batterie</legend>
          <Alert tone="warning" className="mb-3">Nur zuverlässig ausgelesene Werte eintragen. Die Datenquelle ist Pflicht. Keine geschätzten SoH-Werte.</Alert>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SoH (%)"><Input inputMode="decimal" value={d.soh} onChange={(e) => setD((o) => ({ ...o, soh: e.target.value }))} /></Field>
            <Field label="Kapazität (kWh)"><Input inputMode="decimal" value={d.capacity} onChange={(e) => setD((o) => ({ ...o, capacity: e.target.value }))} /></Field>
            <Field label="Datenquelle" required={!!hasHv} className="col-span-2"><Input value={d.hvSource} onChange={(e) => setD((o) => ({ ...o, hvSource: e.target.value }))} placeholder="z. B. Herstellerdiagnose, Gerät, Datum" /></Field>
          </div>
        </fieldset>
      )}
      <StepFooter onSave={save} disabled={!!hasHv && d.hvSource.trim().length < 3} />
    </div>
  );
}

// ------------------------------------------------------------------ Schritt 12: Funktionen
export function FeaturesStep({ vehicleId, server, onNext }: StepProps) {
  const initial = Object.fromEntries(FEATURES.map((f) => [f, server?.features.find((x) => x.feature === f)?.result ?? ''])) as Record<Feature, FeatureResult | ''>;
  const [values, setValues] = useDraft(`features:${vehicleId}`, initial);
  const filled = FEATURES.filter((f) => values[f]);
  const save = async () => {
    await enqueueJson(vehicleId, 'Funktionsprüfung', 'PUT', '/features', { features: filled.map((feature) => ({ feature, result: values[feature], note: null })) });
    onNext();
  };
  const tones: Record<FeatureResult, string> = { OK: 'border-emerald-600 bg-emerald-600 text-white', DEFECT: 'border-red-600 bg-red-600 text-white', NOT_CHECKED: 'border-slate-500 bg-slate-500 text-white', NOT_PRESENT: 'border-slate-400 bg-slate-400 text-white' };
  return (
    <div className="space-y-3">
      <Button size="sm" variant="secondary" onClick={() => setValues(Object.fromEntries(FEATURES.map((f) => [f, values[f] || 'NOT_CHECKED'])) as Record<Feature, FeatureResult>)}>
        Offene Punkte als „nicht geprüft“ markieren
      </Button>
      {FEATURES.map((f) => (
        <fieldset key={f} className="rounded-lg border border-slate-200 bg-white p-3">
          <legend className="px-1 text-sm font-medium">{FEATURE_LABELS[f]}</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {FEATURE_RESULTS.map((r) => (
              <button key={r} type="button" aria-pressed={values[f] === r} onClick={() => setValues((o) => ({ ...o, [f]: r }))} className={clsx('h-11 rounded-md border text-sm font-medium', values[f] === r ? tones[r] : 'border-slate-300 bg-white text-slate-700')}>
                {FEATURE_RESULT_LABELS[r][0]}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <StepFooter onSave={save} saveLabel={`Speichern und weiter (${filled.length}/${FEATURES.length})`} disabled={filled.length === 0} />
    </div>
  );
}
