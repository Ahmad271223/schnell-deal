import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, InvalidTransitionError } from '../state-machines';
import { computeVinCheckDigit, validateVin } from '../vin';
import { computeDealAmounts } from '../money';
import { computeCompleteness, isPaintValueFlagged } from '../inspection';
import { REQUIRED_PHOTO_SLOTS, PAINT_POINTS, TIRE_POSITIONS } from '../enums';
import { classifyQuality, computeQualityMetrics } from '../photo-quality';

describe('Zustandsmaschinen', () => {
  it('erlaubt den Auktions-Hauptpfad', () => {
    expect(canTransition('auction', 'DRAFT', 'SCHEDULED')).toBe(true);
    expect(canTransition('auction', 'SCHEDULED', 'ACTIVE')).toBe(true);
    expect(canTransition('auction', 'ACTIVE', 'ENDED')).toBe(true);
  });
  it('verbietet Rückwärtsschritte nach Ende', () => {
    expect(canTransition('auction', 'ENDED', 'ACTIVE')).toBe(false);
    expect(() => assertTransition('auction', 'ENDED', 'ACTIVE')).toThrow(InvalidTransitionError);
  });
  it('Fahrzeug kann nicht direkt aus der Aufnahme in die Auktion', () => {
    expect(canTransition('vehicle', 'INSPECTION_IN_PROGRESS', 'SCHEDULED')).toBe(false);
    expect(canTransition('vehicle', 'WAITING_REVIEW', 'SCHEDULED')).toBe(false);
  });
  it('Deal-Statuskette', () => {
    const chain = ['CREATED', 'PAYMENT_PENDING', 'PAID', 'READY_FOR_PICKUP', 'PICKUP_SCHEDULED', 'PICKED_UP', 'COMPLETED'];
    for (let i = 0; i < chain.length - 1; i++) expect(canTransition('deal', chain[i]!, chain[i + 1]!)).toBe(true);
    expect(canTransition('deal', 'COMPLETED', 'CANCELLED')).toBe(false);
  });
  it('unbekannte Status sind nie erlaubt', () => {
    expect(canTransition('vehicle', 'FOO', 'APPROVED')).toBe(false);
  });
});

describe('FIN-Validierung', () => {
  it('erkennt gültige nordamerikanische FIN mit Prüfziffer', () => {
    const r = validateVin('1M8GDM9AXKP042788');
    expect(r.formatValid).toBe(true);
    expect(r.checkDigitValid).toBe(true);
  });
  it('akzeptiert europäische FIN ohne gültige Prüfziffer als formatgültig', () => {
    const r = validateVin('WVWZZZ1KZAW000001');
    expect(r.formatValid).toBe(true);
  });
  it('normalisiert Leerzeichen und Kleinbuchstaben', () => {
    expect(validateVin('1m8gdm9a xkp042788').normalized).toBe('1M8GDM9AXKP042788');
  });
  it('lehnt I/O/Q und falsche Länge ab', () => {
    expect(validateVin('1M8GDM9AXKP04278O').formatValid).toBe(false);
    expect(validateVin('ABC').formatValid).toBe(false);
    expect(validateVin('ABC').errors.length).toBeGreaterThan(0);
  });
  it('berechnet die Prüfziffer', () => {
    expect(computeVinCheckDigit('1M8GDM9AXKP042788')).toBe('X');
  });
});

describe('Gebühren und MwSt.', () => {
  it('Regelbesteuerung: MwSt. auf Fahrzeug und Gebühren', () => {
    const a = computeDealAmounts({
      salePrice: 1_000_000,
      taxType: 'REGELBESTEUERT',
      vatRateBp: 1900,
      buyerFee: { pctBp: 100, fixed: 10_000 },
      sellerFee: { pctBp: 0, fixed: 5_000 },
    });
    expect(a.vehicleVat).toBe(190_000);
    expect(a.buyerFeeNet).toBe(20_000);
    expect(a.buyerFeeVat).toBe(3_800);
    expect(a.buyerTotal).toBe(1_000_000 + 190_000 + 20_000 + 3_800);
    expect(a.sellerPayout).toBe(1_000_000 + 190_000 - 5_000 - 950);
    expect(a.platformRevenueNet).toBe(25_000);
  });
  it('Differenzbesteuerung: keine MwSt. auf den Fahrzeugpreis', () => {
    const a = computeDealAmounts({
      salePrice: 1_000_000,
      taxType: 'DIFFERENZBESTEUERT',
      vatRateBp: 1900,
      buyerFee: { pctBp: 0, fixed: 0 },
      sellerFee: { pctBp: 0, fixed: 0 },
    });
    expect(a.vehicleVat).toBe(0);
    expect(a.buyerTotal).toBe(1_000_000);
  });
});

describe('Lackmessung', () => {
  it('markiert nur auffällige Werte', () => {
    expect(isPaintValueFlagged(120)).toBe(false);
    expect(isPaintValueFlagged(350)).toBe(true);
    expect(isPaintValueFlagged(40)).toBe(true);
  });
});

describe('Vollständigkeit', () => {
  const full = {
    vinValid: true,
    mileageKm: 50_000,
    hasBasicData: true,
    photoSlots: [...REQUIRED_PHOTO_SLOTS],
    paintPoints: [...PAINT_POINTS],
    tirePositions: [...TIRE_POSITIONS],
    featureCount: 15,
    featureTotal: 15,
    hasRegistrationDoc: true,
  };
  it('100 % wenn alles vorhanden', () => {
    const r = computeCompleteness(full);
    expect(r.percent).toBe(100);
    expect(r.canComplete).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it('Abschluss blockiert, solange ein Pflichtfoto fehlt', () => {
    const r = computeCompleteness({ ...full, photoSlots: REQUIRED_PHOTO_SLOTS.filter((s) => s !== 'ODOMETER') });
    expect(r.canComplete).toBe(false);
    expect(r.missingPhotoSlots).toEqual(['ODOMETER']);
  });
  it('Abschluss blockiert ohne gültige FIN', () => {
    expect(computeCompleteness({ ...full, vinValid: false }).canComplete).toBe(false);
  });
});

describe('Bildqualität', () => {
  const w = 64;
  const h = 64;
  it('erkennt zu dunkle Bilder', () => {
    const px = new Uint8Array(w * h).fill(10);
    expect(classifyQuality(computeQualityMetrics(px, w, h))).toBe('DARK');
  });
  it('erkennt zu helle Bilder', () => {
    const px = new Uint8Array(w * h).fill(250);
    expect(classifyQuality(computeQualityMetrics(px, w, h))).toBe('BRIGHT');
  });
  it('erkennt unscharfe (kantenarme) Bilder', () => {
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = 100 + Math.round(x / 4);
    expect(classifyQuality(computeQualityMetrics(px, w, h))).toBe('BLURRY');
  });
  it('akzeptiert kontrastreiche Bilder', () => {
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (x + y) % 4 < 2 ? 60 : 200;
    expect(classifyQuality(computeQualityMetrics(px, w, h))).toBe('OK');
  });
});
