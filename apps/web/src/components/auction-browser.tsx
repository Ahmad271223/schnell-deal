'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { BookOpen, Car, Filter, Flame, Gauge, Gavel, Heart, MapPin, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BODY_LABELS, BODY_TYPES, FUEL_LABELS, FUEL_TYPES, kwToPs, TRANSMISSION_LABELS, TRANSMISSIONS, formatDateDe, formatKm } from '@sd/shared';
import { api, photoUrl } from '@/lib/api';
import { formatEuro, parseEuroInput, yearOf } from '@/lib/format';
import { realtime, useChannel } from '@/lib/realtime';
import type { AuctionCard } from '@/lib/types';
import { Countdown } from './countdown';
import { Button, EmptyState, ErrorAlert, Field, Input, LinkButton, Pagination, Select, Spinner } from './ui';

export type Preset = 'all' | 'ending' | 'new' | 'favorites';

interface Filters {
  q: string;
  make: string;
  model: string;
  regFrom: string;
  regTo: string;
  kmFrom: string;
  kmTo: string;
  fuel: string;
  transmission: string;
  body: string;
  powerFrom: string;
  priceFrom: string;
  priceTo: string;
  zip: string;
  radiusKm: string;
  damaged: string;
  paintFlagged: string;
  endingWithinHours: string;
  status: string;
  sort: string;
}

const EMPTY: Filters = { q: '', make: '', model: '', regFrom: '', regTo: '', kmFrom: '', kmTo: '', fuel: '', transmission: '', body: '', powerFrom: '', priceFrom: '', priceTo: '', zip: '', radiusKm: '', damaged: '', paintFlagged: '', endingWithinHours: '', status: 'active', sort: 'ending' };

function toQuery(f: Filters, preset: Preset, page: number, catalogId: string | null): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | undefined) => v && p.set(k, v);
  put('q', f.q);
  put('make', f.make);
  put('model', f.model);
  put('regFrom', f.regFrom);
  put('regTo', f.regTo);
  put('kmFrom', f.kmFrom);
  put('kmTo', f.kmTo);
  put('fuel', f.fuel);
  put('transmission', f.transmission);
  put('body', f.body);
  if (f.powerFrom) put('powerFrom', String(Math.round(Number(f.powerFrom) / 1.35962)));
  const pf = parseEuroInput(f.priceFrom);
  const pt = parseEuroInput(f.priceTo);
  if (pf !== null) put('priceFrom', String(pf));
  if (pt !== null) put('priceTo', String(pt));
  put('zip', f.zip);
  put('radiusKm', f.radiusKm);
  put('damaged', f.damaged);
  put('paintFlagged', f.paintFlagged);
  put('status', f.status);
  if (preset === 'ending') {
    p.set('endingWithinHours', f.endingWithinHours || '3');
    p.set('sort', 'ending');
  } else if (preset === 'new') {
    p.set('newWithinHours', '24');
    p.set('sort', 'newest');
  } else {
    put('endingWithinHours', f.endingWithinHours);
    put('sort', f.sort);
  }
  if (preset === 'favorites') p.set('favorites', '1');
  if (catalogId) p.set('catalogId', catalogId);
  if (page > 1) p.set('page', String(page));
  return p.toString();
}

type Chip = { id: string; label: string; patch: Partial<Filters> };
const CHIPS: Chip[] = [
  { id: 'all', label: 'Alle', patch: { body: '', fuel: '' } },
  { id: 'suv', label: 'SUV', patch: { body: 'SUV', fuel: '' } },
  { id: 'estate', label: 'Kombi', patch: { body: 'ESTATE', fuel: '' } },
  { id: 'sedan', label: 'Limousine', patch: { body: 'SEDAN', fuel: '' } },
  { id: 'van', label: 'Transporter', patch: { body: 'VAN', fuel: '' } },
  { id: 'electric', label: 'Elektro', patch: { body: '', fuel: 'ELECTRIC' } },
  { id: 'hybrid', label: 'Hybrid', patch: { body: '', fuel: 'HYBRID_PETROL' } },
  { id: 'diesel', label: 'Diesel', patch: { body: '', fuel: 'DIESEL' } },
  { id: 'petrol', label: 'Benzin', patch: { body: '', fuel: 'PETROL' } },
];

