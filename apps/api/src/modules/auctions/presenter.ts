import { and, desc, eq } from 'drizzle-orm';
import { schema, type DbOrTx } from '../../core/db/client';
import { auctionMinNext, type Auction } from './service';

export type MyStatus = 'NONE' | 'LEADING' | 'OUTBID' | 'WON' | 'LOST' | 'RESERVE_NOT_MET';

/**
 * Auktionszustand aus Sicht eines Händlers. Enthält NIE: Identitäten anderer Bieter,
 * fremde Maximalgebote, nicht freigegebene Mindestpreise, Verkäufergebühren.
 */
export async function dealerAuctionState(tx: DbOrTx, a: Auction, companyId: string, serverNow: Date) {
  const [label] = await tx
    .select({ label: schema.auctionBidders.label })
    .from(schema.auctionBidders)
    .where(and(eq(schema.auctionBidders.auctionId, a.id), eq(schema.auctionBidders.companyId, companyId)));
  const [myMax] = await tx
    .select({ maxAmount: schema.maximumBids.maxAmount, active: schema.maximumBids.active })
    .from(schema.maximumBids)
    .where(and(eq(schema.maximumBids.auctionId, a.id), eq(schema.maximumBids.companyId, companyId)));
  const [myTop] = await tx
    .select({ amount: schema.bids.amount })
    .from(schema.bids)
    .where(and(eq(schema.bids.auctionId, a.id), eq(schema.bids.companyId, companyId)))
    .orderBy(desc(schema.bids.amount))
    .limit(1);
  let leaderLabel: number | null = null;
  if (a.currentBidderCompanyId) {
    const [l] = await tx
      .select({ label: schema.auctionBidders.label })
      .from(schema.auctionBidders)
      .where(and(eq(schema.auctionBidders.auctionId, a.id), eq(schema.auctionBidders.companyId, a.currentBidderCompanyId)));
    leaderLabel = l?.label ?? null;
  }

  const leading = a.currentBidderCompanyId === companyId;
  let myStatus: MyStatus = 'NONE';
  if (myTop) {
    if (a.status === 'ENDED') {
      if (leading && (a.outcome === 'SOLD' || a.outcome === 'BUY_NOW')) myStatus = 'WON';
      else if (leading && a.outcome === 'RESERVE_NOT_MET') myStatus = 'RESERVE_NOT_MET';
      else myStatus = 'LOST';
    } else if (a.status === 'CANCELLED') myStatus = 'LOST';
    else myStatus = leading ? 'LEADING' : 'OUTBID';
  }
  const reserveMet = a.reservePrice === null ? true : (a.currentBid ?? 0) >= a.reservePrice;
  const buyNowAvailable = a.status === 'ACTIVE' && a.buyNowPrice !== null && (a.currentBid === null || a.currentBid < a.buyNowPrice);

  return {
    auctionId: a.id,
    number: a.number,
    status: a.status,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    serverNow,
    startPrice: a.startPrice,
    bidIncrement: a.bidIncrement,
    currentBid: a.currentBid,
    bidCount: a.bidCount,
    bidderCount: a.bidderCount,
    minNextBid: auctionMinNext(a),
    leaderLabel,
    reserveVisible: a.reserveVisible,
    reservePrice: a.reserveVisible ? a.reservePrice : undefined,
    reserveMet: a.reserveVisible ? reserveMet : undefined,
    buyNowPrice: buyNowAvailable ? a.buyNowPrice : null,
    antiSnipeMinutes: a.antiSnipeMinutes,
    extensionCount: a.extensionCount,
    taxType: a.taxType,
    buyerFeePctBp: a.buyerFeePctBp,
    buyerFeeFixed: a.buyerFeeFixed,
    earliestPickup: a.earliestPickup,
    location: { zip: a.locationZip, city: a.locationCity },
    outcomeForMe: a.status === 'ENDED' && myTop ? myStatus : undefined,
    version: a.version,
    me: {
      label: label?.label ?? null,
      status: myStatus,
      maxBid: myMax?.active ? myMax.maxAmount : null,
      maxBidExhausted: !!myMax && (!myMax.active || (a.currentBid !== null && myMax.maxAmount <= a.currentBid && !leading)),
      highestBid: myTop?.amount ?? null,
    },
  };
}

/** Sicht des Einlieferers (Autohaus) auf die Auktion seines Fahrzeugs: eigener Mindestpreis, keine Bieteridentitäten. */
export function sellerAuctionState(a: Auction, serverNow: Date) {
  return {
    auctionId: a.id,
    number: a.number,
    status: a.status,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    serverNow,
    startPrice: a.startPrice,
    reservePrice: a.reservePrice,
    reserveMet: a.reservePrice === null ? true : (a.currentBid ?? 0) >= a.reservePrice,
    currentBid: a.currentBid,
    bidCount: a.bidCount,
    bidderCount: a.bidderCount,
    outcome: a.outcome,
    endedAt: a.endedAt,
    sellerFeePctBp: a.sellerFeePctBp,
    sellerFeeFixed: a.sellerFeeFixed,
    taxType: a.taxType,
    extensionCount: a.extensionCount,
    version: a.version,
  };
}
