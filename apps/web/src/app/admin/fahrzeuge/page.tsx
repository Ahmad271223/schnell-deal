'use client';

import { useState } from 'react';
import { Input, PageHeader, Tabs } from '@/components/ui';
import { VehicleTable } from '@/components/vehicles';

const VIEWS = {
  all: { label: 'Alle', statuses: undefined },
  inspection: { label: 'In Aufnahme', statuses: 'DRAFT,INSPECTION_IN_PROGRESS,REQUIRES_CORRECTION' },
  review: { label: 'Wartet auf Prüfung', statuses: 'WAITING_REVIEW' },
  approved: { label: 'Freigegeben', statuses: 'APPROVED,SCHEDULED' },
  auction: { label: 'In Auktion', statuses: 'IN_AUCTION' },
  sold: { label: 'Verkauft', statuses: 'SOLD,COMPLETED' },
  unsold: { label: 'Nicht verkauft', statuses: 'UNSOLD' },
} as const;

export default function Page() {
  const [view, setView] = useState<keyof typeof VIEWS>('all');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  return (
    <div>
      <PageHeader
        title="Fahrzeuge"
        subtitle="Interner Fahrzeugbestand mit allen Fahrzeugakten"
        actions={<Input placeholder="FIN, Fahrzeug-ID, Marke …" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setApplied(q)} className="w-64" aria-label="Suche" />}
      />
      <Tabs tabs={(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => ({ id: k, label: VIEWS[k].label }))} value={view} onChange={setView} />
      <div className="mt-4">
        <VehicleTable statuses={VIEWS[view].statuses} basePath="/admin/fahrzeuge" showCompany q={applied} />
      </div>
    </div>
  );
}
