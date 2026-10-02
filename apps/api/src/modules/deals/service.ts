import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { assertTransition, computeDealAmounts, formatEuro, type DealStatus } from '@sd/shared';
import { schema, type DbOrTx } from '../../core/db/client';
import { audit, type Actor } from '../../core/audit';
import { enqueue } from '../../core/jobs';
import { getSettings } from '../../core/settings';
import { AppError, notFound } from '../../core/errors';
import { notifyAdmins, notifyCompany } from '../notifications/service';

export type Deal = typeof schema.deals.$inferSelect;
type Auction = typeof schema.auctions.$inferSelect;
type Bid = typeof schema.bids.$inferSelect;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen

export function generatePickupCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}

async function nextNumber(tx: DbOrTx, seq: 'deal_number_seq' | 'invoice_number_seq', prefix: string): Promise<string> {
  const res = await tx.execute<{ n: string }>(sql.raw(`select nextval('${seq}')::text as n`));
  return `${prefix}-${new Date().getFullYear()}-${res.rows[0]!.n.padStart(6, '0')}`;
}

/**
 * Legt den Deal an – im SELBEN Commit wie das Auktionsende. Die Zuschlagsdaten werden als
 * Snapshot gespeichert und sind per DB-Trigger unveränderlich.
 */
export async function createDealFromAuction(
  tx: DbOrTx,
  actor: Actor,
  auction: Auction,
  winningBid: Bid,
  origin: 'AUCTION' | 'BUY_NOW' | 'MANUAL_ACCEPT',
  endedAt: Date,
): Promise<Deal> {
  const settings = await getSettings(tx);
  const [vehicle] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, auction.vehicleId));
  const [seller] = await tx.select().from(schema.companies).where(eq(schema.companies.id, vehicle!.companyId));
  const [buyer] = await tx.select().from(schema.companies).where(eq(schema.companies.id, winningBid.companyId));
  if (!vehicle || !seller || !buyer) throw new Error('Deal-Stammdaten unvollständig');

  const amounts = computeDealAmounts({
    salePrice: winningBid.amount,
    taxType: auction.taxType,
    vatRateBp: settings.vatRateBp,
    buyerFee: { pctBp: auction.buyerFeePctBp, fixed: auction.buyerFeeFixed },
    sellerFee: { pctBp: auction.sellerFeePctBp, fixed: auction.sellerFeeFixed },
  });
  const soldAt = new Date();
  const companySnap = (c: typeof seller) => ({
    id: c.id,
    name: c.name,
    legalForm: c.legalForm,
    street: c.street,
    houseNumber: c.houseNumber,
    zip: c.zip,
    city: c.city,
    vatId: c.vatId,
    registerNumber: c.registerNumber,
    contact: `${c.contactFirstName} ${c.contactLastName}`,
    phone: c.contactPhone,
    email: c.contactEmail,
  });
  const vehicleSnapshot = {
    internalNumber: vehicle.internalNumber,
    vin: vehicle.vin,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    firstRegistration: vehicle.firstRegistration,
    mileageKm: vehicle.mileageKm,
    fuel: vehicle.fuel,
    powerKw: vehicle.powerKw,
    transmission: vehicle.transmission,
    color: vehicle.color,
    licensePlate: vehicle.licensePlate,
    hasDamages: vehicle.hasDamages,
  };

  const [deal] = await tx
    .insert(schema.deals)
    .values({
      dealNumber: await nextNumber(tx, 'deal_number_seq', 'D'),
      auctionId: auction.id,
      vehicleId: vehicle.id,
      sellerCompanyId: seller.id,
      buyerCompanyId: buyer.id,
      winningBidId: winningBid.id,
      salePrice: amounts.salePrice,
      vehicleVat: amounts.vehicleVat,
      buyerFeeNet: amounts.buyerFeeNet,
      buyerFeeVat: amounts.buyerFeeVat,
      sellerFeeNet: amounts.sellerFeeNet,
      sellerFeeVat: amounts.sellerFeeVat,
      vatRateBp: amounts.vatRateBp,
      buyerTotal: amounts.buyerTotal,
      sellerPayout: amounts.sellerPayout,
      taxType: auction.taxType,
      vinSnapshot: vehicle.vin,
      vehicleSnapshot,
      sellerSnapshot: companySnap(seller),
      buyerSnapshot: companySnap(buyer),
      soldAt,
      auctionEndedAt: endedAt,
      origin,
      status: 'CREATED',
      paymentDueAt: new Date(soldAt.getTime() + settings.paymentDueDays * 86400_000),
    })
    .returning();

  await tx.insert(schema.dealStatusHistory).values({ dealId: deal!.id, fromStatus: null, toStatus: 'CREATED', changedBy: actor.userId, note: `Zuschlag (${origin})` });
  await tx.insert(schema.invoices).values([
    {
      dealId: deal!.id,
      kind: 'BUYER_FEE',
      number: await nextNumber(tx, 'invoice_number_seq', 'R'),
      net: amounts.buyerFeeNet,
      vat: amounts.buyerFeeVat,
      gross: amounts.buyerFeeNet + amounts.buyerFeeVat,
    },
    {
      dealId: deal!.id,
      kind: 'SELLER_FEE',
      number: await nextNumber(tx, 'invoice_number_seq', 'R'),
      net: amounts.sellerFeeNet,
      vat: amounts.sellerFeeVat,
      gross: amounts.sellerFeeNet + amounts.sellerFeeVat,
    },
  ]);
  await tx.insert(schema.pickups).values({
    dealId: deal!.id,
    locationStreet: auction.locationStreet ?? vehicle.locationStreet,
    locationZip: auction.locationZip ?? vehicle.locationZip,
    locationCity: auction.locationCity ?? vehicle.locationCity,
    contactName: `${seller.contactFirstName} ${seller.contactLastName}`,
    contactPhone: seller.contactPhone,
    pickupCode: generatePickupCode(),
  });
  await audit(tx, actor, {
    event: 'DEAL_CREATED',
    entityType: 'deal',
    entityId: deal!.id,
    newValue: {
      dealNumber: deal!.dealNumber,
      auctionId: auction.id,
      vehicleId: vehicle.id,
      buyerCompanyId: buyer.id,
      sellerCompanyId: seller.id,
      salePrice: amounts.salePrice,
      winningBidId: winningBid.id,
      origin,
    },
  });
  await enqueue(tx, 'pdf.deal', { dealId: deal!.id, reason: 'Zuschlag' }, { dedupeKey: `pdf:${deal!.id}:initial` });

  await notifyCompany(tx, buyer.id, {
    type: 'AUCTION_WON',
    title: `Zuschlag erhalten: ${vehicle.make ?? ''} ${vehicle.model ?? ''}`,
    body: `Sie haben das Fahrzeug ${vehicle.internalNumber} für ${formatEuro(amounts.salePrice)} erworben (Deal ${deal!.dealNumber}).`,
    link: `/haendler/kaeufe/${deal!.id}`,
  });
  await notifyCompany(tx, seller.id, {
    type: 'AUCTION_SOLD',
    title: `Fahrzeug verkauft: ${vehicle.internalNumber}`,
    body: `${vehicle.make ?? ''} ${vehicle.model ?? ''} wurde für ${formatEuro(amounts.salePrice)} verkauft (Deal ${deal!.dealNumber}).`,
    link: `/autohaus/verkauft/${deal!.id}`,
  });
  return deal!;
}

