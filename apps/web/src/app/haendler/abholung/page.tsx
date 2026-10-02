'use client';

import { DealsList } from '@/components/deals';

export default function Page() {
  return <DealsList basePath="/haendler/kaeufe" title="Abholung" filter={(d) => ['PAID', 'READY_FOR_PICKUP', 'PICKUP_SCHEDULED'].includes(d.status)} />;
}
