'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DealerAuctionDetail, DealerAuctionState } from '@/lib/types';
import { LiveBidPanel } from '@/components/live-bid-panel';
import { AuctionBreadcrumb, AuctionHeading, AuctionMedia, AuctionOnePager, KeyFacts, LocationCard, vehicleTitle } from '@/components/auction-detail';
import { ErrorAlert, QueryState } from '@/components/ui';

export default function DealerAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['auction', id], queryFn: () => api<DealerAuctionDetail>(`/auctions/${id}`) });
  return <QueryState query={q}>{q.data && <AuctionDetailView key={id} id={id} data={q.data} />}</QueryState>;
}

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
      rechts das Bietpanel (läuft beim Scrollen mit) und darunter Verkäufer/Standort.
    */
    <div className="grid gap-x-[18px] gap-y-3 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 space-y-3 xl:col-start-1 xl:row-start-1">
        <AuctionBreadcrumb catalog={data.catalog} title={vehicleTitle(data.vehicle)} />
        <AuctionHeading detail={data} onToggleFavorite={toggleFavorite} favoriteBusy={favoriteBusy} onShowCondition={() => scrollTo('zustand')} />
        <AuctionMedia file={data.vehicle} live={live.data.status === 'ACTIVE'} />
        <ErrorAlert error={favoriteError} />
      </div>
      <aside
        className="min-w-0 space-y-[19px] xl:sticky xl:top-[66px] xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:max-h-[calc(100vh-78px)] xl:self-start xl:overflow-y-auto"
        aria-label="Gebote und Standort"
      >
        <LiveBidPanel auctionId={id} initial={data.state} />
        <LocationCard state={data.state} contact={data.contact} onShowMap={() => scrollTo('standort')} />
      </aside>
      <div className="min-w-0 space-y-3 xl:col-start-1 xl:row-start-2">
        <KeyFacts file={data.vehicle} />
        <AuctionOnePager file={data.vehicle} state={data.state} />
      </div>
    </div>
  );
}
