'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { AlertTriangle, CircleCheck, Disc3, FileText, Info, Minus } from 'lucide-react';
import {
  BATTERY_KIND_LABELS,
  BODY_LABELS,
  DAMAGE_KIND_LABELS,
  DAMAGE_SEVERITY_LABELS,
  DAMAGE_ZONE_LABELS,
  DRIVE_LABELS,
  DTC_STATUS_LABELS,
  EMISSION_CLASS_LABELS,
  FEATURE_LABELS,
  FEATURE_RESULT_LABELS,
  FUEL_LABELS,
  formatDateTimeDe,
  formatIsoDateDe,
  formatKm,
  HOLDER_TYPE_LABELS,
  PAINT_FLAG_HINT,
  PAINT_POINT_LABELS,
  TIRE_POSITION_LABELS,
  TIRE_SEASON_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_DOCUMENT_KIND_LABELS,
  type DamageZone,
} from '@sd/shared';
import { photoUrl, vehicleDocUrl, vehicleVideoUrl } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import { DamageSketch } from './damage-sketch';
import { PhotoGallery } from './photo-gallery';
import { Alert, DescriptionList, EmptyState, StatusBadge, Table, Tabs, Td } from './ui';

type TabId = 'overview' | 'equipment' | 'condition' | 'damages' | 'paint' | 'tires' | 'diagnostics' | 'photos' | 'documents';

/** HU-Termin „JJJJ-MM“ als „MM/JJJJ“. */
export function formatHu(huUntil: string | null): string {
  return huUntil ? huUntil.split('-').reverse().join('/') : '–';
}

export function dtcCount(file: VehicleFile): number {
  return file.diagnostics.reduce((n, r) => n + r.codes.length, 0);
}

