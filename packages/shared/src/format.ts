export const TIME_ZONE = 'Europe/Berlin';

const DATE_TIME = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const DATE = new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });

type DateInput = Date | string | null | undefined;

function toDate(v: DateInput): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "03.10.2026, 10:30 Uhr" */
export function formatDateTimeDe(v: DateInput): string {
  const d = toDate(v);
  return d ? `${DATE_TIME.format(d)} Uhr` : '–';
}

export function formatDateDe(v: DateInput): string {
  const d = toDate(v);
  return d ? DATE.format(d) : '–';
}

export function formatTimeDe(v: DateInput): string {
  const d = toDate(v);
  return d ? TIME.format(d) : '–';
}

/** ISO-Datum "2026-10-03" → "03.10.2026" ohne Zeitzonenverschiebung. */
export function formatIsoDateDe(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return '–';
  return `${new Intl.NumberFormat('de-DE').format(km)} km`;
}

/** Kurzname "Max M." für Mitarbeiter-Hinweise gegenüber Autohäusern. */
export function shortName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName.charAt(0)}.`;
}

export function kwToPs(kw: number | null | undefined): number | null {
  return kw === null || kw === undefined ? null : Math.round(kw * 1.35962);
}