export async function lockDeal(tx: DbOrTx, id: string): Promise<Deal> {
  const [d] = await tx.select().from(schema.deals).where(eq(schema.deals.id, id)).for('update');
  if (!d) throw notFound('Deal');
  return d;
}

export async function setDealStatus(tx: DbOrTx, actor: Actor, deal: Deal, to: DealStatus, note: string | null, extra: Partial<Deal> = {}): Promise<void> {
  assertTransition('deal', deal.status, to);
  await tx
    .update(schema.deals)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(eq(schema.deals.id, deal.id));
  await tx.insert(schema.dealStatusHistory).values({ dealId: deal.id, fromStatus: deal.status, toStatus: to, changedBy: actor.userId, note });
  await audit(tx, actor, {
    event: 'DEAL_STATUS_CHANGED',
    entityType: 'deal',
    entityId: deal.id,
    oldValue: { status: deal.status },
    newValue: { status: to, note },
  });
  const statusText: Partial<Record<DealStatus, string>> = {
    PAYMENT_PENDING: 'Zahlung ausstehend',
    PAID: 'Zahlung eingegangen',
    READY_FOR_PICKUP: 'Fahrzeug abholbereit',
    PICKUP_SCHEDULED: 'Abholung geplant',
    PICKED_UP: 'Fahrzeug abgeholt',
    COMPLETED: 'Vorgang abgeschlossen',
    DISPUTED: 'Reklamation eröffnet',
    CANCELLED: 'Vorgang storniert',
  };
  const text = statusText[to];
  if (text) {
    for (const companyId of [deal.buyerCompanyId, deal.sellerCompanyId]) {
      await notifyCompany(tx, companyId, {
        type: to === 'READY_FOR_PICKUP' ? 'PICKUP_READY' : 'DEAL_STATUS_CHANGED',
        title: `${deal.dealNumber}: ${text}`,
        body: note ? `${text}. ${note}` : `${text}.`,
        link: companyId === deal.buyerCompanyId ? `/haendler/kaeufe/${deal.id}` : `/autohaus/verkauft/${deal.id}`,
        email: to !== 'PICKUP_SCHEDULED',
      });
    }
  }
}

/** Vom PDF-Job nach erfolgreicher Erstdokumentation aufgerufen: VERKAUFT → ZAHLUNG AUSSTEHEND. */
export async function markDocumentsReady(tx: DbOrTx, actor: Actor, dealId: string): Promise<void> {
  const deal = await lockDeal(tx, dealId);
  if (deal.status !== 'CREATED') return;
  await setDealStatus(tx, actor, deal, 'PAYMENT_PENDING', 'Kaufdokumente erstellt – Kaufabwicklung erforderlich');
  await notifyCompany(tx, deal.buyerCompanyId, {
    type: 'DEAL_ACTION_REQUIRED',
    title: `Kaufabwicklung erforderlich: ${deal.dealNumber}`,
    body: `Bitte überweisen Sie ${formatEuro(deal.buyerTotal)} bis ${deal.paymentDueAt?.toLocaleDateString('de-DE') ?? '–'}. Die Kaufdokumente stehen zum Download bereit.`,
    link: `/haendler/kaeufe/${deal.id}`,
  });
}

export async function assertNoOpenDealForAuction(tx: DbOrTx, auctionId: string): Promise<void> {
  const [d] = await tx.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.auctionId, auctionId)));
  if (d) throw new AppError(409, 'DEAL_EXISTS', 'Für diese Auktion existiert bereits ein Zuschlag.');
}

export { notifyAdmins };