export function VehicleFileView({ file, showQuality, extraTabs }: { file: VehicleFile; showQuality?: boolean; extraTabs?: { id: string; label: string; content: React.ReactNode }[] }) {
  const [tab, setTab] = useState<string>('overview');
  const codes = dtcCount(file);

  const tabs: { id: string; label: string; count?: number }[] = [
    { id: 'overview', label: 'Übersicht' },
    { id: 'equipment', label: 'Ausstattung' },
    { id: 'condition', label: 'Zustand' },
    { id: 'damages', label: 'Schäden', count: file.damages.length },
    { id: 'paint', label: 'Lackmessung' },
    { id: 'tires', label: 'Reifen' },
    { id: 'diagnostics', label: 'Diagnose', count: codes },
    { id: 'photos', label: 'Bilder', count: file.photos.filter((p) => !p.replaced).length },
    { id: 'documents', label: 'Dokumente', count: file.documents.length },
    ...(file.hasEngineVideo ? [{ id: 'video', label: 'Motorvideo' }] : []),
    ...(extraTabs ?? []).map((t) => ({ id: t.id, label: t.label })),
  ];

  return (
    <div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="pt-4">
        {tab === 'overview' && (
          <div className="space-y-4">
            <DescriptionList
              cols={3}
              items={[
                ['Fahrzeug-ID', file.internalNumber],
                ['FIN', file.vin ? <span className="font-mono">{file.vin}</span> : '–'],
                ...(file.licensePlate !== undefined ? ([['Kennzeichen', file.licensePlate ?? '–']] as [string, React.ReactNode][]) : []),
                ['Hersteller / Modell', `${file.make ?? '–'} ${file.model ?? ''}`],
                ['Variante', file.variant ?? '–'],
                ['Erstzulassung', formatIsoDateDe(file.firstRegistration)],
                ['Kilometerstand', formatKm(file.mileageKm)],
                ['Kraftstoff', file.fuel ? FUEL_LABELS[file.fuel] : '–'],
                ['Leistung', file.powerKw ? `${file.powerKw} kW (${file.powerPs} PS)` : '–'],
                ['Hubraum', file.displacementCcm ? `${file.displacementCcm} cm³` : '–'],
                ['Getriebe', file.transmission ? TRANSMISSION_LABELS[file.transmission] : '–'],
                ['Antrieb', file.drive ? DRIVE_LABELS[file.drive] : '–'],
                ['Karosserie', file.body ? BODY_LABELS[file.body] : '–'],
                ['Farbe', file.color ?? '–'],
                ['Türen / Sitze', `${file.doors ?? '–'} / ${file.seats ?? '–'}`],
                ['Vorbesitzer', file.ownersCount ?? '–'],
                ['Fahrzeughalter', file.holderType ? HOLDER_TYPE_LABELS[file.holderType] : '–'],
                ['Schadstoffklasse', file.emissionClass ? EMISSION_CLASS_LABELS[file.emissionClass] : '–'],
                ['HU bis', formatHu(file.huUntil)],
                ['Herkunft', file.origin ?? '–'],
                ['Schlüssel', file.keysCount ?? '–'],
                ['Standort', [file.location.zip, file.location.city].filter(Boolean).join(' ') || '–'],
              ]}
            />
            <div className="flex flex-wrap gap-2">
              {file.hasDamages ? <StatusBadge label={`${file.damages.length} Schaden/Schäden dokumentiert`} tone="warning" /> : <StatusBadge label="Keine Schäden dokumentiert" tone="success" />}
              {file.paintFlagged && <StatusBadge label="Auffällige Lackmesswerte" tone="warning" />}
              {codes > 0 && <StatusBadge label={`${codes} Fehlercode(s)`} tone="warning" />}
            </div>
          </div>
        )}
        {tab === 'equipment' && <EquipmentSection file={file} />}
        {tab === 'condition' && <ConditionSection file={file} />}
        {tab === 'damages' && <DamagesSection file={file} />}
        {tab === 'paint' && <PaintSection file={file} />}
        {tab === 'tires' && <TiresSection file={file} />}
        {tab === 'diagnostics' && <DiagnosticsSection file={file} />}
        {tab === 'photos' && <PhotoGallery vehicleId={file.id} photos={file.photos} showQuality={showQuality} />}
        {tab === 'documents' && <DocumentsSection file={file} />}
        {tab === 'video' && <video src={vehicleVideoUrl(file.id)} controls preload="metadata" playsInline className="aspect-video w-full max-w-2xl rounded-xl bg-black" data-testid="vehicle-video" />}
        {extraTabs?.map((t) => (tab === t.id ? <div key={t.id}>{t.content}</div> : null))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Abschnitte (auch für die Auktionsseite)

export function EquipmentSection({ file }: { file: VehicleFile }) {
  return file.equipment.length ? (
    <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {file.equipment.map((e) => (
        <li key={e} className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
          {e}
        </li>
      ))}
    </ul>
  ) : (
    <EmptyState title="Keine Ausstattungsmerkmale erfasst" />
  );
}

export function ConditionSection({ file }: { file: VehicleFile }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Funktionsprüfung</h3>
        {file.features.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {file.features.map((f) => {
              const [label, tone] = FEATURE_RESULT_LABELS[f.result];
              // Nur ein geprüftes „Funktioniert“ ist grün; „nicht geprüft“/„nicht vorhanden“ bleiben neutral (kein Haken).
              const cls = tone === 'success' ? 'text-emerald-700' : tone === 'danger' ? 'text-red-700' : 'text-slate-500';
              return (
                <li key={f.feature} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-medium text-slate-900">{FEATURE_LABELS[f.feature]}</span>
                  <span className={clsx('inline-flex items-center gap-1.5 text-sm font-medium', cls)}>
                    {tone === 'success' ? <CircleCheck className="h-4 w-4" aria-hidden /> : tone === 'danger' ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
                    {f.note ? `${label}: ${f.note}` : label}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Nicht erfasst.</p>
        )}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Batterie</h3>
        {file.battery ? (
          <DescriptionList
            items={[
              ['Art', BATTERY_KIND_LABELS[file.battery.kind]],
              ['Spannung', file.battery.voltage !== null ? `${file.battery.voltage} V` : '–'],
              ['Testergebnis', file.battery.testResult ?? '–'],
              ['Startleistung', file.battery.coldCranking ? `${file.battery.coldCranking} A` : '–'],
              ...(file.battery.hvInfo
                ? ([
                    ['HV-Batterie SoH', file.battery.hvInfo.sohPercent !== null && file.battery.hvInfo.sohPercent !== undefined ? `${file.battery.hvInfo.sohPercent} %` : '–'],
                    ['Datenquelle', file.battery.hvSource ?? '–'],
                  ] as [string, React.ReactNode][])
                : ([['HV-Batterie', 'Keine zuverlässig ausgelesenen Daten']] as [string, React.ReactNode][])),
            ]}
          />
        ) : (
          <p className="text-sm text-slate-500">Nicht erfasst.</p>
        )}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Dellenprüfung (PDR)</h3>
        {file.pdr ? (
          file.pdr.performed ? (
            <div className="space-y-2">
              <DescriptionList items={[['Anzahl Dellen', file.pdr.dentCount ?? '–'], ['Position', file.pdr.positions ?? '–'], ['Größe', file.pdr.size ?? '–'], ['Lack beschädigt', file.pdr.paintDamaged === null ? '–' : file.pdr.paintDamaged ? 'Ja' : 'Nein']]} />
              {file.pdr.lineboardPhotoId && <img src={photoUrl(file.id, file.pdr.lineboardPhotoId, 'thumb')} alt="PDR-Lineboard" className="h-32 rounded-lg border border-slate-200" />}
            </div>
          ) : (
            <p className="text-sm text-slate-600">Dellenprüfung nicht durchgeführt.</p>
          )
        ) : (
          <p className="text-sm text-slate-500">Nicht erfasst.</p>
        )}
      </section>
    </div>
  );
}

export function DamagesSection({ file }: { file: VehicleFile }) {
  const counts = useMemo(() => {
    const c: Partial<Record<DamageZone, number>> = {};
    for (const d of file.damages) c[d.zone] = (c[d.zone] ?? 0) + 1;
    return c;
  }, [file.damages]);
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <DamageSketch counts={counts} readOnly />
      {file.damages.length ? (
        <ul className="space-y-3">
          {file.damages.map((d) => (
            <li key={d.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{DAMAGE_ZONE_LABELS[d.zone]}</span>
                <span className="text-slate-500">·</span>
                <span>{DAMAGE_KIND_LABELS[d.kind]}</span>
                <StatusBadge label={DAMAGE_SEVERITY_LABELS[d.severity]} tone={d.severity === 'HIGH' ? 'danger' : d.severity === 'MEDIUM' ? 'warning' : 'neutral'} />
                {d.size && <span className="text-sm text-slate-600">Größe: {d.size}</span>}
              </div>
              {d.description && <p className="mt-1 text-sm text-slate-700">{d.description}</p>}
              {d.photoIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.photoIds.map((pid) => (
                    <a key={pid} href={photoUrl(file.id, pid, 'web')} target="_blank" rel="noreferrer">
                      <img src={photoUrl(file.id, pid, 'thumb')} alt={`Detailfoto ${DAMAGE_ZONE_LABELS[d.zone]}`} className="h-20 w-28 rounded border border-slate-200 object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Keine Schäden dokumentiert" />
      )}
    </div>
  );
}

export function PaintSection({ file }: { file: VehicleFile }) {
  if (!file.paint.length) return <EmptyState title="Keine Lackmessung erfasst" />;
  return (
    <div className="space-y-3">
      {file.paint.some((p) => p.flagged) && (
        <Alert tone="warning" title="Auffällige Messwerte">
          {PAINT_FLAG_HINT}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-4">
        {file.paint.map((p) => (
          <div key={p.point} className={clsx('px-4 py-3.5', p.flagged ? 'bg-amber-50' : 'bg-white')}>
            <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">{PAINT_POINT_LABELS[p.point]}</p>
            <p className={clsx('tabular mt-1 text-lg font-bold', p.flagged ? 'text-amber-700' : 'text-slate-900')}>
              {p.valueUm} µm{p.flagged && <AlertTriangle className="ml-1 inline h-4 w-4" aria-hidden />}
            </p>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" aria-hidden /> µm zeigt die Lackschichtdicke an.
      </p>
    </div>
  );
}

export function TiresSection({ file }: { file: VehicleFile }) {
  if (!file.tires.length) return <EmptyState title="Keine Reifendaten erfasst" />;
  const seasons = Array.from(new Set(file.tires.map((t) => (t.season ? TIRE_SEASON_LABELS[t.season] : null)).filter(Boolean))).join(' / ');
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="mb-5 text-sm text-slate-600">
        <span className="font-semibold text-slate-900">Satz (montiert)</span>
        {seasons && <span> · {seasons}</span>}
      </p>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        {file.tires.map((t) => {
          const low = t.treadMm !== null && t.treadMm < 3;
          const warn = low || !!t.damage;
          return (
            <div key={t.position} className="text-center">
              <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <Disc3 className="h-9 w-9 text-slate-400" aria-hidden />
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm">
                  {warn ? <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> : <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden />}
                </span>
              </div>
              <p className="mt-2.5 text-sm font-semibold text-slate-900">{TIRE_POSITION_LABELS[t.position]}</p>
              <p className={clsx('tabular text-xs', low ? 'font-semibold text-red-700' : 'text-slate-500')}>Profil: {t.treadMm !== null ? `${t.treadMm.toLocaleString('de-DE')} mm` : '–'}</p>
              {t.dimension && <p className="text-[11px] text-slate-400">{t.dimension}</p>}
              {t.damage && <p className="mt-0.5 text-[11px] text-amber-700">{t.damage}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiagnosticsSection({ file }: { file: VehicleFile }) {
  return file.diagnostics.length ? (
    <div className="space-y-4">
      {file.diagnostics.map((r) => (
        <div key={r.id} className="rounded-md border border-slate-200 p-3">
          <p className="text-sm">
            <span className="font-medium">{r.device}</span> · {formatDateTimeDe(r.performedAt)}
          </p>
          {r.ecus.length > 0 && <p className="mt-1 text-xs text-slate-600">Erkannte Steuergeräte: {r.ecus.join(', ')}</p>}
          {r.codes.length ? (
            <Table head={['Code', 'Beschreibung', 'Status']} className="mt-2">
              {r.codes.map((c, i) => (
                <tr key={`${c.code}-${i}`}>
                  <Td className="font-mono">{c.code}</Td>
                  <Td className="whitespace-normal">{c.description ?? '–'}</Td>
                  <Td>{DTC_STATUS_LABELS[c.status]}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="mt-2 text-sm text-emerald-700">Keine Fehlercodes gespeichert.</p>
          )}
          {r.notes && <p className="mt-2 text-sm text-slate-700">{r.notes}</p>}
        </div>
      ))}
      <p className="text-xs text-slate-500">Fehlercodes werden unverändert gespeichert und können über die Plattform nicht gelöscht werden.</p>
    </div>
  ) : (
    <EmptyState title="Kein Diagnosebericht vorhanden" />
  );
}

export function DocumentsSection({ file }: { file: VehicleFile }) {
  return file.documents.length ? (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {file.documents.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300">
          <a href={vehicleDocUrl(file.id, d.id)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-900 hover:text-brand-700">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <FileText className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="truncate">{VEHICLE_DOCUMENT_KIND_LABELS[d.kind]}</span>
          </a>
          {d.visibleToBuyers !== undefined && <StatusBadge label={d.visibleToBuyers ? 'Freigegeben' : 'Nur intern'} tone={d.visibleToBuyers ? 'success' : 'neutral'} />}
        </li>
      ))}
    </ul>
  ) : (
    <EmptyState title="Keine Dokumente" icon={<AlertTriangle className="h-6 w-6" />}>
      Sensible Dokumente werden erst nach Freigabe angezeigt.
    </EmptyState>
  );
}

export type { TabId };
