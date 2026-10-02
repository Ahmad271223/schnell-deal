'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
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
import { photoUrl, vehicleDocUrl } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import { DamageSketch } from './damage-sketch';
import { PhotoGallery } from './photo-gallery';
import { Alert, DescriptionList, EmptyState, StatusBadge, statusBadge, Table, Tabs, Td } from './ui';

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
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Funktionsprüfung</h3>
        {file.features.length ? (
          <Table head={['Prüfpunkt', 'Ergebnis', 'Hinweis']}>
            {file.features.map((f) => (
              <tr key={f.feature}>
                <Td>{FEATURE_LABELS[f.feature]}</Td>
                <Td>{statusBadge(FEATURE_RESULT_LABELS, f.result)}</Td>
                <Td className="whitespace-normal text-slate-600">{f.note ?? ''}</Td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-slate-500">Nicht erfasst.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Batterie</h3>
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
      <section>
        <h3 className="mb-2 text-sm font-semibold">Dellenprüfung (PDR)</h3>
        {file.pdr ? (
          file.pdr.performed ? (
            <div className="space-y-2">
              <DescriptionList items={[['Anzahl Dellen', file.pdr.dentCount ?? '–'], ['Position', file.pdr.positions ?? '–'], ['Größe', file.pdr.size ?? '–'], ['Lack beschädigt', file.pdr.paintDamaged === null ? '–' : file.pdr.paintDamaged ? 'Ja' : 'Nein']]} />
              {file.pdr.lineboardPhotoId && <img src={photoUrl(file.id, file.pdr.lineboardPhotoId, 'thumb')} alt="PDR-Lineboard" className="h-32 rounded border border-slate-200" />}
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
  return (
    <div className="space-y-3">
      {file.paint.some((p) => p.flagged) && (
        <Alert tone="warning" title="Auffällige Messwerte">
          {PAINT_FLAG_HINT}
        </Alert>
      )}
      {file.paint.length ? (
        <Table head={['Messpunkt', 'Wert', 'Hinweis']}>
          {file.paint.map((p) => (
            <tr key={p.point} className={p.flagged ? 'bg-amber-50' : undefined}>
              <Td>{PAINT_POINT_LABELS[p.point]}</Td>
              <Td className="tabular font-medium">{p.valueUm} µm</Td>
              <Td>{p.flagged ? <StatusBadge label="Auffälliger Wert" tone="warning" /> : <span className="text-slate-500">unauffällig</span>}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="Keine Lackmessung erfasst" />
      )}
    </div>
  );
}

export function TiresSection({ file }: { file: VehicleFile }) {
  return file.tires.length ? (
    <Table head={['Position', 'Hersteller', 'Dimension', 'Saison', 'Profil', 'DOT', 'Beschädigung', 'Felge']}>
      {file.tires.map((t) => (
        <tr key={t.position}>
          <Td>{TIRE_POSITION_LABELS[t.position]}</Td>
          <Td>{t.brand ?? '–'}</Td>
          <Td>{t.dimension ?? '–'}</Td>
          <Td>{t.season ? TIRE_SEASON_LABELS[t.season] : '–'}</Td>
          <Td className={t.treadMm !== null && t.treadMm < 3 ? 'font-semibold text-red-700' : undefined}>{t.treadMm !== null ? `${t.treadMm.toLocaleString('de-DE')} mm` : '–'}</Td>
          <Td>{t.dot ?? '–'}</Td>
          <Td className="whitespace-normal">{t.damage ?? 'keine'}</Td>
          <Td className="whitespace-normal">{t.rimCondition ?? '–'}</Td>
        </tr>
      ))}
    </Table>
  ) : (
    <EmptyState title="Keine Reifendaten erfasst" />
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
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {file.documents.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <a href={vehicleDocUrl(file.id, d.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-brand-700 hover:underline">
            <FileText className="h-4 w-4" aria-hidden />
            {VEHICLE_DOCUMENT_KIND_LABELS[d.kind]}
          </a>
          {d.visibleToBuyers !== undefined && <StatusBadge label={d.visibleToBuyers ? 'Für Käufer freigegeben' : 'Nur intern'} tone={d.visibleToBuyers ? 'success' : 'neutral'} />}
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
