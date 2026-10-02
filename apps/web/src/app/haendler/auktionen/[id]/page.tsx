'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, vehicleVideoUrl } from '@/lib/api';
import type { DealerAuctionDetail, DealerAuctionState } from '@/lib/types';
import { LiveBidPanel } from '@/components/live-bid-panel';
import { AuctionBreadcrumb, AuctionGallery, AuctionHeading, AuctionVehicleTabs, KeyFacts, LocationCard, vehicleTitle, type AuctionTab } from '@/components/auction-detail';
import { ErrorAlert, QueryState } from '@/components/ui';

export default function DealerAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['auction', id], queryFn: () => api<DealerAuctionDetail>(`/auctions/${id}`) });
  return <QueryState query={q}>{q.data && <AuctionDetailView key={id} id={id} data={q.data} />}</QueryState>;
}

/** Eigene Komponente je Auktion: Beim Blättern im Katalog starten Reiter, Galerie und Dialoge neu. */
function AuctionDetailView({ id, data }: { id: string; data: DealerAuctionDetail }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AuctionTab>('overview');
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

  const showTab = (t: AuctionTab) => {
    setTab(t);
    requestAnimationFrame(() => document.getElementById('fahrzeugakte')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    /*
      Raster nach Vorlage (1536 px): links ca. 1027 px (Brotkrumen, Galerie, Titel, Eckdaten, Reiter), rechts 460 px
      (Bietpanel ab Oberkante, darunter Verkäufer/Standort), Abstand 18 px. Schmal: Bietpanel direkt nach dem Titel.
      Breit läuft die rechte Spalte beim Scrollen mit und ist bei Überlänge selbst scrollbar.
    */
    <div className="grid gap-x-[18px] gap-y-3 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 space-y-3 xl:col-start-1 xl:row-start-1">
        <AuctionBreadcrumb catalog={data.catalog} title={vehicleTitle(data.vehicle)} />
        <AuctionGallery vehicleId={data.vehicle.id} photos={data.vehicle.photos} live={live.data.status === 'ACTIVE'} />
        {data.vehicle.hasEngineVideo && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-black" data-testid="engine-video">
            <video src={vehicleVideoUrl(data.vehicle.id)} controls preload="metadata" playsInline className="aspect-video w-full bg-black" />
            <p className="bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300">Motor-/Fahrzeugvideo</p>
          </div>
        )}
        <div className="pt-2">
          <AuctionHeading detail={data} onToggleFavorite={toggleFavorite} favoriteBusy={favoriteBusy} onShowCondition={() => showTab('condition')} />
        </div>
        <ErrorAlert error={favoriteError} />
      </div>
      <aside
        className="min-w-0 space-y-[19px] xl:sticky xl:top-[66px] xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:max-h-[calc(100vh-78px)] xl:self-start xl:overflow-y-auto"
        aria-label="Gebote und Standort"
      >
        <LiveBidPanel auctionId={id} initial={data.state} />
        <LocationCard state={data.state} contact={data.contact} onShowMap={() => showTab('location')} />
      </aside>
      <div className="min-w-0 space-y-3 xl:col-start-1 xl:row-start-2">
        <KeyFacts file={data.vehicle} />
        <AuctionVehicleTabs file={data.vehicle} state={data.state} tab={tab} onTab={setTab} />
      </div>
    </div>
  );
}
