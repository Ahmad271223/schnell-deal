'use client';

import { use } from 'react';
import { DealDetail } from '@/components/deals';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DealDetail id={id} back="/admin/verkaeufe" />;
}
