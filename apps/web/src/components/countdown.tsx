'use client';

import clsx from 'clsx';
import { Timer } from 'lucide-react';
import { useServerNow } from '@/lib/realtime';

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d} T ${pad(h)}:${pad(m)} h`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Restzeit auf Basis der SERVERZEIT (Offset aus WebSocket/REST), nicht der Browseruhr.
 * Das Auktionsende selbst bestimmt ausschließlich der Server.
 */
export function Countdown({ endsAt, status, size = 'md', startsAt }: { endsAt: string; status?: string; size?: 'sm' | 'md' | 'xl'; startsAt?: string }) {
  const now = useServerNow(size === 'xl' ? 250 : 1000);
  if (status === 'SCHEDULED' && startsAt) {
    const toStart = new Date(startsAt).getTime() - now;
    return (
      <span className={clsx('tabular inline-flex items-center gap-1 font-semibold text-sky-800', size === 'xl' && 'text-3xl')}>
        <Timer className={size === 'xl' ? 'h-7 w-7' : 'h-4 w-4'} aria-hidden /> Start in {formatRemaining(toStart)}
      </span>
    );
  }
  if (status && status !== 'ACTIVE') {
    return <span className={clsx('font-semibold text-slate-600', size === 'xl' && 'text-2xl')}>{status === 'CANCELLED' ? 'Abgebrochen' : 'Beendet'}</span>;
  }
  const ms = new Date(endsAt).getTime() - now;
  const urgent = ms < 2 * 60_000;
  const soon = ms < 15 * 60_000;
  return (
    <span
      className={clsx(
        'tabular inline-flex items-center gap-1 font-semibold',
        urgent ? 'text-red-700' : soon ? 'text-amber-700' : 'text-slate-900',
        size === 'xl' && 'text-4xl',
        size === 'md' && 'text-base',
        size === 'sm' && 'text-sm',
      )}
      aria-live={urgent ? 'polite' : 'off'}
    >
      <Timer className={size === 'xl' ? 'h-8 w-8' : 'h-4 w-4'} aria-hidden />
      {ms <= 0 ? 'Endzeit erreicht – wird ausgewertet' : formatRemaining(ms)}
      {urgent && ms > 0 && <span className="sr-only">Auktion endet in Kürze</span>}
    </span>
  );
}
