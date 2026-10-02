'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { homePath, useMe } from '@/lib/session';
import { Spinner } from '@/components/ui';

export default function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.data) router.replace(homePath(me.data));
    else if (me.error instanceof ApiError && me.error.status === 401) router.replace('/login');
  }, [me.data, me.error, router]);
  return <Spinner label="Weiterleitung …" />;
}
