import { formatEuro } from '@sd/shared';

export { formatEuro };

/** "10.100" / "10100" / "10.100,50" / "10100.5" → Cent. Ungültig → null. */
export function parseEuroInput(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '');
  if (!s) return null;
  let normalized: string;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else normalized = s;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToEuroInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

export function yearOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 4) : '–';
}

export function berlinDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

/** datetime-local (Ortszeit des Browsers) → ISO mit Offset. */
export function localInputToIso(v: string): string {
  return new Date(v).toISOString();
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
