import { PAINT_POINTS, REQUIRED_PHOTO_SLOTS, TIRE_POSITIONS, type PaintPoint, type PhotoSlot } from './enums';

/** Schwellen für auffällige Lackschichtwerte (µm). Konfigurierbar über Plattform-Einstellungen. */
export interface PaintThresholds {
  flagBelowUm: number;
  flagAboveUm: number;
}

export const DEFAULT_PAINT_THRESHOLDS: PaintThresholds = { flagBelowUm: 70, flagAboveUm: 200 };

/** Markiert einen Wert nur als auffällig – bewusst KEINE Aussage über Unfallschäden (Spec §14). */
export function isPaintValueFlagged(valueUm: number, t: PaintThresholds = DEFAULT_PAINT_THRESHOLDS): boolean {
  return valueUm < t.flagBelowUm || valueUm > t.flagAboveUm;
}

export const PAINT_FLAG_HINT =
  'Auffälliger Messwert. Dies ist ein Hinweis auf eine abweichende Lackschichtdicke und keine Aussage über einen Unfallschaden.';

export interface CompletenessInput {
  vinValid: boolean;
  mileageKm: number | null;
  hasBasicData: boolean; // Hersteller, Modell, Erstzulassung, Kraftstoff, Getriebe
  photoSlots: readonly PhotoSlot[]; // vorhandene, nicht ersetzte Fotos mit Qualität != schlecht
  paintPoints: readonly PaintPoint[];
  tirePositions: readonly string[];
  featureCount: number;
  featureTotal: number;
  hasRegistrationDoc: boolean;
}

export interface CompletenessResult {
  percent: number;
  missing: string[];
  missingPhotoSlots: PhotoSlot[];
  /** Darf die Aufnahme abgeschlossen werden? (harte Pflichtpunkte) */
  canComplete: boolean;
}

/**
 * Harte Pflicht für den Abschluss: gültige FIN, Kilometerstand, Basisdaten, alle Pflichtfotos
 * (inkl. Tacho). Weiche Punkte (Lack, Reifen, Funktionsprüfung, Zulassung) fließen in den Prozentwert ein
 * und werden dem Admin als fehlend angezeigt.
 */
export function computeCompleteness(input: CompletenessInput): CompletenessResult {
  const missing: string[] = [];
  const have = new Set(input.photoSlots);
  const missingPhotoSlots = REQUIRED_PHOTO_SLOTS.filter((s) => !have.has(s));

  let score = 0;
  let total = 0;
  const add = (ok: boolean, weight: number, label: string) => {
    total += weight;
    if (ok) score += weight;
    else missing.push(label);
  };

  add(input.vinValid, 10, 'Gültige FIN');
  add(input.mileageKm !== null && input.mileageKm >= 0, 5, 'Kilometerstand');
  add(input.hasBasicData, 10, 'Fahrzeug-Stammdaten');
  const photoShare = (REQUIRED_PHOTO_SLOTS.length - missingPhotoSlots.length) / REQUIRED_PHOTO_SLOTS.length;
  total += 45;
  score += 45 * photoShare;
  if (missingPhotoSlots.length > 0) missing.push(`${missingPhotoSlots.length} Pflichtfoto(s)`);
  const paintShare = new Set(input.paintPoints).size / PAINT_POINTS.length;
  total += 10;
  score += 10 * paintShare;
  if (paintShare < 1) missing.push('Lackschichtmessung unvollständig');
  const tireShare = new Set(input.tirePositions).size / TIRE_POSITIONS.length;
  total += 10;
  score += 10 * tireShare;
  if (tireShare < 1) missing.push('Reifendaten unvollständig');
  const featureShare = input.featureTotal === 0 ? 1 : input.featureCount / input.featureTotal;
  total += 5;
  score += 5 * featureShare;
  if (featureShare < 1) missing.push('Funktionsprüfung unvollständig');
  add(input.hasRegistrationDoc, 5, 'Zulassungsbescheinigung Teil I (Foto)');

  const canComplete =
    input.vinValid && input.mileageKm !== null && input.hasBasicData && missingPhotoSlots.length === 0;

  return { percent: Math.round((score / total) * 100), missing, missingPhotoSlots, canComplete };
}
