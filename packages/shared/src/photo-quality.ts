import type { PhotoQuality } from './enums';

/**
 * Bildqualitätsprüfung auf Graustufen-Pixeln (0–255), identisch auf Server (sharp raw)
 * und Client (Canvas, für sofortige Rückmeldung offline).
 *
 * - Schärfe/Verwacklung: Varianz des Laplace-Operators. Unscharfe oder verwackelte
 *   Bilder haben wenig Kantenenergie → niedrige Varianz.
 * - Helligkeit: Mittelwert und Anteil (fast) schwarzer bzw. weißer Pixel.
 *
 * Die Prüfung erkennt NICHT zuverlässig, ob das Fahrzeug vollständig im Bild ist;
 * dafür zeigt die App einen Rahmen-Hinweis bei Außenaufnahmen und der Admin prüft.
 */

export interface QualityMetrics {
  laplacianVariance: number;
  meanBrightness: number;
  darkShare: number;
  brightShare: number;
  width: number;
  height: number;
}

export interface QualityThresholds {
  minLaplacianVariance: number;
  minMeanBrightness: number;
  maxMeanBrightness: number;
  maxDarkShare: number;
  maxBrightShare: number;
}

/** Kalibriert für eine Analysebreite von ~512 px. */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  minLaplacianVariance: 60,
  minMeanBrightness: 45,
  maxMeanBrightness: 225,
  maxDarkShare: 0.6,
  maxBrightShare: 0.6,
};

export const QUALITY_ANALYSIS_WIDTH = 512;

export function computeQualityMetrics(gray: ArrayLike<number>, width: number, height: number): QualityMetrics {
  const n = width * height;
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < n; i++) {
    const v = gray[i]!;
    sum += v;
    if (v < 20) dark++;
    else if (v > 235) bright++;
  }
  // Laplace-Kernel [0 1 0; 1 -4 1; 0 1 0]
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lapSum += lap;
      lapSq += lap * lap;
      count++;
    }
  }
  const lapMean = count ? lapSum / count : 0;
  const laplacianVariance = count ? lapSq / count - lapMean * lapMean : 0;
  return {
    laplacianVariance: Math.round(laplacianVariance * 10) / 10,
    meanBrightness: n ? Math.round((sum / n) * 10) / 10 : 0,
    darkShare: n ? Math.round((dark / n) * 1000) / 1000 : 0,
    brightShare: n ? Math.round((bright / n) * 1000) / 1000 : 0,
    width,
    height,
  };
}

export function classifyQuality(m: QualityMetrics, t: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS): PhotoQuality {
  if (m.meanBrightness < t.minMeanBrightness || m.darkShare > t.maxDarkShare) return 'DARK';
  if (m.meanBrightness > t.maxMeanBrightness || m.brightShare > t.maxBrightShare) return 'BRIGHT';
  if (m.laplacianVariance < t.minLaplacianVariance) return 'BLURRY';
  return 'OK';
}

export const QUALITY_RETAKE_MESSAGE = 'Bitte Foto erneut aufnehmen.';
