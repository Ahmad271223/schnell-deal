'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BiddingStatus, CompanyRole, CompanyStatus, CompanyType, LegalKind, PlatformRole } from '@sd/shared';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; email: string; firstName: string; lastName: string; platformRole: PlatformRole };
  company: {
    id: string;
    name: string;
    type: CompanyType;
    status: CompanyStatus;
    role: CompanyRole;
    biddingStatus: BiddingStatus | null;
    blockedUntil: string | null;
  } | null;
  pendingLegal: { id: string; kind: LegalKind; version: string; title: string }[];
  /** Serverseitig konfigurierte Zusatzfunktionen (z. B. KI-Bilderkennung nur mit API-Schlüssel). */
  features: { aiVision: boolean };
  serverTime: string;
}

export type Area = 'admin' | 'autohaus' | 'haendler' | 'aussendienst';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

export function areaOf(me: Me): Area | null {
  const r = me.user.platformRole;
  if (r === 'ADMIN' || r === 'SUPERADMIN') return 'admin';
  if (r === 'INSPECTOR') return 'aussendienst';
  if (me.company?.type === 'DEALERSHIP') return 'autohaus';
  if (me.company?.type === 'DEALER') return 'haendler';
  return null;
}

export function homePath(me: Me): string {
  if (me.company && me.company.status !== 'APPROVED') return '/registrierung/status';
  const area = areaOf(me);
  return area ? `/${area}` : '/login';
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    window.location.href = '/login';
  };
}

export function isManager(me: Me | undefined): boolean {
  return !!me?.company && (me.company.role === 'OWNER' || me.company.role === 'MANAGER');
}