export function AuctionBrowser({ preset, title, initialQuery = '', catalogId = null }: { preset: Preset; title: string; initialQuery?: string; catalogId?: string | null }) {
  const [draft, setDraft] = useState<Filters>(() => ({ ...EMPTY, q: initialQuery }));
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY, q: initialQuery }));
  const [page, setPage] = useState(1);
  const [chip, setChip] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const qs = toQuery(filters, preset, page, catalogId);
  const key = ['auctions', preset, qs];
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => api<{ items: AuctionCard[]; hasMore: boolean; page: number; serverNow: string; catalog?: { id: string; name: string; startsAt: string | null } | null }>(`/auctions?${qs}`), refetchInterval: 60_000 });
  useEffect(() => {
    if (q.data) realtime.syncFromServer(q.data.serverNow);
  }, [q.data]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = () => {
    setFilters(draft);
    setPage(1);
  };
  const applyChip = (c: Chip) => {
    setChip(c.id);
    setDraft((d) => ({ ...d, ...c.patch }));
    setFilters((f) => ({ ...f, ...c.patch }));
    setPage(1);
  };
  const toggleFavorite = async (card: AuctionCard) => {
    await api(`/watchlist/${card.vehicleId}`, { method: card.isFavorite ? 'DELETE' : 'PUT' });
    void qc.invalidateQueries({ queryKey: ['auctions'] });
  };

  const items = q.data?.items ?? [];
  const now = Date.now();
  const endingSoon = items.filter((i) => new Date(i.endsAt).getTime() - now < 3_600_000).length;
  const showHero = preset === 'all' && !catalogId;

  return (
    <div>
      {showHero && (
        <section className="relative mb-6 overflow-hidden rounded-2xl bg-sidebar px-6 py-7 text-white shadow-lg sm:px-9 sm:py-9" data-testid="catalog-hero">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-600/25 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" aria-hidden />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Geprüfte Inzahlungnahmen
              </span>
              <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Top Fahrzeuge. Echte Chancen.</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">Täglich geprüfte Fahrzeuge von Autohäusern. Transparent. Schnell. Verbindlich.</p>
            </div>
            <div className="flex gap-3">
              <HeroStat value={items.length} label="Aktive Auktionen" />
              <HeroStat value={endingSoon} label="Endet < 1 Std." accent />
              <HeroStat value="100 %" label="Gewerbliche Händler" />
            </div>
          </div>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{showHero ? 'Aktuelle Auktionen' : title}</h2>
        <div className="flex gap-2">
          <Input placeholder="Suche Marke, Modell …" value={draft.q} onChange={set('q')} onKeyDown={(e) => e.key === 'Enter' && apply()} className="w-56" aria-label="Suche" data-testid="catalog-search" />
          <Button variant="secondary" icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} data-testid="filter-toggle">
            Filter
          </Button>
        </div>
      </div>

      {showHero && (
        <div className="mb-5 flex flex-wrap gap-2" data-testid="category-chips">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              onClick={() => applyChip(c)}
              data-testid={`chip-${c.id}`}
              className={clsx(
                'rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                chip === c.id ? 'border-brand-600 bg-brand-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {catalogId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1">
            <BookOpen className="h-4 w-4 text-slate-500" aria-hidden />
            Katalog:{' '}
            {q.data ? (q.data.catalog ? `${q.data.catalog.name}${q.data.catalog.startsAt ? ` – ${formatDateDe(q.data.catalog.startsAt)}` : ''}` : 'keine für Sie sichtbaren Fahrzeuge') : '…'}
          </span>
          <Link href="/haendler" className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
            <X className="h-4 w-4" aria-hidden /> Filter entfernen
          </Link>
        </div>
      )}
      {showFilters && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Field label="Marke"><Input value={draft.make} onChange={set('make')} /></Field>
            <Field label="Modell"><Input value={draft.model} onChange={set('model')} /></Field>
            <Field label="EZ von (Jahr)"><Input inputMode="numeric" value={draft.regFrom} onChange={set('regFrom')} /></Field>
            <Field label="EZ bis (Jahr)"><Input inputMode="numeric" value={draft.regTo} onChange={set('regTo')} /></Field>
            <Field label="km von"><Input inputMode="numeric" value={draft.kmFrom} onChange={set('kmFrom')} /></Field>
            <Field label="km bis"><Input inputMode="numeric" value={draft.kmTo} onChange={set('kmTo')} /></Field>
            <Field label="Kraftstoff">
              <Select value={draft.fuel} onChange={set('fuel')}>
                <option value="">Alle</option>
                {FUEL_TYPES.map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}
              </Select>
            </Field>
            <Field label="Getriebe">
              <Select value={draft.transmission} onChange={set('transmission')}>
                <option value="">Alle</option>
                {TRANSMISSIONS.map((t) => <option key={t} value={t}>{TRANSMISSION_LABELS[t]}</option>)}
              </Select>
            </Field>
            <Field label="Karosserie">
              <Select value={draft.body} onChange={set('body')}>
                <option value="">Alle</option>
                {BODY_TYPES.map((b) => <option key={b} value={b}>{BODY_LABELS[b]}</option>)}
              </Select>
            </Field>
            <Field label="Leistung ab (PS)"><Input inputMode="numeric" value={draft.powerFrom} onChange={set('powerFrom')} /></Field>
            <Field label="Preis von (€)"><Input inputMode="decimal" value={draft.priceFrom} onChange={set('priceFrom')} /></Field>
            <Field label="Preis bis (€)"><Input inputMode="decimal" value={draft.priceTo} onChange={set('priceTo')} /></Field>
            <Field label="Standort (PLZ)"><Input inputMode="numeric" value={draft.zip} onChange={set('zip')} /></Field>
            <Field label="Umkreis" hint="ungefähr, nach PLZ-Region">
              <Select value={draft.radiusKm} onChange={set('radiusKm')}>
                <option value="">Ohne</option>
                {[50, 100, 200, 300, 500].map((r) => <option key={r} value={r}>{r} km</option>)}
              </Select>
            </Field>
            <Field label="Schäden">
              <Select value={draft.damaged} onChange={set('damaged')}>
                <option value="">Alle</option>
                <option value="no">Ohne dokumentierte Schäden</option>
                <option value="yes">Mit dokumentierten Schäden</option>
              </Select>
            </Field>
            <Field label="Lackmessung" hint="Hinweis, keine Unfallaussage">
              <Select value={draft.paintFlagged} onChange={set('paintFlagged')}>
                <option value="">Alle</option>
                <option value="no">Unauffällig</option>
                <option value="yes">Auffällige Werte</option>
              </Select>
            </Field>
            {preset !== 'new' && (
              <Field label="Laufzeit">
                <Select value={draft.endingWithinHours} onChange={set('endingWithinHours')}>
                  <option value="">Alle</option>
                  {[1, 3, 6, 12, 24, 48].map((h) => <option key={h} value={h}>endet in ≤ {h} h</option>)}
                </Select>
              </Field>
            )}
            <Field label="Status">
              <Select value={draft.status} onChange={set('status')}>
                <option value="active">Laufend</option>
                <option value="scheduled">Demnächst</option>
                <option value="ended">Beendet (mit Teilnahme)</option>
              </Select>
            </Field>
            {preset === 'all' || preset === 'favorites' ? (
              <Field label="Sortierung">
                <Select value={draft.sort} onChange={set('sort')}>
                  <option value="ending">Endet bald</option>
                  <option value="newest">Neu eingestellt</option>
                  <option value="price_asc">Preis aufsteigend</option>
                  <option value="price_desc">Preis absteigend</option>
                </Select>
              </Field>
            ) : null}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (setDraft(EMPTY), setFilters(EMPTY), setChip('all'))}>Zurücksetzen</Button>
            <Button onClick={apply}>Anwenden</Button>
          </div>
        </div>
      )}

      {q.isLoading && <Spinner />}
      <ErrorAlert error={q.error} />
      {q.data && q.data.items.length === 0 && (
        <EmptyState title="Keine Auktionen gefunden" icon={<Car className="h-8 w-8" />}>
          {preset === 'favorites' ? 'Markieren Sie Fahrzeuge mit dem Herz, um sie hier zu beobachten.' : 'Passen Sie die Filter an oder schauen Sie später wieder vorbei.'}
        </EmptyState>
      )}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {q.data?.items.map((c, i) => <LiveAuctionCard key={c.id} card={c} index={i} queryKey={key} onFavorite={() => toggleFavorite(c)} />)}
      </div>
      {q.data && (q.data.hasMore || page > 1) && <Pagination page={page} hasMore={q.data.hasMore} onChange={setPage} />}
    </div>
  );
}

function HeroStat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div className={clsx('min-w-[104px] rounded-xl border px-4 py-3', accent ? 'border-brand-500/40 bg-brand-600/15' : 'border-white/10 bg-white/5')}>
      <p className={clsx('font-display text-2xl font-extrabold', accent ? 'text-brand-300' : 'text-white')}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function statusBadgeFor(card: AuctionCard): { label: string; cls: string; dot: string; live?: boolean } {
  if (card.status === 'SCHEDULED') return { label: 'Neu', cls: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' };
  const msLeft = new Date(card.endsAt).getTime() - Date.now();
  if (msLeft > 0 && msLeft < 3_600_000) return { label: 'Endet bald', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' };
  return { label: 'LIVE', cls: 'bg-red-50 text-brand-700 ring-brand-200', dot: 'bg-brand-500', live: true };
}

function LiveAuctionCard({ card, index, queryKey, onFavorite }: { card: AuctionCard; index: number; queryKey: unknown[]; onFavorite: () => void }) {
  const qc = useQueryClient();
  const [flash, setFlash] = useState(0);
  useChannel(card.status === 'ACTIVE' || card.status === 'SCHEDULED' ? `auction:${card.id}` : null, (e) => {
    if (e.event === 'bid') {
      qc.setQueryData<{ items: AuctionCard[] }>(queryKey, (old) =>
        old && {
          ...old,
          items: old.items.map((i) => (i.id === card.id ? { ...i, currentBid: e.data.currentBid, bidCount: e.data.bidCount, endsAt: e.data.endsAt } : i)),
        },
      );
      setFlash((f) => f + 1);
      void qc.invalidateQueries({ queryKey });
    } else if (['started', 'ended', 'cancelled', 'extended'].includes(e.event)) {
      void qc.invalidateQueries({ queryKey });
    }
  });
  const ps = kwToPs(card.powerKw);
  const price = useMemo(() => formatEuro(card.currentBid ?? card.startPrice, { whole: true }), [card.currentBid, card.startPrice]);
  const href = `/haendler/auktionen/${card.id}`;
  const badge = statusBadgeFor(card);
  return (
    <article className="rise group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }} data-testid={`auction-card-${card.number}`}>
      <Link href={href} className="relative block overflow-hidden bg-slate-100">
        {card.mainPhotoId ? (
          <img src={photoUrl(card.vehicleId, card.mainPhotoId, 'thumb')} alt={`${card.make ?? ''} ${card.model ?? ''}`} className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-300">
            <Car className="h-12 w-12" aria-hidden />
          </div>
        )}
        <span className={clsx('absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset', badge.cls)}>
          <span className={clsx('h-1.5 w-1.5 rounded-full', badge.dot, badge.live && 'live-dot')} aria-hidden />
          {badge.label}
        </span>
        {card.status !== 'SCHEDULED' && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-900/85 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-white backdrop-blur">
            <Flame className="h-3.5 w-3.5 text-brand-400" aria-hidden />
            <Countdown endsAt={card.endsAt} startsAt={card.startsAt} status={card.status} size="sm" />
          </span>
        )}
        {card.myStatus && (
          <span className={clsx('absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold text-white', card.myStatus === 'LEADING' ? 'bg-emerald-600' : 'bg-brand-600')}>
            {card.myStatus === 'LEADING' ? 'Sie führen' : 'Überboten'}
          </span>
        )}
        <button onClick={(e) => { e.preventDefault(); onFavorite(); }} className="absolute bottom-3 right-3 rounded-full bg-white/90 p-2 text-slate-500 shadow-sm backdrop-blur transition-colors hover:text-brand-600" aria-pressed={card.isFavorite} aria-label={card.isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'} data-testid={`favorite-${card.number}`}>
          <Heart className={clsx('h-4 w-4', card.isFavorite && 'fill-brand-500 text-brand-600')} />
        </button>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link href={href} className="min-w-0">
          <h3 className="truncate font-display text-base font-bold tracking-tight text-slate-900">
            {card.make} {card.model}
          </h3>
          <p className="truncate text-xs text-slate-500">{card.variant || '\u00a0'}</p>
        </Link>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span>{yearOf(card.firstRegistration)}</span>
          <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3 text-slate-400" aria-hidden />{formatKm(card.mileageKm)}</span>
          <span>{card.fuel ? FUEL_LABELS[card.fuel] : '–'}</span>
          {card.powerKw ? <span>{ps} PS</span> : null}
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
          <MapPin className="h-3 w-3" aria-hidden /> {card.locationZip} {card.locationCity}
        </div>
        <div key={flash} className={clsx('mt-4 flex items-end justify-between gap-2 border-t border-slate-100 pt-3', flash > 0 && 'flash')}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{card.currentBid !== null ? 'Aktuelles Gebot' : 'Startpreis'}</p>
            <p className="font-mono text-2xl font-black tabular-nums text-slate-900">{price}</p>
            <p className="text-[11px] text-slate-500">{card.bidCount} Gebot(e)</p>
          </div>
        </div>
        <LinkButton href={href} className="mt-3 w-full" icon={<Gavel className="h-4 w-4" />}>
          Jetzt bieten
        </LinkButton>
      </div>
    </article>
  );
}
