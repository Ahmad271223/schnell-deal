'use client';

import { useState } from 'react';
import { PageHeader, Tabs } from '@/components/ui';
import { VehicleTable } from '@/components/vehicles';

const VIEWS = {
  all: { label: 'Alle', statuses: undefined },
  inspection: { label: 'In Aufnahme/Prüfung', statuses: 'DRAFT,INSPECTION_IN_PROGRESS,WAITING_REVIEW,REQUIRES_CORRECTION' },
  ready: { label: 'Freigegeben', statuses: 'APPROVED,SCHEDULED' },
  auction: { label: 'In Auktion', statuses: 'IN_AUCTION' },
  sold: { label: 'Verkauft', statuses: 'SOLD,COMPLETED' },
} as const;

export default function Page() {
  const [view, setView] = useState<keyof typeof VIEWS>('all');
  return (
    <div>
      <PageHeader title="Meine Fahrzeuge" />
      <Tabs tabs={(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => ({ id: k, label: VIEWS[k].label }))} value={view} onChange={setView} />
      <div className="mt-4">
        <VehicleTable statuses={VIEWS[view].statuses} basePath="/autohaus/fahrzeuge" />
      </div>
    </div>
  );
}
