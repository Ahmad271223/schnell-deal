export interface DealershipStats {
  kpis: {
    vehiclesToday: number;
    vehiclesWeek: number;
    vehiclesMonth: number;
    vehiclesYear: number;
    vehiclesTotal: number;
    inAuction: number;
    sold: number;
    unsold: number;
    auctionsEnded: number;
    totalSales: number;
    avgSalePrice: number | null;
    avgBids: number | null;
    avgBidders: number | null;
    inspectionAppointments: number;
    avgDaysToSale: number | null;
    saleRate: number | null;
    vehiclesPerAppointment: number | null;
  };
  series: { month: string; vehicles: number; sold: number; ended: number; avgPrice: number | null; saleRate: number | null }[];
  byMake: { make: string; count: number }[];
}

export interface DealerStats {
  bids: number;
  auctionsParticipated: number;
  purchases: number;
  purchaseVolume: number;
  avgPurchasePrice: number | null;
  openPayments: number;
  openPaymentAmount: number;
  cancellations: number;
  complaints: number;
  lastBidAt: string | null;
  lastLoginAt: string | null;
  purchaseRate: number | null;
}

export const fmtNum = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: digits }));
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`);

export interface Overview {
  today: { newRequests: number; vehiclesInspected: number; vehiclesApproved: number; activeAuctions: number; sold: number; revenue: number; platformFees: number; auctionsEnded: number; saleRate: number | null };
  month: { vehiclesInspected: number; auctioned: number; sold: number; unsold: number; totalHammer: number; avgPrice: number | null; bids: number; bidsPerVehicle: number | null; avgBidders: number | null; platformFees: number; avgDaysToSale: number | null; saleRate: number | null };
  series: { month: string; inspected: number; sold: number; ended: number; revenue: number }[];
  queue: { waitingReview: number; unplannedRequests: number; companiesInReview: number; reserveDecisions: number; openComplaints: number; failedJobs: number; overduePayments: number };
}
