'use client';

import { use } from 'react';
import { CompanyAdminDetail } from '@/components/admin-companies';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CompanyAdminDetail id={id} />;
}
