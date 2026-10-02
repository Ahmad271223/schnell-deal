/**
 * FIN/VIN-Validierung nach ISO 3779.
 *
 * - 17 Zeichen, nur A–Z (ohne I, O, Q) und 0–9.
 * - Die Prüfziffer an Position 9 ist nur in Nordamerika verpflichtend. Europäische
 *   FINs tragen dort häufig ein beliebiges Zeichen. Deshalb unterscheiden wir:
 *   `format` (zwingend) und `checkDigit` (nur Hinweis).
 */

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function computeVinCheckDigit(vin: string): string | null {
  if (!VIN_RE.test(vin)) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const value = /[0-9]/.test(ch) ? Number(ch) : TRANSLITERATION[ch];
    if (value === undefined) return null;
    sum += value * WEIGHTS[i]!;
  }
  const rest = sum % 11;
  return rest === 10 ? 'X' : String(rest);
}

export interface VinValidation {
  normalized: string;
  formatValid: boolean;
  checkDigitValid: boolean;
  errors: string[];
}

export function validateVin(input: string): VinValidation {
  const normalized = normalizeVin(input);
  const errors: string[] = [];
  if (normalized.length !== 17) errors.push('Die FIN muss genau 17 Zeichen lang sein.');
  if (/[IOQ]/.test(normalized)) errors.push('Die Buchstaben I, O und Q sind in einer FIN nicht zulässig.');
  if (!/^[A-Z0-9]*$/.test(normalized)) errors.push('Die FIN darf nur Buchstaben und Ziffern enthalten.');
  const formatValid = VIN_RE.test(normalized);
  const expected = formatValid ? computeVinCheckDigit(normalized) : null;
  const checkDigitValid = formatValid && expected === normalized[8];
  return { normalized, formatValid, checkDigitValid, errors };
}
