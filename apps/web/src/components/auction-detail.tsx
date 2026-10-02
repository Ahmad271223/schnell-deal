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
  AlertTriangle,
  BatteryCharging,
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
  Expand,
  FileText,
  Forward,
  Fuel,
  Gauge,
  Home,
  IdCard,
  ImageOff,
  Images,
  Mail,
  MapPin,
  Megaphone,
  Minus,
  Phone,
  PlayCircle,
  ShieldCheck,
  Star,
  Tag,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  approxCoordinatesForZip,
  BATTERY_KIND_LABELS,
  BODY_LABELS,
  DAMAGE_KIND_LABELS,
  DAMAGE_SEVERITY_LABELS,
  DAMAGE_ZONE_LABELS,
  DRIVE_LABELS,
  EMISSION_CLASS_LABELS,
  formatDateDe,
  formatIsoDateDe,
  formatKm,
  FUEL_LABELS,
  HOLDER_TYPE_LABELS,
  PHOTO_SLOT_LABELS,
  REQUIRED_PHOTO_SLOTS,
  TAX_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_DOCUMENT_KIND_LABELS,
  type DamageZone,
  type PhotoSlot,
  type VehicleDocumentKind,
} from '@sd/shared';
import { photoUrl, vehicleVideoUrl } from '@/lib/api';
import type { AuctionCatalogContext, DealerAuctionDetail, DealerAuctionState, VehicleFile } from '@/lib/types';
import { DamageSketch } from './damage-sketch';
import { Lightbox, type GalleryPhoto } from './photo-gallery';
import { ConditionSection, DiagnosticsSection, DocumentsSection, dtcCount, formatHu, PaintSection, TiresSection } from './vehicle-file';

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
  const go = (d: number) => setIndex((i) => (i + d + visible.length) % visible.length);
  const swipe = useSwipe(go);
  if (visible.length === 0) {
    return (
      <div className="flex aspect-[2/1] items-center justify-center gap-2 rounded-2xl bg-slate-200 text-sm text-slate-500">
        <ImageOff className="h-5 w-5" aria-hidden /> Keine Fotos vorhanden.
      </div>
    );
  }
  const current = visible[Math.min(index, visible.length - 1)]!;
  const thumbs = visible.slice(0, 4);
  const more = visible.length - thumbs.length;

  return (
    // Container-Abfragen: Die Vorschauspalte steht neben dem Hauptbild, sobald die Galerie selbst breit genug ist.
    <div className="@container">
      <div className="grid gap-[9px] @2xl:grid-cols-[minmax(0,1fr)_9.875rem]">
        <div className="relative touch-pan-y select-none overflow-hidden rounded-2xl bg-slate-900" {...swipe}>
          <button type="button" className="block w-full" onClick={() => setLightbox(index)} aria-label={`${PHOTO_SLOT_LABELS[current.slot]} vergrößern`}>
            <img src={photoUrl(vehicleId, current.id, 'web')} alt={PHOTO_SLOT_LABELS[current.slot]} draggable={false} className="aspect-[16/10] w-full object-cover @2xl:aspect-[2/1]" />
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

// ---------------------------------------------------------------- Ausstattung

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

// ---------------------------------------------------------------- One-Pager (Karten-Stil)

/** Karten-Abschnitt: runde Ecken, dezenter Rahmen, großzügiger Abstand. */
export function Section({ id, icon: Icon, title, subtitle, action, children }: { id?: string; icon?: LucideIcon; title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="@container scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6" data-testid={id ? `section-${id}` : undefined}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[17px] font-bold tracking-tight text-slate-950">
            {Icon && <Icon className="h-5 w-5 text-brand-600" aria-hidden />} {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Segmentierter Umschalter (iOS-Stil). */
export function Segmented<T extends string>({ options, value, onChange, label, testPrefix }: { options: { id: T; label: string; icon?: LucideIcon; count?: number }[]; value: T; onChange: (v: T) => void; label: string; testPrefix?: string }) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          data-testid={testPrefix ? `${testPrefix}-${o.id}` : undefined}
          className={clsx(
            'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-medium transition-all',
            value === o.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950',
          )}
        >
          {o.icon && <o.icon className="h-4 w-4" aria-hidden />}
          {o.label}
          {o.count !== undefined && <span className="tabular text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Horizontales Wischen (Finger oder Maus) ohne Bibliothek; senkrechtes Scrollen bleibt unberührt (`touch-pan-y`). */
export function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

type MediaKind = 'images' | 'condition' | 'documents' | 'video';

/** Medienbereich mit Umschalter: Alle Bilder · Zustandsbilder · Dokumente · Motorvideo. */
export function AuctionMedia({ file, live }: { file: VehicleFile; live: boolean }) {
  const allPhotos = file.photos.filter((p) => !p.replaced);
  const conditionPhotos: GalleryPhoto[] = useMemo(() => {
    const ids = new Set<string>();
    for (const d of file.damages) for (const pid of d.photoIds) ids.add(pid);
    for (const p of file.photos) if (!p.replaced && (p.slot === 'DAMAGE' || p.slot === 'PDR_LINEBOARD')) ids.add(p.id);
    return Array.from(ids).map((pid) => ({ id: pid, slot: 'DAMAGE' as PhotoSlot }));
  }, [file.damages, file.photos]);
  const options = [
    { id: 'images' as MediaKind, label: 'Alle Bilder', icon: Images, count: allPhotos.length, show: true },
    { id: 'condition' as MediaKind, label: 'Zustandsbilder', icon: ClipboardCheck, count: conditionPhotos.length, show: conditionPhotos.length > 0 },
    { id: 'documents' as MediaKind, label: 'Dokumente', icon: FileText, count: file.documents.length, show: file.documents.length > 0 },
    { id: 'video' as MediaKind, label: 'Motorvideo', icon: PlayCircle, show: !!file.hasEngineVideo },
  ].filter((t) => t.show);
  const [kind, setKind] = useState<MediaKind>('images');
  const active = options.some((t) => t.id === kind) ? kind : 'images';
  return (
    <div>
      <div className="mb-3">
        <Segmented options={options} value={active} onChange={setKind} label="Medien" testPrefix="media-tab" />
      </div>
      {active === 'images' && <AuctionGallery vehicleId={file.id} photos={file.photos} live={live} />}
      {active === 'condition' && <AuctionGallery vehicleId={file.id} photos={conditionPhotos} live={false} />}
      {active === 'documents' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <DocumentsSection file={file} />
        </div>
      )}
      {active === 'video' && (
        <div className="overflow-hidden rounded-2xl bg-black shadow-sm" data-testid="engine-video">
          <video src={vehicleVideoUrl(file.id)} controls preload="metadata" playsInline className="aspect-video w-full bg-black" />
          <p className="px-4 py-2.5 text-[12px] text-slate-300">Vom Außendienst bei der Aufnahme aufgezeichnet.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Fahrzeugdaten in Gruppen (wie in der Vorlage)

function DataCard({ title, icon: Icon, rows }: { title: string; icon?: LucideIcon; rows: [string, ReactNode][] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" data-testid={`data-card-${title}`}>
      <h3 className="mb-1.5 flex items-center gap-2 font-display text-[15px] font-bold text-slate-950">
        {Icon && <Icon className="h-4 w-4 text-slate-500" aria-hidden />}
        {title}
      </h3>
      <dl className="text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-medium text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** „–“ = bei der Aufnahme nicht erfasst. Es werden keine Werte ergänzt oder geschätzt. */
const dash = (v: ReactNode | null | undefined): ReactNode => (v === null || v === undefined || v === '' ? '–' : v);

function VehicleDataGroups({ file, state }: { file: VehicleFile; state: DealerAuctionState }) {
  const place = [state.location.zip, state.location.city].filter(Boolean).join(' ');
  const hv = file.battery?.hvInfo ?? null;
  const electrified = file.fuel === 'ELECTRIC' || (file.fuel ?? '').startsWith('HYBRID');
  return (
    <div className="grid gap-3 @3xl:grid-cols-2">
      <DataCard
        title="Allgemeine Daten"
        icon={Car}
        rows={[
          ['Marke', dash(file.make)],
          ['Modell', dash(file.model)],
          ['Ausstattungslinie', dash(file.variant)],
          ['Karosserie', file.body ? BODY_LABELS[file.body] : '–'],
          ['Außenfarbe', dash(file.color)],
          ['Anzahl Türen', dash(file.doors)],
          ['Anzahl Sitze', dash(file.seats)],
          ['FIN', file.vin ? <span className="font-mono tracking-wide">{file.vin}</span> : '–'],
          ['Fahrzeug-ID', file.internalNumber],
        ]}
      />
      <DataCard
        title="Herkunft & Besteuerung"
        icon={MapPin}
        rows={[
          ['Standort', place || '–'],
          ['Fahrzeughalter', file.holderType ? HOLDER_TYPE_LABELS[file.holderType] : '–'],
          ['Herkunft / Vornutzung', dash(file.origin)],
          ['Besteuerung', TAX_TYPE_LABELS[state.taxType]],
          ['Früheste Abholung', state.earliestPickup ? formatIsoDateDe(state.earliestPickup) : '–'],
        ]}
      />
      <DataCard
        title="Motor & Antrieb"
        icon={Cog}
        rows={[
          ['Kraftstoff', file.fuel ? FUEL_LABELS[file.fuel] : '–'],
          ['Leistung', file.powerKw ? `${file.powerPs} PS (${file.powerKw} kW)` : '–'],
          ['Hubraum', file.displacementCcm ? `${file.displacementCcm.toLocaleString('de-DE')} cm³` : '–'],
          ['Getriebe', file.transmission ? TRANSMISSION_LABELS[file.transmission] : '–'],
          ['Antrieb', file.drive ? DRIVE_LABELS[file.drive] : '–'],
          ['Schadstoffklasse', file.emissionClass ? EMISSION_CLASS_LABELS[file.emissionClass] : '–'],
        ]}
      />
      <DataCard
        title="Wartung & Historie"
        icon={CalendarDays}
        rows={[
          ['Erstzulassung', monthYear(file.firstRegistration)],
          ['Modelljahr', dash(file.modelYear)],
          ['Kilometerstand', formatKm(file.mileageKm)],
          ['HU bis', formatHu(file.huUntil)],
          ['Anzahl Vorbesitzer', dash(file.ownersCount)],
          ['Anzahl Schlüssel', dash(file.keysCount)],
        ]}
      />
      {file.battery && (electrified || hv) && (
        <DataCard
          title="Hochvoltbatterie"
          icon={BatteryCharging}
          rows={[
            ['Batterieart', BATTERY_KIND_LABELS[file.battery.kind]],
            ['Gesundheitszustand (SoH)', hv?.sohPercent !== null && hv?.sohPercent !== undefined ? `${hv.sohPercent} %` : '–'],
            ['Kapazität', hv?.capacityKwh !== null && hv?.capacityKwh !== undefined ? `${hv.capacityKwh} kWh` : '–'],
            ['Quelle der Angabe', dash(file.battery.hvSource)],
            ['Hinweise', dash(hv?.notes)],
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Zustand: Überblick, Schäden, Dokumente

/** Kacheln mit echten Zählwerten aus der Akte. Keine Aussage zu Unfallfreiheit (§14): nur dokumentierte Befunde. */
function ConditionSummary({ file }: { file: VehicleFile }) {
  const zones = new Set(file.damages.map((d) => d.zone)).size;
  const paintFlags = file.paint.filter((p) => p.flagged).length;
  const defects = file.features.filter((f) => f.result === 'DEFECT').length;
  const ok = file.features.filter((f) => f.result === 'OK').length;
  const notChecked = file.features.length - ok - defects;
  const codes = dtcCount(file);
  const tiles: { icon: LucideIcon; label: string; value: string; tone: 'ok' | 'warn' | 'none' }[] = [
    {
      icon: Tag,
      label: 'Dokumentierte Schäden',
      value: file.damages.length ? `${file.damages.length} in ${zones} Bereich${zones === 1 ? '' : 'en'}` : 'keine dokumentiert',
      tone: file.damages.length ? 'warn' : 'ok',
    },
    {
      icon: Droplet,
      label: 'Lackmessung',
      value: file.paint.length ? (paintFlags ? `${paintFlags} von ${file.paint.length} Messpunkten auffällig` : `${file.paint.length} Messpunkte unauffällig`) : 'nicht erfasst',
      tone: file.paint.length ? (paintFlags ? 'warn' : 'ok') : 'none',
    },
    {
      icon: Wrench,
      label: 'Funktionsprüfung',
      value: !file.features.length
        ? 'nicht erfasst'
        : [defects > 0 && `${defects} Mangel${defects === 1 ? '' : 'mängel'}`, ok > 0 && `${ok} in Ordnung`, notChecked > 0 && `${notChecked} nicht geprüft`].filter(Boolean).join(', '),
      tone: defects > 0 ? 'warn' : ok > 0 ? 'ok' : 'none',
    },
    {
      icon: Activity,
      label: 'Diagnose (OBD)',
      value: file.diagnostics.length ? (codes ? `${codes} Fehlercode${codes === 1 ? '' : 's'} gespeichert` : 'keine Fehlercodes') : 'nicht erfasst',
      tone: file.diagnostics.length ? (codes ? 'warn' : 'ok') : 'none',
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-4" data-testid="condition-summary">
      {tiles.map((t) => (
        <div key={t.label} className={clsx('flex items-start gap-3 rounded-2xl border p-3.5', t.tone === 'warn' ? 'border-amber-200 bg-amber-50' : t.tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm', t.tone === 'warn' ? 'text-amber-600' : t.tone === 'ok' ? 'text-emerald-600' : 'text-slate-400')}>
            <t.icon className="h-4.5 w-4.5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</span>
            <span className={clsx('block text-[13px] font-semibold leading-snug', t.tone === 'warn' ? 'text-amber-900' : t.tone === 'ok' ? 'text-emerald-900' : 'text-slate-600')}>{t.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function TagChip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return <span className={clsx('rounded-md px-2 py-1 text-[12px] font-semibold', strong ? 'bg-slate-950 text-white' : 'bg-white/90 text-slate-900')}>{children}</span>;
}

/** Skizze mit Markierungen, Schaden-Reiter und Fotos des gewählten Schadens (Wischen, Vollbild). */
function DamageExplorer({ file }: { file: VehicleFile }) {
  const damages = file.damages;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const counts = useMemo(() => {
    const c: Partial<Record<DamageZone, number>> = {};
    for (const d of damages) c[d.zone] = (c[d.zone] ?? 0) + 1;
    return c;
  }, [damages]);
  const selected = damages.find((d) => d.id === selectedId) ?? damages[0] ?? null;
  const photos: GalleryPhoto[] = useMemo(() => (selected ? selected.photoIds.map((id) => ({ id, slot: 'DAMAGE' as PhotoSlot })) : []), [selected]);
  const idx = Math.min(photoIdx, Math.max(0, photos.length - 1));
  const select = (id: string) => {
    setSelectedId(id);
    setPhotoIdx(0);
  };
  const step = (d: 1 | -1) => photos.length > 1 && setPhotoIdx((i) => (i + d + photos.length) % photos.length);
  const swipe = useSwipe(step);

  if (!damages.length) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] font-medium text-emerald-900">
        <CircleCheck className="h-5 w-5 text-emerald-600" aria-hidden /> Bei der Aufnahme wurden keine Schäden dokumentiert.
      </p>
    );
  }
  return (
    <div className="grid gap-5 @3xl:grid-cols-[300px_minmax(0,1fr)]">
      <div>
        <p className="mb-2 text-[13px] text-slate-500">Bereich antippen, um Fotos und Beschreibung zu sehen.</p>
        <DamageSketch
          counts={counts}
          selected={selected?.zone ?? null}
          onSelect={(zone) => {
            const d = damages.find((x) => x.zone === zone);
            if (d) select(d.id);
          }}
        />
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Zahl = dokumentierte Schäden im Bereich
        </p>
      </div>
      <div className="min-w-0">
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="tablist" aria-label="Schäden">
          {damages.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={d.id === selected?.id}
              onClick={() => select(d.id)}
              data-testid={`damage-tab-${d.id}`}
              className={clsx(
                'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold transition-colors',
                d.id === selected?.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
              )}
            >
              <AlertTriangle className={clsx('h-4 w-4', d.severity === 'HIGH' ? 'text-red-500' : 'text-amber-400')} aria-hidden />
              {DAMAGE_ZONE_LABELS[d.zone]}
            </button>
          ))}
        </div>
        {selected && (
          <div className="mt-2" data-testid="damage-detail">
            {photos.length ? (
              <div className="relative touch-pan-y select-none overflow-hidden rounded-2xl bg-slate-900" {...swipe}>
                <button type="button" className="block w-full" onClick={() => setLightbox(true)} aria-label="Schadenfoto vergrößern">
                  <img
                    key={photos[idx]!.id}
                    src={photoUrl(file.id, photos[idx]!.id, 'web')}
                    alt={`${DAMAGE_ZONE_LABELS[selected.zone]}: ${DAMAGE_KIND_LABELS[selected.kind]}`}
                    draggable={false}
                    className="aspect-[16/10] w-full object-cover"
                  />
                </button>
                <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5">
                  <TagChip strong>{DAMAGE_KIND_LABELS[selected.kind]}</TagChip>
                  <TagChip>{DAMAGE_SEVERITY_LABELS[selected.severity]}</TagChip>
                  {selected.size && <TagChip>{selected.size}</TagChip>}
                </div>
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                  <span className="tabular rounded-md bg-black/60 px-2 py-1 text-xs font-semibold text-white">
                    {idx + 1}/{photos.length}
                  </span>
                  <button type="button" onClick={() => setLightbox(true)} className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80" aria-label="Vollbild">
                    <Expand className="h-4 w-4" />
                  </button>
                </div>
                {photos.length > 1 && (
                  <>
                    <button type="button" onClick={() => step(-1)} aria-label="Vorheriges Schadenfoto" className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => step(1)} aria-label="Nächstes Schadenfoto" className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex aspect-[16/7] items-center justify-center gap-2 rounded-2xl bg-slate-100 text-sm text-slate-500">
                <ImageOff className="h-5 w-5" aria-hidden /> Zu diesem Schaden wurde kein Detailfoto aufgenommen.
              </div>
            )}
            <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-[14px] text-slate-800">
              <p className="font-semibold text-slate-950">
                {DAMAGE_ZONE_LABELS[selected.zone]} · {DAMAGE_KIND_LABELS[selected.kind]}
                <span className="ml-2 font-normal text-slate-500">{DAMAGE_SEVERITY_LABELS[selected.severity]}</span>
              </p>
              <p className="mt-1">{selected.description || 'Keine weitere Beschreibung erfasst.'}</p>
            </div>
          </div>
        )}
        {lightbox && photos.length > 0 && <Lightbox vehicleId={file.id} photos={photos} index={idx} onIndex={setPhotoIdx} onClose={() => setLightbox(false)} />}
      </div>
    </div>
  );
}

const DOC_PRESENCE_KINDS: VehicleDocumentKind[] = ['REGISTRATION_1', 'REGISTRATION_2', 'SERVICE_BOOK', 'HU_REPORT', 'APPRAISAL'];

/** Welche Dokumente digital in der Akte liegen (nur für Käufer freigegebene). „Nicht hinterlegt“ = keine digitale Kopie. */
function DocumentsPresence({ file }: { file: VehicleFile }) {
  const kinds = new Set(file.documents.map((d) => d.kind));
  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 @2xl:grid-cols-5" data-testid="documents-presence">
        {DOC_PRESENCE_KINDS.map((k) => {
          const has = kinds.has(k);
          return (
            <div key={k} className="bg-white px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">{VEHICLE_DOCUMENT_KIND_LABELS[k]}</p>
              <p className={clsx('mt-1 flex items-center gap-1.5 text-[13px] font-medium', has ? 'text-emerald-700' : 'text-slate-500')}>
                {has ? <CircleCheck className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
                {has ? 'Digital hinterlegt' : 'Nicht hinterlegt'}
              </p>
            </div>
          );
        })}
      </div>
      {file.documents.length > 0 && (
        <div className="mt-4">
          <DocumentsSection file={file} />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">„Nicht hinterlegt“ heißt: Für dieses Dokument liegt keine digitale Kopie in der Fahrzeugakte.</p>
    </div>
  );
}

/** Gesamte Fahrzeugakte als One-Pager: alle Daten gestapelt in Karten, Reihenfolge wie in der Vorlage. */
export function AuctionOnePager({ file, state, notice }: { file: VehicleFile; state: DealerAuctionState; notice: string | null }) {
  const inspected = file.inspectionCompletedAt
    ? `Vom Außendienst der Plattform aufgenommen${file.approvedAt ? `, freigegeben am ${formatDateDe(file.approvedAt)}` : ''}.`
    : undefined;
  return (
    <div className="space-y-3" id="fahrzeugakte">
      <Section id="daten" icon={Car} title="Fahrzeugdaten">
        <VehicleDataGroups file={file} state={state} />
      </Section>
      <Section id="zustand" icon={ShieldCheck} title="Fahrzeugzustand" subtitle={inspected}>
        <ConditionSummary file={file} />
      </Section>
      <Section id="schaeden" icon={Tag} title={file.damages.length ? `Fahrzeugschäden (${file.damages.length})` : 'Fahrzeugschäden'}>
        <DamageExplorer file={file} />
      </Section>
      {file.paint.length > 0 && (
        <Section id="lack" icon={Droplet} title="Lackschichtdicke">
          <PaintSection file={file} />
        </Section>
      )}
      <Section id="technik" icon={Wrench} title="Technischer Zustand">
        <ConditionSection file={file} />
      </Section>
      {file.tires.length > 0 && (
        <Section id="reifen" icon={Disc3} title="Reifen">
          <TiresSection file={file} />
        </Section>
      )}
      {file.diagnostics.length > 0 && (
        <Section id="diagnose" icon={Activity} title="Diagnose">
          <DiagnosticsSection file={file} />
        </Section>
      )}
      <Section id="dokumente" icon={FileText} title="Fahrzeugdokumente">
        <DocumentsPresence file={file} />
      </Section>
      <Section id="ausstattung" icon={Check} title={file.equipment.length ? `Ausstattung (${file.equipment.length})` : 'Ausstattung'}>
        <EquipmentChecklist items={file.equipment} columns="@md:columns-2 @3xl:columns-3" />
      </Section>
      <Section id="standort" icon={MapPin} title="Standort">
        <LocationPanel state={state} />
      </Section>
      {notice && (
        <Section id="hinweise" icon={Megaphone} title="Hinweise des Betreibers">
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-slate-700" data-testid="operator-notice">
            {notice}
          </p>
        </Section>
      )}
    </div>
  );
}
