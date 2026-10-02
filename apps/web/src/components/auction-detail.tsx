'use client';

/*
 * Händler-Auktionsseite nach der Vorlage des Auftraggebers (Maße der Vorlage bei 1536 px Breite):
 * links Brotkrumen, Galerie (Hauptbild 2:1 + 4 Vorschaubilder + „weitere Bilder“), Titel mit Merkmalen,
 * Eckdatenleiste, Reiter (Übersicht = Fahrzeugdaten + Ausstattung als Auszug); rechts Bietpanel und Standortkarte.
 * Anonymisiert: Mitbieter als „Bieter N“, Verkäufer ohne Namen/Anschrift/Foto bis zum Zuschlag (§3.3).
 */
import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Cog,
  Disc3,
  Droplet,
  FileText,
  Forward,
  Fuel,
  Gauge,
  Home,
  IdCard,
  ImageOff,
  Images,
  Info,
  Mail,
  MapPin,
  Phone,
  PlayCircle,
  ShieldCheck,
  Star,
  Tag,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import {
  approxCoordinatesForZip,
  BODY_LABELS,
  EMISSION_CLASS_LABELS,
  formatDateDe,
  formatIsoDateDe,
  formatKm,
  FUEL_LABELS,
  HOLDER_TYPE_LABELS,
  PHOTO_SLOT_LABELS,
  REQUIRED_PHOTO_SLOTS,
  TRANSMISSION_LABELS,
  type PhotoSlot,
} from '@sd/shared';
import { photoUrl, vehicleVideoUrl } from '@/lib/api';
import type { AuctionCatalogContext, DealerAuctionDetail, DealerAuctionState, VehicleFile } from '@/lib/types';
import { Lightbox, type GalleryPhoto } from './photo-gallery';
import { ConditionSection, DamagesSection, DiagnosticsSection, DocumentsSection, dtcCount, formatHu, PaintSection, TiresSection } from './vehicle-file';
import { StatusBadge } from './ui';

/** "2022-05-01" → "05/2022" */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [y, m] = iso.slice(0, 10).split('-');
  return y && m ? `${m}/${y}` : '–';
}

export function vehicleTitle(v: Pick<VehicleFile, 'make' | 'model' | 'variant'>): string {
  return [v.make, v.model, v.variant].filter(Boolean).join(' ') || 'Fahrzeug';
}

// ---------------------------------------------------------------- Brotkrumen + Katalog-Navigation

export function AuctionBreadcrumb({ catalog, title }: { catalog: AuctionCatalogContext | null; title: string }) {
  const sep = (
    <li aria-hidden className="text-slate-400">
      <ChevronRight className="h-4 w-4" />
    </li>
  );
  return (
    <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-2">
      <nav aria-label="Brotkrumen" className="min-w-0">
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-700">
          <li>
            <Link href="/haendler" className="inline-flex items-center gap-2 hover:text-slate-950">
              <Home className="h-4 w-4 text-slate-500" aria-hidden /> Auktionen
            </Link>
          </li>
          {catalog && (
            <>
              {sep}
              <li>
                <Link href={`/haendler?katalog=${catalog.id}`} className="hover:text-slate-950">
                  {catalog.name}
                  {catalog.startsAt && ` – ${formatDateDe(catalog.startsAt)}`}
                </Link>
              </li>
            </>
          )}
          {sep}
          <li aria-current="page" className="truncate">
            {catalog?.position ? `Fahrzeug ${catalog.position} von ${catalog.total}` : title}
          </li>
        </ol>
      </nav>
      {catalog && (catalog.prevAuctionId || catalog.nextAuctionId) && (
        <div className="flex gap-2">
          <PagerLink href={catalog.prevAuctionId ? `/haendler/auktionen/${catalog.prevAuctionId}` : null} icon="prev">
            Vorheriges Fahrzeug
          </PagerLink>
          <PagerLink href={catalog.nextAuctionId ? `/haendler/auktionen/${catalog.nextAuctionId}` : null} icon="next">
            Nächstes Fahrzeug
          </PagerLink>
        </div>
      )}
    </div>
  );
}

