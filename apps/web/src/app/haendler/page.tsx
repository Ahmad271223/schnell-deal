'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuctionBrowser } from '@/components/auction-browser';
import { Spinner } from '@/components/ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Übernimmt Suchbegriff (?q=, aus der Kopfzeile) und Katalog (?katalog=, aus der Auktionsseite) aus der URL. */
function AuctionsFromUrl() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const katalog = params.get('katalog');
  const catalogId = katalog && UUID.test(katalog) ? katalog : null;
  return <AuctionBrowser key={`${q}|${catalogId ?? ''}`} preset="all" title="Auktionen" initialQuery={q} catalogId={catalogId} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuctionsFromUrl />
    </Suspense>
  );
}
