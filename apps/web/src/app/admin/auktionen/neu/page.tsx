'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AuctionForm, emptyAuctionForm, toAuctionPayload } from '@/components/auction-form';
import type { VehicleRow } from '@/components/vehicles';
import { PageHeader, QueryState } from '@/components/ui';

function NewAuction() {
  const params = useSearchParams();
  const router = useRouter();
  const vehicles = useQuery({ queryKey: ['vehicles', 'APPROVED,UNSOLD', ''], queryFn: () => api<(VehicleRow & { locationZip?: string })[]>('/vehicles?status=APPROVED,UNSOLD') });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back="/admin/auktionen" title="Auktion anlegen" subtitle="Zeitauktion – Gebote sind verbindlich. Der Start erfolgt automatisch zur Startzeit." />
      <QueryState query={vehicles}>
        <AuctionForm
          initial={emptyAuctionForm(params.get('vehicleId') ?? '')}
          vehicles={(vehicles.data ?? []).map((v) => ({ id: v.id, label: `${v.internalNumber} · ${v.make ?? ''} ${v.model ?? ''} · ${v.companyName}`, city: v.locationCity }))}
          submitLabel="Auktion anlegen"
          onSubmit={async (v, schedule) => {
            const created = await api<{ id: string }>('/admin/auctions', { method: 'POST', body: toAuctionPayload(v) });
            if (schedule) await api(`/admin/auctions/${created.id}/schedule`, { method: 'POST' });
            router.push(`/admin/auktionen/${created.id}`);
          }}
        />
      </QueryState>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewAuction />
    </Suspense>
  );
}
