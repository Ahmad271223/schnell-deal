'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { BookOpen, Car, Filter, MapPin, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BODY_LABELS, BODY_TYPES, FUEL_LABELS, FUEL_TYPES, kwToPs, TRANSMISSION_LABELS, TRANSMISSIONS, formatDateDe, formatKm } from '@sd/shared';
import { api, photoUrl } from '@/lib/api';
import { formatEuro, parseEuroInput, yearOf } from '@/lib/format';
import { realtime, useChannel } from '@/lib/realtime';
import type { AuctionCard } from '@/lib/types';
import { Countdown } from './countdown';
import { Button, EmptyState, ErrorAlert, Field, Input, Pagination, Select, Spinner, StatusBadge } from './ui';

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

export function AuctionBrowser({ preset, title, initialQuery = '', catalogId = null }: { preset: Preset; title: string; initialQuery?: string; catalogId?: string | null }) {
  const [draft, setDraft] = useState<Filters>(() => ({ ...EMPTY, q: initialQuery }));
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY, q: initialQuery }));
  const [page, setPage] = useState(1);
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
  const toggleFavorite = async (card: AuctionCard) => {
    await api(`/watchlist/${card.vehicleId}`, { method: card.isFavorite ? 'DELETE' : 'PUT' });
    void qc.invalidateQueries({ queryKey: ['auctions'] });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        <div className="flex gap-2">
          <Input placeholder="Suche Marke, Modell …" value={draft.q} onChange={set('q')} onKeyDown={(e) => e.key === 'Enter' && apply()} className="w-56" aria-label="Suche" />
          <Button variant="secondary" icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            Filter
          </Button>
        </div>
      </div>

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
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
            <Button variant="ghost" onClick={() => (setDraft(EMPTY), setFilters(EMPTY))}>Zurücksetzen</Button>
            <Button onClick={apply}>Anwenden</Button>
          </div>
        </div>
      )}

      {q.isLoading && <Spinner />}
      <ErrorAlert error={q.error} />
      {q.data && q.data.items.length === 0 && (
        <EmptyState title="Keine Auktionen gefunden" icon={<Car className="h-8 w-8" />}>
          {preset === 'favorites' ? 'Markieren Sie Fahrzeuge mit dem Stern, um sie hier zu beobachten.' : 'Passen Sie die Filter an oder schauen Sie später wieder vorbei.'}
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {q.data?.items.map((c) => <LiveAuctionCard key={c.id} card={c} queryKey={key} onFavorite={() => toggleFavorite(c)} />)}
      </div>
      {q.data && (q.data.hasMore || page > 1) && <Pagination page={page} hasMore={q.data.hasMore} onChange={setPage} />}
    </div>
  );
}

function LiveAuctionCard({ card, queryKey, onFavorite }: { card: AuctionCard; queryKey: unknown[]; onFavorite: () => void }) {
  const qc = useQueryClient();
  const [flash, setFlash] = useState(0);
  useChannel(card.status === 'ACTIVE' || card.status === 'SCHEDULED' ? `auction:${card.id}` : null, (e) => {
    if (e.event === 'bid') {
      qc.setQueryData<{ items: AuctionCard[] }>(queryKey, (old) =>
        old && {
          ...old,
          // Preis/Restzeit sofort aktualisieren; den eigenen Status liefert der anschließende Server-Abruf.
          items: old.items.map((i) => (i.id === card.id ? { ...i, currentBid: e.data.currentBid, bidCount: e.data.bidCount, endsAt: e.data.endsAt } : i)),
        },
      );
      setFlash((f) => f + 1);
      // Eigenen Status genau vom Server holen (anonymisierte Labels lassen keinen Rückschluss im Client zu).
      void qc.invalidateQueries({ queryKey });
    } else if (['started', 'ended', 'cancelled', 'extended'].includes(e.event)) {
      void qc.invalidateQueries({ queryKey });
    }
  });
  const ps = kwToPs(card.powerKw);
  const price = useMemo(() => formatEuro(card.currentBid ?? card.startPrice, { whole: true }), [card.currentBid, card.startPrice]);
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <Link href={`/haendler/auktionen/${card.id}`} className="relative block bg-slate-100">
        {card.mainPhotoId ? (
          <img src={photoUrl(card.vehicleId, card.mainPhotoId, 'thumb')} alt={`${card.make ?? ''} ${card.model ?? ''}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center text-slate-400">
            <Car className="h-10 w-10" aria-hidden />
          </div>
        )}
        {card.myStatus && (
          <span className="absolute left-2 top-2">
            <StatusBadge label={card.myStatus === 'LEADING' ? 'Sie führen' : 'Überboten'} tone={card.myStatus === 'LEADING' ? 'success' : 'danger'} />
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/haendler/auktionen/${card.id}`} className="min-w-0">
            <h2 className="truncate font-semibold text-slate-900">
              {card.make} {card.model}
            </h2>
            <p className="truncate text-xs text-slate-500">{card.variant ?? ' '}</p>
          </Link>
          <button onClick={onFavorite} className="rounded p-1 text-slate-400 hover:text-amber-500" aria-pressed={card.isFavorite} aria-label={card.isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}>
            <Star className={clsx('h-5 w-5', card.isFavorite && 'fill-amber-400 text-amber-500')} />
          </button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-600">
          <div>EZ {yearOf(card.firstRegistration)}</div>
          <div>{formatKm(card.mileageKm)}</div>
          <div>{card.powerKw ? `${card.powerKw} kW / ${ps} PS` : '–'}</div>
          <div>{card.fuel ? FUEL_LABELS[card.fuel] : '–'}</div>
          <div className="col-span-2 flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden /> {card.locationZip} {card.locationCity}
          </div>
        </dl>
        <div className="mt-2 flex flex-wrap gap-1">
          {card.hasDamages && <StatusBadge label="Schäden dokumentiert" tone="warning" />}
          {card.paintFlagged && <StatusBadge label="Lackwerte auffällig" tone="warning" />}
        </div>
        <div key={flash} className={clsx('mt-auto flex items-end justify-between gap-2 rounded-md pt-3', flash > 0 && 'flash')}>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{card.currentBid !== null ? 'Aktuelles Gebot' : 'Startpreis'}</p>
            <p className="tabular text-xl font-bold">{price}</p>
            <p className="text-[11px] text-slate-500">{card.bidCount} Gebot(e)</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{card.status === 'SCHEDULED' ? 'Start' : 'Restzeit'}</p>
            <Countdown endsAt={card.endsAt} startsAt={card.startsAt} status={card.status} size="sm" />
          </div>
        </div>
      </div>
    </article>
  );
}
