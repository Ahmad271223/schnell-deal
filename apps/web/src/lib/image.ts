'use client';

import { classifyQuality, computeQualityMetrics, QUALITY_ANALYSIS_WIDTH, type PhotoQuality } from '@sd/shared';

/**
 * Sofortige Qualitätsprüfung im Browser (auch offline) – identischer Algorithmus wie auf dem Server.
 * Das Original wird unverändert hochgeladen; geprüft wird eine verkleinerte Graustufenkopie.
 */
export async function checkPhotoQuality(file: Blob): Promise<PhotoQuality> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, QUALITY_ANALYSIS_WIDTH / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'OK';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) gray[j] = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    bitmap.close();
    return classifyQuality(computeQualityMetrics(gray, w, h));
  } catch {
    // Nicht analysierbar (z. B. Format) → der Server prüft verbindlich.
    return 'OK';
  }
}

/** FIN per Barcode/QR scannen, sofern der Browser die BarcodeDetector-API unterstützt (z. B. Chrome Android). */
export function barcodeSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export async function scanBarcode(file: Blob): Promise<string | null> {
  if (!barcodeSupported()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Detector = (window as any).BarcodeDetector;
  const detector = new Detector({ formats: ['code_39', 'code_128', 'qr_code', 'data_matrix', 'pdf417'] });
  const bitmap = await createImageBitmap(file);
  const codes: { rawValue: string }[] = await detector.detect(bitmap);
  bitmap.close();
  for (const c of codes) {
    const candidate = c.rawValue.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = candidate.match(/[A-HJ-NPR-Z0-9]{17}/);
    if (match) return match[0];
  }
  return null;
}
