'use client';

import { Gavel } from 'lucide-react';
import { use, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import type { DealerAuctionDetail, DealerAuctionState } from '@/lib/types';
import { LiveBidPanel } from '@/components/live-bid-panel';
import { Countdown } from '@/components/countdown';
import { AuctionBreadcrumb, AuctionHeading, AuctionMedia, AuctionOnePager, KeyFacts, LocationCard, vehicleTitle } from '@/components/auction-detail';
import { ErrorAlert, QueryState } from '@/components/ui';

export default function DealerAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['auction', id], queryFn: () => api<DealerAuctionDetail>(`/auctions/${id}`) });
  return <QueryState query={q}>{q.data && <AuctionDetailView key={id} id={id} data={q.data} />}</QueryState>;
}

const PANEL_ID = 'bietpanel';

/** Eigene Komponente je Auktion: Beim Blättern im Katalog starten Galerie und Dialoge neu. */
function AuctionDetailView({ id, data }: { id: string; data: DealerAuctionDetail }) {
  const qc = useQueryClient();
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState<unknown>(null);
  // Gleicher Cache-Eintrag wie im Bietpanel: Status (z. B. Ende) kommt live per WebSocket.
  const live = useQuery({ queryKey: ['auction-state', id], queryFn: () => api<DealerAuctionState>(`/auctions/${id}/state`), initialData: data.state, enabled: false });

  const toggleFavorite = async () => {
    setFavoriteBusy(true);
    setFavoriteError(null);
    try {
      await api(`/watchlist/${data.vehicle.id}`, { method: data.isFavorite ? 'DELETE' : 'PUT' });
      await qc.invalidateQueries({ queryKey: ['auction', id] });
      void qc.invalidateQueries({ queryKey: ['auctions'] });
    } catch (e) {
      setFavoriteError(e);
    } finally {
      setFavoriteBusy(false);
    }
  };

  const scrollTo = (elementId: string) => document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    /*
      One-Pager: links Brotkrumen, Titel, Medien (mit Umschaltern), Eckdaten und alle Fahrzeugdaten als Karten;
      rechts das Bietpanel (läuft beim Scrollen mit) und darunter Verkäufer/Standort. Schmal: Bietpanel direkt
      nach dem Titel, zusätzlich eine Leiste am unteren Rand, sobald das Panel aus dem Bild gescrollt ist.
    */
    <div className="grid gap-x-[18px] gap-y-3 pb-20 xl:grid-cols-[minmax(0,1fr)_400px] xl:pb-0 2xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 space-y-3 xl:col-start-1 xl:row-start-1">
        <AuctionBreadcrumb catalog={data.catalog} title={vehicleTitle(data.vehicle)} />
        <AuctionHeading detail={data} onToggleFavorite={toggleFavorite} favoriteBusy={favoriteBusy} onShowCondition={() => scrollTo('zustand')} />
        <AuctionMedia file={data.vehicle} live={live.data.status === 'ACTIVE'} />
        <ErrorAlert error={favoriteError} />
      </div>
      <aside
        id={PANEL_ID}
        className="min-w-0 space-y-3 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:sticky xl:top-[72px] xl:max-h-[calc(100vh-80px)] xl:self-start xl:overflow-y-auto"
        aria-label="Gebote und Standort"
      >
        <LiveBidPanel auctionId={id} initial={data.state} />
        <LocationCard state={data.state} contact={data.contact} onShowMap={() => scrollTo('standort')} />
      </aside>
      <div className="min-w-0 space-y-3 xl:col-start-1 xl:row-start-2">
        <KeyFacts file={data.vehicle} />
        <AuctionOnePager file={data.vehicle} state={data.state} notice={data.notice} />
      </div>
      <StickyBidBar state={live.data} panelId={PANEL_ID} />
    </div>
  );
}

/** Milchglas-Leiste am unteren Rand (unterhalb der Desktop-Breite), sobald das Bietpanel nicht mehr sichtbar ist. */
function StickyBidBar({ state, panelId }: { state: DealerAuctionState; panelId: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = document.getElementById(panelId);
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setShow(!entry?.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [panelId]);
  if (!show || (state.status !== 'ACTIVE' && state.status !== 'SCHEDULED')) return null;
  return (
    <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 px-4 py-2.5 xl:hidden" data-testid="sticky-bid-bar">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{state.currentBid !== null ? 'Aktuelles Gebot' : 'Startpreis'}</p>
          <p className="tabular font-display text-lg font-extrabold leading-tight text-slate-950">{formatEuro(state.currentBid ?? state.startPrice, { whole: true })}</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{state.status === 'SCHEDULED' ? 'Start' : 'Endet in'}</p>
          <Countdown endsAt={state.endsAt} startsAt={state.startsAt} status={state.status} size="sm" />
        </div>
        <button
          type="button"
          onClick={() => document.getElementById(panelId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#e30613] px-5 text-[15px] font-semibold text-white shadow-lg shadow-red-900/20 transition-transform active:scale-[0.98]"
        >
          <Gavel className="h-5 w-5" aria-hidden /> Zum Gebot
        </button>
      </div>
    </div>
  );
}