function PagerLink({ href, icon, children }: { href: string | null; icon: 'prev' | 'next'; children: ReactNode }) {
  const cls = 'inline-flex h-[30px] items-center gap-2 rounded-md border px-3 text-xs font-medium';
  const content = (
    <>
      {icon === 'prev' && <ChevronLeft className="h-4 w-4" aria-hidden />}
      {children}
      {icon === 'next' && <ChevronRight className="h-4 w-4" aria-hidden />}
    </>
  );
  if (!href) {
    return (
      <span className={clsx(cls, 'cursor-not-allowed border-slate-200 bg-white/60 text-slate-400')} aria-disabled="true">
        {content}
      </span>
    );
  }
  return (
    <Link href={href} className={clsx(cls, 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50')}>
      {content}
    </Link>
  );
}

// ---------------------------------------------------------------- Galerie

/** Schaureihenfolge wie in der Vorlage: Front schräg, Heck schräg, Cockpit, Kofferraum – danach die übrigen Aufnahmen. */
const SHOWCASE: PhotoSlot[] = ['FRONT_LEFT_45', 'REAR_RIGHT_45', 'DASHBOARD', 'TRUNK_OPEN'];
const GALLERY_ORDER: PhotoSlot[] = [...SHOWCASE, ...REQUIRED_PHOTO_SLOTS.filter((s) => !SHOWCASE.includes(s)), 'EXTRA', 'DAMAGE', 'PDR_LINEBOARD'];

export function sortForGallery<T extends { slot: PhotoSlot }>(photos: T[]): T[] {
  const rank = (s: PhotoSlot) => {
    const i = GALLERY_ORDER.indexOf(s);
    return i === -1 ? GALLERY_ORDER.length : i;
  };
  return photos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.slot) - rank(b.p.slot) || a.i - b.i)
    .map(({ p }) => p);
}

