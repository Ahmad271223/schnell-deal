import type { TaxType } from './enums';

/** Alle Beträge sind ganzzahlige Cent. Prozentsätze in Basispunkten (1 % = 100 bp). */

export function percentOf(amount: number, basisPoints: number): number {
  return Math.round((amount * basisPoints) / 10_000);
}

export interface FeeConfig {
  pctBp: number;
  fixed: number;
}

export function computeFee(price: number, fee: FeeConfig): number {
  return percentOf(price, fee.pctBp) + fee.fixed;
}

export interface DealAmounts {
  salePrice: number; // Zuschlag (bei Regelbesteuerung netto, bei §25a Endbetrag)
  vehicleVat: number; // MwSt. auf den Fahrzeugpreis (0 bei §25a)
  buyerFeeNet: number;
  buyerFeeVat: number;
  sellerFeeNet: number;
  sellerFeeVat: number;
  vatRateBp: number;
  /** Was der Käufer insgesamt zahlt: Fahrzeug (+MwSt.) + Käufergebühr (+MwSt.). */
  buyerTotal: number;
  /** Was der Verkäufer ausgezahlt bekommt: Fahrzeug (+MwSt.) − Verkäufergebühr (+MwSt.). */
  sellerPayout: number;
  /** Plattformerlös netto (beide Gebühren). */
  platformRevenueNet: number;
}

export function computeDealAmounts(params: {
  salePrice: number;
  taxType: TaxType;
  vatRateBp: number;
  buyerFee: FeeConfig;
  sellerFee: FeeConfig;
}): DealAmounts {
  const { salePrice, taxType, vatRateBp } = params;
  const vehicleVat = taxType === 'REGELBESTEUERT' ? percentOf(salePrice, vatRateBp) : 0;
  const buyerFeeNet = computeFee(salePrice, params.buyerFee);
  const sellerFeeNet = computeFee(salePrice, params.sellerFee);
  const buyerFeeVat = percentOf(buyerFeeNet, vatRateBp);
  const sellerFeeVat = percentOf(sellerFeeNet, vatRateBp);
  return {
    salePrice,
    vehicleVat,
    buyerFeeNet,
    buyerFeeVat,
    sellerFeeNet,
    sellerFeeVat,
    vatRateBp,
    buyerTotal: salePrice + vehicleVat + buyerFeeNet + buyerFeeVat,
    sellerPayout: salePrice + vehicleVat - sellerFeeNet - sellerFeeVat,
    platformRevenueNet: buyerFeeNet + sellerFeeNet,
  };
}

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatEuro(cents: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (cents === null || cents === undefined) return '–';
  return (opts.whole ? EUR0 : EUR).format(cents / 100);
}

export function euroToCents(euro: number): number {
  return Math.round(euro * 100);
}