export function AuctionGallery({ vehicleId, photos, live }: { vehicleId: string; photos: GalleryPhoto[]; live: boolean }) {
  const visible = sortForGallery(photos.filter((p) => !p.replaced));
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (visible.length === 0) {
    return (
      <div className="flex aspect-[2/1] items-center justify-center gap-2 rounded-lg bg-slate-200 text-sm text-slate-500">
        <ImageOff className="h-5 w-5" aria-hidden /> Keine Fotos vorhanden.
      </div>
    );
  }
  const current = visible[Math.min(index, visible.length - 1)]!;
  const go = (d: number) => setIndex((i) => (i + d + visible.length) % visible.length);
  const thumbs = visible.slice(0, 4);
  const more = visible.length - thumbs.length;

  return (
    // Container-Abfragen: Die Vorschauspalte steht neben dem Hauptbild, sobald die Galerie selbst breit genug ist.
    <div className="@container">
      <div className="grid gap-[9px] @2xl:grid-cols-[minmax(0,1fr)_9.875rem]">
        <div className="relative overflow-hidden rounded-lg bg-slate-900">
          <button type="button" className="block w-full" onClick={() => setLightbox(index)} aria-label={`${PHOTO_SLOT_LABELS[current.slot]} vergrößern`}>
            <img src={photoUrl(vehicleId, current.id, 'web')} alt={PHOTO_SLOT_LABELS[current.slot]} className="aspect-[16/10] w-full object-cover @2xl:aspect-[2/1]" />
          </button>
          {live && <span className="pointer-events-none absolute left-5 top-[18px] rounded-md bg-red-600 px-3 py-1 text-[15px] font-bold tracking-wide text-white shadow">LIVE</span>}
          {visible.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label="Vorheriges Bild" className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button type="button" onClick={() => go(1)} aria-label="Nächstes Bild" className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <span className="tabular pointer-events-none absolute bottom-4 left-4 rounded-md bg-black/60 px-3 py-1.5 text-sm font-semibold text-white">
            {index + 1} / {visible.length}
          </span>
        </div>
        {/* Breit: Vorschaubilder füllen exakt die Höhe des Hauptbilds (absolut positioniert, bestimmen die Zeilenhöhe nicht). */}
        <div className="relative">
          <ul className="grid grid-cols-5 gap-[9px] @2xl:absolute @2xl:inset-0 @2xl:grid-cols-1 @2xl:grid-rows-5">
            {thumbs.map((p, i) => (
              <li key={p.id} className="min-h-0">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Bild ${i + 1} anzeigen: ${PHOTO_SLOT_LABELS[p.slot]}`}
                  aria-current={i === index ? 'true' : undefined}
                  className={clsx('block h-full w-full overflow-hidden rounded-md border-[3px]', i === index ? 'border-red-600' : 'border-transparent hover:border-slate-300')}
                >
                  <img src={photoUrl(vehicleId, p.id, 'thumb')} alt="" loading="lazy" className="aspect-[4/3] h-full w-full object-cover @2xl:aspect-auto" />
                </button>
              </li>
            ))}
            {more > 0 && (
              <li className="min-h-0">
                <button type="button" onClick={() => setLightbox(thumbs.length)} className="relative block h-full w-full overflow-hidden rounded-md" aria-label={`Alle ${visible.length} Bilder ansehen`}>
                  <img src={photoUrl(vehicleId, visible[thumbs.length]!.id, 'thumb')} alt="" loading="lazy" className="aspect-[4/3] h-full w-full object-cover @2xl:aspect-auto" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 px-1 text-center text-xs font-semibold text-white sm:text-[15px]">+{more} weitere Bilder</span>
                </button>
              </li>
            )}
          </ul>
        </div>
        {lightbox !== null && (
          <Lightbox
            vehicleId={vehicleId}
            photos={visible}
            index={lightbox}
            onIndex={(i) => {
              setLightbox(i);
              setIndex(i);
            }}
            onClose={() => setLightbox(null)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Titel, Merkmale, Favorit, Teilen

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700">
      <Icon className="h-3.5 w-3.5 text-slate-500" aria-hidden />
      {children}
    </li>
  );
}

export function AuctionHeading({
  detail,
  onToggleFavorite,
  favoriteBusy,
  onShowCondition,
}: {
  detail: DealerAuctionDetail;
  onToggleFavorite: () => void;
  favoriteBusy: boolean;
  onShowCondition: () => void;
}) {
  const v = detail.vehicle;
  const title = vehicleTitle(v);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const share = async () => {
    const url = `${window.location.origin}/haendler/auktionen/${detail.state.auctionId}`;
    const note = (text: string) => {
      setShareNote(text);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShareNote(null), 3000);
    };
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text: `${title} – Auktion ${detail.state.number}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      note('Link kopiert – nur für freigeschaltete Händler abrufbar.');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // Teilen-Dialog geschlossen
      note('Link konnte nicht kopiert werden.');
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight text-slate-950 sm:text-[28px]">{title}</h1>
        <ul className="mt-2 flex flex-wrap items-center gap-2">
          <li className="mr-2 text-[13px] text-slate-600">Auktions-Nr.: {detail.state.number}</li>
          {detail.state.location.city && <Chip icon={MapPin}>{detail.state.location.city}</Chip>}
          {v.fuel && <Chip icon={Fuel}>{FUEL_LABELS[v.fuel]}</Chip>}
          {v.transmission && <Chip icon={Cog}>{TRANSMISSION_LABELS[v.transmission]}</Chip>}
          {v.firstRegistration && <Chip icon={CalendarDays}>{monthYear(v.firstRegistration)}</Chip>}
          {v.mileageKm !== null && <Chip icon={Gauge}>{formatKm(v.mileageKm)}</Chip>}
          {v.inspectionCompletedAt && v.approvedAt && (
            <li>
              <button
                type="button"
                onClick={onShowCondition}
                title={`Von der Plattform aufgenommen und am ${formatDateDe(v.approvedAt)} freigegeben`}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                <ShieldCheck className="h-4 w-4 fill-emerald-600 text-white" aria-hidden /> Geprüft
              </button>
            </li>
          )}
        </ul>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggleFavorite}
            disabled={favoriteBusy}
            aria-pressed={detail.isFavorite}
            title={detail.isFavorite ? 'Aus den Favoriten entfernen' : 'Zu den Favoriten hinzufügen'}
            className="inline-flex h-10 min-w-[105px] items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            <Star className={clsx('h-5 w-5', detail.isFavorite && 'fill-amber-400 text-amber-500')} aria-hidden />
            Favorit
          </button>
          <button type="button" onClick={share} className="inline-flex h-10 min-w-[105px] items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50">
            <Forward className="h-5 w-5" aria-hidden /> Teilen
          </button>
        </div>
        {shareNote && (
          <p className="text-xs text-slate-600" role="status" aria-live="polite">
            {shareNote}
          </p>
        )}
      </div>
    </div>
  );
}

export function KeyFacts({ file }: { file: VehicleFile }) {
  const facts: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Gauge, label: 'Leistung', value: file.powerPs ? `${file.powerPs} PS` : '–' },
    { icon: Fuel, label: 'Kraftstoff', value: file.fuel ? FUEL_LABELS[file.fuel] : '–' },
    { icon: Cog, label: 'Getriebe', value: file.transmission ? TRANSMISSION_LABELS[file.transmission] : '–' },
    { icon: Car, label: 'Karosserie', value: file.body ? BODY_LABELS[file.body] : '–' },
    { icon: CalendarDays, label: 'Erstzulassung', value: monthYear(file.firstRegistration) },
    { icon: ShieldCheck, label: 'HU', value: formatHu(file.huUntil) },
    { icon: UserRound, label: 'Vorbesitzer', value: file.ownersCount !== null ? String(file.ownersCount) : '–' },
    { icon: IdCard, label: 'Fahrzeughalter', value: file.holderType ? HOLDER_TYPE_LABELS[file.holderType] : '–' },
    { icon: CircleCheck, label: 'Schadstoffklasse', value: file.emissionClass ? EMISSION_CLASS_LABELS[file.emissionClass] : '–' },
  ];
  return (
    <div className="@container">
      {/* Breit: eine Zeile wie in der Vorlage, jede Zelle so breit wie ihr Inhalt (kein Umbruch); schmaler als Raster. */}
      <dl className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white @md:grid-cols-3 @3xl:grid-cols-5 @[62rem]:flex @[62rem]:flex-wrap">
        {facts.map((f) => (
          <div key={f.label} className="flex min-h-[58px] items-center gap-2 px-2.5 py-2 @[62rem]:flex-auto @[62rem]:whitespace-nowrap @[62rem]:border-l @[62rem]:border-slate-200 @[62rem]:first:border-l-0">
            <f.icon className="h-[22px] w-[22px] shrink-0 text-slate-800" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0">
              <dt className="hyphens-auto text-[11px] leading-4 text-slate-500">{f.label}</dt>
              <dd className="hyphens-auto text-[13px] leading-5 text-slate-900">{f.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- Reiter der Fahrzeugakte

export type AuctionTab = 'overview' | 'equipment' | 'condition' | 'damages' | 'paint' | 'tires' | 'diagnostics' | 'documents' | 'location';

export function AuctionVehicleTabs({ file, state, tab, onTab }: { file: VehicleFile; state: DealerAuctionState; tab: AuctionTab; onTab: (t: AuctionTab) => void }) {
  const tabs: { id: AuctionTab; label: string }[] = [
    { id: 'overview', label: 'Übersicht' },
    { id: 'equipment', label: 'Ausstattung' },
    { id: 'condition', label: 'Zustand' },
    { id: 'damages', label: `Schäden (${file.damages.length})` },
    { id: 'paint', label: 'Lackmessung' },
    { id: 'tires', label: `Reifen (${file.tires.length})` },
    { id: 'diagnostics', label: 'Diagnose' },
    { id: 'documents', label: 'Dokumente' },
    { id: 'location', label: 'Standort' },
  ];
  return (
    <section id="fahrzeugakte" className="scroll-mt-20">
      <div role="tablist" aria-label="Fahrzeugakte" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => onTab(t.id)}
            className={clsx(
              '-mb-px whitespace-nowrap border-b-[3px] px-3.5 py-2.5 text-[13px]',
              tab === t.id ? 'border-red-600 font-semibold text-slate-950' : 'border-transparent text-slate-700 hover:text-slate-950',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="@container pt-2">
        {tab === 'overview' ? (
          <OverviewPanel file={file} onShowEquipment={() => onTab('equipment')} />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {tab === 'equipment' && (
              <>
                <h3 className="mb-3 text-[15px] font-bold text-slate-950">Ausstattung</h3>
                <EquipmentChecklist items={file.equipment} columns="@md:columns-2 @3xl:columns-3" />
              </>
            )}
            {tab === 'condition' && (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {file.hasDamages ? <StatusBadge label={`${file.damages.length} Schaden/Schäden dokumentiert`} tone="warning" /> : <StatusBadge label="Keine Schäden dokumentiert" tone="success" />}
                  {file.paintFlagged ? <StatusBadge label="Auffällige Lackmesswerte" tone="warning" /> : file.paint.length > 0 && <StatusBadge label="Lackmesswerte unauffällig" tone="success" />}
                  {dtcCount(file) > 0 && <StatusBadge label={`${dtcCount(file)} Fehlercode(s)`} tone="warning" />}
                  {file.inspectionCompletedAt && <StatusBadge label={`Aufnahme abgeschlossen (${file.completenessPct} %)`} tone="info" />}
                </div>
                <ConditionSection file={file} />
              </div>
            )}
            {tab === 'damages' && <DamagesSection file={file} />}
            {tab === 'paint' && <PaintSection file={file} />}
            {tab === 'tires' && <TiresSection file={file} />}
            {tab === 'diagnostics' && <DiagnosticsSection file={file} />}
            {tab === 'documents' && <DocumentsSection file={file} />}
            {tab === 'location' && <LocationPanel state={state} />}
          </div>
        )}
      </div>
    </section>
  );
}

const EQUIPMENT_PREVIEW = 22; // zwei Spalten à 11 Zeilen wie in der Vorlage

function OverviewPanel({ file, onShowEquipment }: { file: VehicleFile; onShowEquipment: () => void }) {
  const rows: [string, string][] = [
    ['Marke', file.make ?? '–'],
    ['Modell', file.model ?? '–'],
    ['Ausstattungslinie', file.variant ?? '–'],
    ['Erstzulassung', monthYear(file.firstRegistration)],
    ['Kilometerstand', formatKm(file.mileageKm)],
    ['Kraftstoff', file.fuel ? FUEL_LABELS[file.fuel] : '–'],
    ['Getriebe', file.transmission ? TRANSMISSION_LABELS[file.transmission] : '–'],
    ['Leistung', file.powerKw ? `${file.powerKw} kW (${file.powerPs} PS)` : '–'],
    ['Farbe', file.color ?? '–'],
    ['Karosserie', file.body ? BODY_LABELS[file.body] : '–'],
    ['Türen / Sitzplätze', `${file.doors ?? '–'} / ${file.seats ?? '–'}`],
    ['Schadstoffklasse', file.emissionClass ? EMISSION_CLASS_LABELS[file.emissionClass] : '–'],
    ['FIN', file.vin ?? '–'],
  ];
  const preview = file.equipment.slice(0, EQUIPMENT_PREVIEW);
  const rest = file.equipment.length - preview.length;
  return (
    <div className="grid gap-2 @3xl:grid-cols-[minmax(0,397fr)_minmax(0,622fr)]">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-[15px] font-bold text-slate-950">Fahrzeugdaten</h3>
        <dl className="text-[12.5px]">
          {rows.map(([k, val], i) => (
            <div key={k} className={clsx('grid grid-cols-[9.25rem_minmax(0,1fr)] gap-2 px-1 py-[1px] leading-[17px]', i % 2 === 1 && 'bg-slate-50')}>
              <dt className="text-slate-600">{k}</dt>
              <dd className="break-words text-slate-900">{val}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-[15px] font-bold text-slate-950">
          Ausstattung <span className="font-normal text-slate-600">(Auszug)</span>
        </h3>
        <div className="flex-1">
          <EquipmentChecklist items={preview} columns="@md:columns-2" />
        </div>
        {rest > 0 && (
          <button type="button" onClick={onShowEquipment} className="mt-3 flex h-[27px] w-full items-center justify-center gap-2 rounded border border-slate-200 bg-white text-[12.5px] font-medium text-slate-900 hover:bg-slate-50">
            Vollständige Ausstattung anzeigen ({rest} weitere) <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function EquipmentChecklist({ items, columns }: { items: string[]; columns: string }) {
  if (items.length === 0) return <p className="text-[12.5px] text-slate-500">Keine Ausstattungsmerkmale erfasst.</p>;
  return (
    // Mehrspaltig von oben nach unten (erst linke, dann rechte Spalte) wie in der Vorlage.
    <ul className={clsx('gap-x-6 text-[12.5px] leading-[19px] text-slate-800', columns)}>
      {items.map((e) => (
        <li key={e} className="flex break-inside-avoid items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
          {e}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Standort & Kontakt

function LocationPanel({ state }: { state: DealerAuctionState }) {
  const place = [state.location.zip, state.location.city].filter(Boolean).join(' ');
  return (
    <div className="grid gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <LocationMap zip={state.location.zip} label={place || 'Fahrzeugstandort'} />
      <div className="space-y-2 text-sm">
        <p className="font-semibold text-slate-900">Fahrzeugstandort</p>
        <p className="text-slate-700">{place || 'nicht hinterlegt'}</p>
        {state.earliestPickup && <p className="text-slate-700">Früheste Abholung: {formatIsoDateDe(state.earliestPickup)}</p>}
        <p className="text-xs text-slate-500">Die Karte zeigt die ungefähre PLZ-Region. Die genaue Abholadresse erhalten Sie mit dem Zuschlag.</p>
      </div>
    </div>
  );
}

export function LocationMap({ zip, label, className }: { zip: string | null; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const coords = approxCoordinatesForZip(zip);
  const lat = coords?.lat;
  const lng = coords?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined || !ref.current) return;
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([lat, lng], 9);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
      L.circle([lat, lng], { radius: 20_000, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.15, weight: 2 }).addTo(map).bindTooltip(label);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, label]);
  if (lat === undefined) {
    return <div className={clsx('flex h-72 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500', className)}>Kein Standort hinterlegt.</div>;
  }
  return <div ref={ref} className={clsx('z-0 h-72 w-full overflow-hidden rounded-lg border border-slate-200', className)} role="img" aria-label={`Karte: ungefähre Lage ${label}`} />;
}

/** Kleine Kartengrafik anstelle des (anonymisierten) Verkäuferbilds; führt zur echten Karte im Reiter „Standort“. */
function MapThumbnail({ zip, onClick }: { zip: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="relative block h-[97px] w-[97px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-[#e8eef3]" aria-label="Standort auf der Karte ansehen">
      <svg viewBox="0 0 97 97" className="h-full w-full" aria-hidden>
        <path d="M0 30 L97 18 M0 64 L97 76 M28 0 L36 97 M66 0 L58 97" stroke="#ffffff" strokeWidth="6" fill="none" />
        <path d="M0 47 Q48 40 97 52" stroke="#f8d9a0" strokeWidth="5" fill="none" />
        <circle cx="48.5" cy="46" r="20" fill="#dc2626" fillOpacity="0.15" stroke="#dc2626" strokeWidth="1.5" />
        <path d="M48.5 30 c-6 0 -10 4.5 -10 10 c0 7.5 10 18 10 18 s10 -10.5 10 -18 c0 -5.5 -4 -10 -10 -10 z" fill="#dc2626" />
        <circle cx="48.5" cy="40" r="3.6" fill="#ffffff" />
      </svg>
      {zip && <span className="absolute inset-x-0 bottom-0 bg-white/85 py-0.5 text-center text-[10px] font-medium text-slate-700">PLZ {zip}</span>}
    </button>
  );
}

export function LocationCard({ state, contact, onShowMap }: { state: DealerAuctionState; contact: DealerAuctionDetail['contact']; onShowMap: () => void }) {
  return (
    <section className="@container rounded-lg border border-slate-200 bg-white p-[18px]" aria-labelledby="standort-titel">
      <h2 id="standort-titel" className="text-[15px] font-bold text-slate-950">
        Verkäufer / Standort
      </h2>
      {/* Nebeneinander wie in der Vorlage, sobald die Karte breit genug ist; sonst Kontakt unter dem Standort. */}
      <div className="mt-3 grid gap-4 @sm:grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)]">
        <div className="flex min-w-0 gap-4">
          <MapThumbnail zip={state.location.zip} onClick={onShowMap} />
          <div className="min-w-0 space-y-0.5 text-[12.5px] leading-[19px] text-slate-600">
            <p className="text-[13px] font-semibold text-slate-950">Geprüftes Autohaus</p>
            <p title="Name und Anschrift des Verkäufers erhalten Sie mit dem Zuschlag.">Anonym bis zum Zuschlag</p>
            <p>
              {state.location.zip} {state.location.city}
            </p>
            <button type="button" onClick={onShowMap} className="mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-blue-700 underline underline-offset-2 hover:text-blue-900">
              <MapPin className="h-4 w-4 fill-red-600 text-white" aria-hidden /> Auf Karte ansehen
            </button>
          </div>
        </div>
        <div className="space-y-3 border-t border-slate-200 pt-3 text-[12.5px] @sm:border-l @sm:border-t-0 @sm:pl-4 @sm:pt-0">
          <p className="flex items-start gap-3">
            <UserRound className="mt-0.5 h-5 w-5 text-slate-700" strokeWidth={1.5} aria-hidden />
            <span>
              <span className="block text-[11px] text-slate-500">Ansprechpartner</span>
              <span className="block text-[13px] text-slate-900">{contact.name}</span>
            </span>
          </p>
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} className="flex items-center gap-3 text-[13px] text-slate-900 hover:underline">
              <Phone className="h-5 w-5 text-slate-700" strokeWidth={1.5} aria-hidden /> {contact.phone}
            </a>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`Frage zu Auktion ${state.number}`)}`} className="flex items-center gap-3 text-[13px] text-slate-900 hover:underline">
              <Mail className="h-5 w-5 text-slate-700" strokeWidth={1.5} aria-hidden /> Nachricht senden
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- One-Pager (Apple-Karten-Stil)

/** Karten-Abschnitt im modernen „Apple"-Look: runde Ecken, dezenter Rahmen, großzügiger Abstand. */
export function Section({ id, icon: Icon, title, action, children }: { id?: string; icon?: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="@container scroll-mt-20 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6" data-testid={id ? `section-${id}` : undefined}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[17px] font-bold tracking-tight text-slate-950">
          {Icon && <Icon className="h-5 w-5 text-brand-600" aria-hidden />} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

type MediaKind = 'images' | 'condition' | 'documents' | 'video';

/** Medienbereich mit Umschaltern oben: Alle Bilder · Zustandsbilder · Dokumente · Motorvideo. */
export function AuctionMedia({ file, live }: { file: VehicleFile; live: boolean }) {
  const conditionPhotos: GalleryPhoto[] = useMemo(() => {
    const ids = new Set<string>();
    for (const d of file.damages) for (const pid of d.photoIds) ids.add(pid);
    for (const p of file.photos) if (!p.replaced && p.slot === 'DAMAGE') ids.add(p.id);
    return Array.from(ids).map((pid) => ({ id: pid, slot: 'DAMAGE' as PhotoSlot }));
  }, [file.damages, file.photos]);
  const tabs = [
    { id: 'images' as MediaKind, label: 'Alle Bilder', icon: Images, show: true },
    { id: 'condition' as MediaKind, label: 'Zustandsbilder', icon: ClipboardCheck, show: conditionPhotos.length > 0 },
    { id: 'documents' as MediaKind, label: 'Dokumente', icon: FileText, show: file.documents.length > 0 },
    { id: 'video' as MediaKind, label: 'Motorvideo', icon: PlayCircle, show: !!file.hasEngineVideo },
  ].filter((t) => t.show);
  const [kind, setKind] = useState<MediaKind>('images');
  const active = tabs.some((t) => t.id === kind) ? kind : 'images';
  return (
    <div>
      <div role="tablist" aria-label="Medien" className="mb-2.5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setKind(t.id)}
            data-testid={`media-tab-${t.id}`}
            className={clsx(
              '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-[3px] px-3.5 py-2.5 text-[13px] transition-colors',
              active === t.id ? 'border-brand-600 font-semibold text-slate-950' : 'border-transparent text-slate-600 hover:text-slate-950',
            )}
          >
            <t.icon className="h-4 w-4" aria-hidden /> {t.label}
          </button>
        ))}
      </div>
      {active === 'images' && <AuctionGallery vehicleId={file.id} photos={file.photos} live={live} />}
      {active === 'condition' && <AuctionGallery vehicleId={file.id} photos={conditionPhotos} live={false} />}
      {active === 'documents' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <DocumentsSection file={file} />
        </div>
      )}
      {active === 'video' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-black" data-testid="engine-video">
          <video src={vehicleVideoUrl(file.id)} controls preload="metadata" playsInline className="aspect-video w-full bg-black" />
        </div>
      )}
    </div>
  );
}

/** Fahrzeugdaten als zweispaltige Liste. */
function VehicleDataGrid({ file }: { file: VehicleFile }) {
  const rows: [string, string][] = [
    ['Marke', file.make ?? '–'],
    ['Modell', file.model ?? '–'],
    ['Ausstattungslinie', file.variant ?? '–'],
    ['Erstzulassung', monthYear(file.firstRegistration)],
    ['Kilometerstand', formatKm(file.mileageKm)],
    ['Kraftstoff', file.fuel ? FUEL_LABELS[file.fuel] : '–'],
    ['Getriebe', file.transmission ? TRANSMISSION_LABELS[file.transmission] : '–'],
    ['Leistung', file.powerKw ? `${file.powerKw} kW (${file.powerPs} PS)` : '–'],
    ['Farbe', file.color ?? '–'],
    ['Karosserie', file.body ? BODY_LABELS[file.body] : '–'],
    ['Türen / Sitzplätze', `${file.doors ?? '–'} / ${file.seats ?? '–'}`],
    ['Vorbesitzer', file.ownersCount !== null ? String(file.ownersCount) : '–'],
    ['HU bis', formatHu(file.huUntil)],
    ['Schadstoffklasse', file.emissionClass ? EMISSION_CLASS_LABELS[file.emissionClass] : '–'],
    ['FIN', file.vin ?? '–'],
  ];
  return (
    <dl className="grid gap-x-8 gap-y-0 text-[13px] @xl:grid-cols-2">
      {rows.map(([k, v], i) => (
        <div key={k} className={clsx('flex items-center justify-between gap-3 border-b border-slate-100 py-2', i === rows.length - 1 && '@xl:border-b-0')}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="break-words text-right font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function GeneralInfo() {
  return (
    <p className="text-[13px] leading-relaxed text-slate-600">
      Das Fahrzeug kann zusätzliche, im Inserat nicht angegebene Gebrauchs- oder Verschleißspuren aufweisen, die dem Alter und der Laufleistung entsprechen (z. B. kleine Kratzer, Steinschläge).
      Fahrzeugdokumente werden nach Zahlungseingang an den Käufer versendet; vorab stehen sie als digitale Kopie zur Verfügung. Angaben ohne Gewähr.
    </p>
  );
}

/** Gesamte Fahrzeugakte als One-Pager (statt Reiter): alle Daten gestapelt in Karten. */
export function AuctionOnePager({ file, state }: { file: VehicleFile; state: DealerAuctionState }) {
  return (
    <div className="space-y-3" id="fahrzeugakte">
      <Section id="daten" icon={Car} title="Fahrzeugdaten">
        <VehicleDataGrid file={file} />
      </Section>
      {file.equipment.length > 0 && (
        <Section id="ausstattung" icon={Check} title="Ausstattung">
          <EquipmentChecklist items={file.equipment} columns="@md:columns-2 @3xl:columns-3" />
        </Section>
      )}
      <Section id="zustand" icon={ShieldCheck} title="Technischer Zustand">
        <ConditionSection file={file} />
      </Section>
      {file.paint.length > 0 && (
        <Section id="lack" icon={Droplet} title="Lackschichtdicke">
          <PaintSection file={file} />
        </Section>
      )}
      {file.tires.length > 0 && (
        <Section id="reifen" icon={Disc3} title="Reifen">
          <TiresSection file={file} />
        </Section>
      )}
      {file.damages.length > 0 && (
        <Section id="schaeden" icon={Tag} title={`Schäden (${file.damages.length})`}>
          <DamagesSection file={file} />
        </Section>
      )}
      {file.diagnostics.length > 0 && (
        <Section id="diagnose" icon={Activity} title="Diagnose">
          <DiagnosticsSection file={file} />
        </Section>
      )}
      <Section id="standort" icon={MapPin} title="Standort">
        <LocationPanel state={state} />
      </Section>
      <Section id="info" icon={Info} title="Allgemeine Informationen">
        <GeneralInfo />
      </Section>
    </div>
  );
}
