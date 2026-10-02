import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  approxCoordinatesForZip,
  AUCTION_STATUSES,
  auctionListQuerySchema,
  auctionParamsSchema,
  auctionUpdateSchema,
  buyNowSchema,
  extendAuctionSchema,
  maxBidSchema,
  placeBidSchema,
  uuidSchema,
  type AuctionParamsInput,
} from '@sd/shared';
import { db, schema, type DbOrTx } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, companyOf, getAuth, isAdmin, requireAdmin, requireAuth, requireCompany, type AuthUser } from '../../core/auth';
import { audit } from '../../core/audit';
import { getSettings } from '../../core/settings';
import { publish, channels } from '../../core/realtime';
import { buildVehicleFile } from '../vehicles/presenter';
import { createDealFromAuction } from '../deals/service';
import { notifyCompany } from '../notifications/service';
import { dealerAuctionVisibility } from './access';
import { rateMax } from '../../config';
import { dealerAuctionState, sellerAuctionState } from './presenter';
import {
  activateAuction,
  cancelAuction,
  changeEndTime,
  dbClock,
  lockAuction,
  processBid,
  type Auction,
} from './service';

const aid = (req: FastifyRequest) => parse(uuidSchema, (req.params as { id: string }).id);
const PAGE_SIZE = 24;

async function loadVehicleForAuction(tx: DbOrTx, vehicleId: string) {
  const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).for('update');
  if (!v) throw notFound('Fahrzeug');
  return v;
}

async function validateParams(tx: DbOrTx, input: Partial<AuctionParamsInput>, existing?: Auction) {
  const startPrice = input.startPrice ?? existing?.startPrice;
  const reserve = input.reservePrice !== undefined ? input.reservePrice : existing?.reservePrice;
  const buyNow = input.buyNowPrice !== undefined ? input.buyNowPrice : existing?.buyNowPrice;
  if (startPrice !== undefined && reserve !== null && reserve !== undefined && reserve < startPrice) {
    throw new AppError(400, 'RESERVE_BELOW_START', 'Der Mindestpreis darf nicht unter dem Startpreis liegen.');
  }
  if (buyNow !== null && buyNow !== undefined && startPrice !== undefined) {
    if (buyNow <= startPrice) throw new AppError(400, 'BUY_NOW_TOO_LOW', 'Der Sofortkaufpreis muss über dem Startpreis liegen.');
    if (reserve !== null && reserve !== undefined && buyNow < reserve) throw new AppError(400, 'BUY_NOW_BELOW_RESERVE', 'Der Sofortkaufpreis darf nicht unter dem Mindestpreis liegen.');
  }
  if (input.dealerGroupId) {
    const [g] = await tx.select({ id: schema.dealerGroups.id }).from(schema.dealerGroups).where(eq(schema.dealerGroups.id, input.dealerGroupId));
    if (!g) throw new AppError(400, 'INVALID_GROUP', 'Unbekannte Händlergruppe.');
  }
  if (input.catalogId) {
    const [c] = await tx.select({ id: schema.catalogs.id }).from(schema.catalogs).where(eq(schema.catalogs.id, input.catalogId));
    if (!c) throw new AppError(400, 'INVALID_CATALOG', 'Unbekannter Katalog.');
  }
}

/**
 * Katalog-Kontext für die Händleransicht: Name, Termin und Position der Auktion innerhalb der Auktionen
 * dieses Katalogs, die genau dieser Händler sehen darf (gleiche Sichtbarkeitsregel wie in der Liste).
 */
async function catalogContext(tx: DbOrTx, user: AuthUser, a: { id: string; catalogId: string | null }) {
  if (!a.catalogId) return null;
  const [cat] = await tx
    .select({ id: schema.catalogs.id, name: schema.catalogs.name, startsAt: schema.catalogs.startsAt })
    .from(schema.catalogs)
    .where(eq(schema.catalogs.id, a.catalogId));
  if (!cat) return null;
  const rows = await tx
    .select({ id: schema.auctions.id })
    .from(schema.auctions)
    .leftJoin(schema.catalogVehicles, and(eq(schema.catalogVehicles.catalogId, schema.auctions.catalogId), eq(schema.catalogVehicles.vehicleId, schema.auctions.vehicleId)))
    .where(and(eq(schema.auctions.catalogId, a.catalogId), dealerAuctionVisibility(user)))
    .orderBy(sql`coalesce(${schema.catalogVehicles.sort}, 2147483647)`, asc(schema.auctions.endsAt), asc(schema.auctions.number));
  const index = rows.findIndex((r) => r.id === a.id);
  return {
    id: cat.id,
    name: cat.name,
    startsAt: cat.startsAt ? cat.startsAt.toISOString() : null,
    position: index >= 0 ? index + 1 : null,
    total: rows.length,
    prevAuctionId: index > 0 ? rows[index - 1]!.id : null,
    nextAuctionId: index >= 0 && index < rows.length - 1 ? rows[index + 1]!.id : null,
  };
}

export async function auctionRoutes(app: FastifyInstance): Promise<void> {
  // =================================================================================
  // Admin
  // =================================================================================
  app.get('/admin/auctions', { preHandler: requireAdmin }, async (req) => {
    const q = parse(
      z.object({ status: z.enum(AUCTION_STATUSES).optional(), catalogId: uuidSchema.optional(), outcome: z.string().optional() }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.status) where.push(eq(schema.auctions.status, q.status));
    if (q.catalogId) where.push(eq(schema.auctions.catalogId, q.catalogId));
    if (q.outcome) where.push(sql`${schema.auctions.outcome}::text = ${q.outcome}`);
    return db
      .select({
        id: schema.auctions.id,
        number: schema.auctions.number,
        status: schema.auctions.status,
        outcome: schema.auctions.outcome,
        startsAt: schema.auctions.startsAt,
        endsAt: schema.auctions.endsAt,
        startPrice: schema.auctions.startPrice,
        reservePrice: schema.auctions.reservePrice,
        currentBid: schema.auctions.currentBid,
        bidCount: schema.auctions.bidCount,
        bidderCount: schema.auctions.bidderCount,
        resolvedAt: schema.auctions.resolvedAt,
        vehicleId: schema.vehicles.id,
        internalNumber: schema.vehicles.internalNumber,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        companyName: schema.companies.name,
        catalogName: schema.catalogs.name,
        dealId: sql<string | null>`(select d.id from deals d where d.auction_id = ${schema.auctions.id})`,
      })
      .from(schema.auctions)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.auctions.vehicleId))
      .innerJoin(schema.companies, eq(schema.companies.id, schema.vehicles.companyId))
      .leftJoin(schema.catalogs, eq(schema.catalogs.id, schema.auctions.catalogId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.auctions.startsAt))
      .limit(500);
  });

  app.get('/admin/auctions/:id', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    if (!a) throw notFound('Auktion');
    const bids = await db
      .select({
        id: schema.bids.id,
        sequence: schema.bids.sequence,
        amount: schema.bids.amount,
        kind: schema.bids.kind,
        status: schema.bids.status,
        serverTime: schema.bids.serverTime,
        transactionId: schema.bids.transactionId,
        ip: schema.bids.ip,
        companyId: schema.bids.companyId,
        companyName: schema.companies.name,
        userEmail: schema.users.email,
        label: schema.auctionBidders.label,
      })
      .from(schema.bids)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.bids.companyId))
      .innerJoin(schema.users, eq(schema.users.id, schema.bids.userId))
      .leftJoin(schema.auctionBidders, and(eq(schema.auctionBidders.auctionId, schema.bids.auctionId), eq(schema.auctionBidders.companyId, schema.bids.companyId)))
      .where(eq(schema.bids.auctionId, id))
      .orderBy(desc(schema.bids.sequence));
    const maxBids = await db
      .select({ companyName: schema.companies.name, maxAmount: schema.maximumBids.maxAmount, active: schema.maximumBids.active, updatedAt: schema.maximumBids.updatedAt })
      .from(schema.maximumBids)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.maximumBids.companyId))
      .where(eq(schema.maximumBids.auctionId, id));
    const [deal] = await db.select({ id: schema.deals.id, dealNumber: schema.deals.dealNumber, status: schema.deals.status }).from(schema.deals).where(eq(schema.deals.auctionId, id));
    const vehicle = await buildVehicleFile(db, a.vehicleId, 'admin');
    return { auction: a, bids, maxBids, deal: deal ?? null, vehicle, serverNow: await dbClock(db) };
  });

  app.post('/admin/auctions', { preHandler: requireAdmin }, async (req, reply) => {
    const input = parse(auctionParamsSchema, req.body);
    const settings = await getSettings();
    const created = await db.transaction(async (tx) => {
      const v = await loadVehicleForAuction(tx, input.vehicleId);
      if (v.status !== 'APPROVED' && v.status !== 'UNSOLD') {
        throw new AppError(409, 'VEHICLE_NOT_READY', 'Nur geprüfte und freigegebene Fahrzeuge können in eine Auktion.');
      }
      await validateParams(tx, input);
      const [open] = await tx
        .select({ id: schema.auctions.id })
        .from(schema.auctions)
        .where(and(eq(schema.auctions.vehicleId, v.id), inArray(schema.auctions.status, ['DRAFT', 'SCHEDULED', 'ACTIVE'])));
      if (open) throw new AppError(409, 'AUCTION_EXISTS', 'Für dieses Fahrzeug existiert bereits eine offene Auktion.');
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('auction_number_seq')::text as n`)).rows as [{ n: string }];
      const [a] = await tx
        .insert(schema.auctions)
        .values({
          number: `A-${new Date().getFullYear()}-${n.padStart(6, '0')}`,
          vehicleId: v.id,
          catalogId: input.catalogId ?? null,
          status: 'DRAFT',
          startsAt,
          endsAt,
          originalEndsAt: endsAt,
          durationMinutes: input.durationMinutes,
          startPrice: input.startPrice,
          reservePrice: input.reservePrice,
          reserveVisible: input.reserveVisible,
          bidIncrement: input.bidIncrement,
          buyNowPrice: input.buyNowPrice ?? null,
          dealerGroupId: input.dealerGroupId ?? null,
          buyerFeePctBp: input.buyerFeePctBp ?? settings.buyerFeePctBp,
          buyerFeeFixed: input.buyerFeeFixed ?? settings.buyerFeeFixed,
          sellerFeePctBp: input.sellerFeePctBp ?? settings.sellerFeePctBp,
          sellerFeeFixed: input.sellerFeeFixed ?? settings.sellerFeeFixed,
          taxType: input.taxType,
          locationStreet: input.locationStreet ?? v.locationStreet,
          locationZip: input.locationZip ?? v.locationZip,
          locationCity: input.locationCity ?? v.locationCity,
          earliestPickup: input.earliestPickup ?? null,
          antiSnipeMinutes: input.antiSnipeMinutes,
          createdBy: getAuth(req).userId,
        })
        .returning();
      if (input.catalogId) {
        await tx.insert(schema.catalogVehicles).values({ catalogId: input.catalogId, vehicleId: v.id }).onConflictDoNothing();
      }
      await audit(tx, actorOf(req), { event: 'AUCTION_CREATED', entityType: 'auction', entityId: a!.id, newValue: input });
      return a!;
    });
    return reply.status(201).send({ id: created.id, number: created.number });
  });

  app.patch('/admin/auctions/:id', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    const input = parse(auctionUpdateSchema, req.body);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'DRAFT' && a.status !== 'SCHEDULED') {
        throw new AppError(409, 'AUCTION_LOCKED', 'Parameter können nur vor dem Start geändert werden. Für laufende Auktionen: Endzeit ändern oder stoppen.');
      }
      await validateParams(tx, input, a);
      const startsAt = input.startsAt ? new Date(input.startsAt) : a.startsAt;
      const duration = input.durationMinutes ?? a.durationMinutes;
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const changes: Partial<typeof schema.auctions.$inferInsert> = { updatedAt: new Date(), startsAt, endsAt, originalEndsAt: endsAt, durationMinutes: duration };
      const keys = ['catalogId', 'startPrice', 'reservePrice', 'reserveVisible', 'bidIncrement', 'buyNowPrice', 'dealerGroupId', 'buyerFeePctBp', 'buyerFeeFixed', 'sellerFeePctBp', 'sellerFeeFixed', 'taxType', 'locationStreet', 'locationZip', 'locationCity', 'earliestPickup', 'antiSnipeMinutes'] as const;
      for (const k of keys) if (input[k] !== undefined) (changes as Record<string, unknown>)[k] = input[k];
      await tx.update(schema.auctions).set(changes).where(eq(schema.auctions.id, id));
      const priceKeys = ['startPrice', 'reservePrice', 'bidIncrement', 'buyNowPrice', 'buyerFeePctBp', 'buyerFeeFixed', 'sellerFeePctBp', 'sellerFeeFixed'] as const;
      const priceChanged = priceKeys.filter((k) => input[k] !== undefined && input[k] !== a[k]);
      await audit(tx, actorOf(req), {
        event: priceChanged.length ? 'PRICE_CHANGED' : 'AUCTION_UPDATED',
        entityType: 'auction',
        entityId: id,
        oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, (a as Record<string, unknown>)[k]])),
        newValue: input,
      });
      return { ok: true };
    });
  });

  app.post('/admin/auctions/:id/schedule', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'DRAFT') throw new AppError(409, 'INVALID_TRANSITION', 'Nur Entwürfe können eingeplant werden.');
      const now = await dbClock(tx);
      if (a.startsAt.getTime() < now.getTime() - 5 * 60_000) {
        throw new AppError(400, 'START_IN_PAST', 'Die Startzeit liegt in der Vergangenheit. Bitte anpassen oder „Sofort starten“ verwenden.');
      }
      const v = await loadVehicleForAuction(tx, a.vehicleId);
      if (v.status !== 'APPROVED' && v.status !== 'UNSOLD') throw new AppError(409, 'VEHICLE_NOT_READY', 'Das Fahrzeug ist nicht freigegeben.');
      await tx.update(schema.vehicles).set({ status: 'SCHEDULED', updatedAt: new Date() }).where(eq(schema.vehicles.id, v.id));
      await audit(tx, actorOf(req), { event: 'VEHICLE_STATUS_CHANGED', entityType: 'vehicle', entityId: v.id, oldValue: { status: v.status }, newValue: { status: 'SCHEDULED' } });
      await tx.update(schema.auctions).set({ status: 'SCHEDULED', version: sql`${schema.auctions.version} + 1`, updatedAt: new Date() }).where(eq(schema.auctions.id, id));
      await audit(tx, actorOf(req), { event: 'AUCTION_STATUS_CHANGED', entityType: 'auction', entityId: id, oldValue: { status: 'DRAFT' }, newValue: { status: 'SCHEDULED', startsAt: a.startsAt, endsAt: a.endsAt } });
      await publish(tx, channels.admin(), 'auction.scheduled', { auctionId: id });
      return { status: 'SCHEDULED' };
    });
  });

  app.post('/admin/auctions/:id/unschedule', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'SCHEDULED') throw new AppError(409, 'INVALID_TRANSITION', 'Nur geplante Auktionen können zurückgezogen werden.');
      await tx.update(schema.auctions).set({ status: 'DRAFT', version: sql`${schema.auctions.version} + 1`, updatedAt: new Date() }).where(eq(schema.auctions.id, id));
      await tx.update(schema.vehicles).set({ status: 'APPROVED', updatedAt: new Date() }).where(eq(schema.vehicles.id, a.vehicleId));
      await audit(tx, actorOf(req), { event: 'AUCTION_STATUS_CHANGED', entityType: 'auction', entityId: id, oldValue: { status: 'SCHEDULED' }, newValue: { status: 'DRAFT' } });
      return { status: 'DRAFT' };
    });
  });

  app.post('/admin/auctions/:id/start-now', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'SCHEDULED' && a.status !== 'DRAFT') throw new AppError(409, 'INVALID_TRANSITION', 'Auktion kann nicht gestartet werden.');
      const now = await dbClock(tx);
      const endsAt = new Date(now.getTime() + a.durationMinutes * 60_000);
      if (a.status === 'DRAFT') {
        const v = await loadVehicleForAuction(tx, a.vehicleId);
        if (v.status !== 'APPROVED' && v.status !== 'UNSOLD') throw new AppError(409, 'VEHICLE_NOT_READY', 'Das Fahrzeug ist nicht freigegeben.');
        await tx.update(schema.vehicles).set({ status: 'SCHEDULED' }).where(eq(schema.vehicles.id, v.id));
      }
      await tx.update(schema.auctions).set({ status: 'SCHEDULED', startsAt: now, endsAt, originalEndsAt: endsAt }).where(eq(schema.auctions.id, id));
      const fresh = await lockAuction(tx, id);
      const ok = await activateAuction(tx, fresh, now, actorOf(req));
      if (!ok) throw new AppError(409, 'VEHICLE_NOT_READY', 'Das Fahrzeug ist nicht startbereit.');
      return { status: 'ACTIVE', endsAt };
    });
  });

  app.post('/admin/auctions/:id/cancel', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    const input = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      await cancelAuction(tx, a, actorOf(req), input.reason);
      return { status: 'CANCELLED' };
    });
  });

  app.post('/admin/auctions/:id/end-time', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    const input = parse(extendAuctionSchema, req.body);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      await changeEndTime(tx, a, actorOf(req), new Date(input.endsAt), input.reason);
      return { endsAt: input.endsAt };
    });
  });

  /** Mindestpreis nicht erreicht → nach Rücksprache mit dem Verkäufer Zuschlag zum Höchstgebot erteilen. */
  app.post('/admin/auctions/:id/accept-highest', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    const input = parse(z.object({ note: z.string().trim().min(3).max(1000) }), req.body);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'ENDED' || a.outcome !== 'RESERVE_NOT_MET' || a.resolvedAt) {
        throw new AppError(409, 'INVALID_STATE', 'Nur bei „Mindestpreis nicht erreicht“ und noch offener Entscheidung möglich.');
      }
      const [existing] = await tx.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.auctionId, id));
      if (existing) throw new AppError(409, 'DEAL_EXISTS', 'Für diese Auktion existiert bereits ein Zuschlag.');
      if (!a.winningBidId) throw new AppError(409, 'NO_BIDS', 'Kein Gebot vorhanden.');
      const [bid] = await tx.select().from(schema.bids).where(eq(schema.bids.id, a.winningBidId));
      const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, a.vehicleId)).for('update');
      if (!v || v.status !== 'UNSOLD') throw new AppError(409, 'VEHICLE_STATE', 'Das Fahrzeug ist nicht mehr verfügbar.');
      await tx.update(schema.vehicles).set({ status: 'SOLD', updatedAt: new Date() }).where(eq(schema.vehicles.id, v.id));
      await audit(tx, actorOf(req), { event: 'VEHICLE_STATUS_CHANGED', entityType: 'vehicle', entityId: v.id, oldValue: { status: 'UNSOLD' }, newValue: { status: 'SOLD' } });
      const deal = await createDealFromAuction(tx, actorOf(req), a, bid!, 'MANUAL_ACCEPT', a.endedAt ?? new Date());
      await tx.update(schema.auctions).set({ resolvedAt: new Date(), resolution: `ACCEPTED_HIGHEST: ${input.note}` }).where(eq(schema.auctions.id, id));
      await audit(tx, actorOf(req), { event: 'ADMIN_ACTION', entityType: 'auction', entityId: id, newValue: { action: 'accept_highest', note: input.note, dealId: deal.id } });
      return { dealId: deal.id };
    });
  });

  app.post('/admin/auctions/:id/resolve', { preHandler: requireAdmin }, async (req) => {
    const id = aid(req);
    const input = parse(z.object({ resolution: z.enum(['DECLINED', 'SELLER_CONTACTED']), note: z.string().trim().min(3).max(1000) }), req.body);
    return db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'ENDED' || a.outcome === 'SOLD' || a.outcome === 'BUY_NOW') throw new AppError(409, 'INVALID_STATE', 'Keine offene Entscheidung.');
      const final = input.resolution === 'DECLINED';
      await tx
        .update(schema.auctions)
        .set({ resolution: `${input.resolution}: ${input.note}`, resolvedAt: final ? new Date() : null })
        .where(eq(schema.auctions.id, id));
      await audit(tx, actorOf(req), { event: 'AUCTION_UPDATED', entityType: 'auction', entityId: id, newValue: { resolution: input.resolution, note: input.note } });
      if (final && a.currentBidderCompanyId) {
        await notifyCompany(tx, a.currentBidderCompanyId, {
          type: 'AUCTION_LOST',
          title: 'Kein Zuschlag',
          body: 'Ihr Höchstgebot unter dem Mindestpreis wurde nicht angenommen.',
          link: `/haendler/auktionen/${id}`,
          email: false,
        });
      }
      return { ok: true };
    });
  });

  /** Nicht verkauftes Fahrzeug erneut einstellen: neue Auktion (Entwurf) mit übernommenen Parametern. */
  app.post('/admin/auctions/:id/relist', { preHandler: requireAdmin }, async (req, reply) => {
    const id = aid(req);
    const input = parse(z.object({ startsAt: z.string().datetime({ offset: true }), reservePrice: z.number().int().min(0).nullable().optional(), startPrice: z.number().int().min(100).optional() }), req.body);
    const created = await db.transaction(async (tx) => {
      const a = await lockAuction(tx, id);
      if (a.status !== 'ENDED' && a.status !== 'CANCELLED') throw new AppError(409, 'INVALID_STATE', 'Nur beendete oder abgebrochene Auktionen können neu eingestellt werden.');
      const v = await loadVehicleForAuction(tx, a.vehicleId);
      if (v.status !== 'UNSOLD' && v.status !== 'APPROVED') throw new AppError(409, 'VEHICLE_STATE', 'Das Fahrzeug kann nicht erneut eingestellt werden.');
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(startsAt.getTime() + a.durationMinutes * 60_000);
      const startPrice = input.startPrice ?? a.startPrice;
      const reservePrice = input.reservePrice !== undefined ? input.reservePrice : a.reservePrice;
      if (reservePrice !== null && reservePrice < startPrice) throw new AppError(400, 'RESERVE_BELOW_START', 'Der Mindestpreis darf nicht unter dem Startpreis liegen.');
      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('auction_number_seq')::text as n`)).rows as [{ n: string }];
      const { id: _old, number: _num, ...rest } = a;
      const [na] = await tx
        .insert(schema.auctions)
        .values({
          ...rest,
          number: `A-${new Date().getFullYear()}-${n.padStart(6, '0')}`,
          status: 'DRAFT',
          startsAt,
          endsAt,
          originalEndsAt: endsAt,
          startPrice,
          reservePrice,
          buyNowPrice: a.buyNowPrice && a.buyNowPrice > startPrice ? a.buyNowPrice : null,
          currentBid: null,
          currentBidderCompanyId: null,
          winningBidId: null,
          bidCount: 0,
          bidderCount: 0,
          extensionCount: 0,
          outcome: null,
          endedAt: null,
          startedAt: null,
          cancelledReason: null,
          endingSoonNotifiedAt: null,
          resolvedAt: null,
          resolution: null,
          relistedFromId: a.id,
          version: 0,
          createdBy: getAuth(req).userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (a.status === 'ENDED' && !a.resolvedAt) {
        await tx.update(schema.auctions).set({ resolvedAt: new Date(), resolution: 'RELISTED' }).where(eq(schema.auctions.id, a.id));
      }
      await audit(tx, actorOf(req), { event: 'AUCTION_CREATED', entityType: 'auction', entityId: na!.id, newValue: { relistedFrom: a.id, startsAt, startPrice, reservePrice } });
      return na!;
    });
    return reply.status(201).send({ id: created.id, number: created.number });
  });

  // =================================================================================
  // Händler & Autohaus
  // =================================================================================
  app.get('/auctions', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    const q = parse(auctionListQuerySchema, req.query);
    const where: (SQL | undefined)[] = [];
    let dealerCompanyId: string | null = null;
    if (u.company?.type === 'DEALER') {
      dealerCompanyId = u.company.id;
      where.push(dealerAuctionVisibility(u));
    } else if (u.company?.type === 'DEALERSHIP' && u.company.status === 'APPROVED') {
      where.push(eq(schema.vehicles.companyId, u.company.id));
    } else if (!isAdmin(u)) {
      throw new AppError(403, 'FORBIDDEN', 'Keine Berechtigung.');
    }
    const status = q.status ?? 'active';
    if (status === 'active') where.push(eq(schema.auctions.status, 'ACTIVE'));
    if (status === 'scheduled') where.push(eq(schema.auctions.status, 'SCHEDULED'));
    if (status === 'ended') where.push(inArray(schema.auctions.status, ['ENDED', 'CANCELLED']));
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      where.push(sql`(${schema.vehicles.make} ILIKE ${like} OR ${schema.vehicles.model} ILIKE ${like} OR ${schema.vehicles.variant} ILIKE ${like})`);
    }
    if (q.catalogId) where.push(eq(schema.auctions.catalogId, q.catalogId));
    if (q.make) where.push(sql`lower(${schema.vehicles.make}) = lower(${q.make})`);
    if (q.model) where.push(sql`${schema.vehicles.model} ILIKE ${`%${q.model.replace(/[%_]/g, '')}%`}`);
    if (q.regFrom) where.push(sql`extract(year from ${schema.vehicles.firstRegistration}) >= ${q.regFrom}`);
    if (q.regTo) where.push(sql`extract(year from ${schema.vehicles.firstRegistration}) <= ${q.regTo}`);
    if (q.kmFrom !== undefined) where.push(gte(schema.vehicles.mileageKm, q.kmFrom));
    if (q.kmTo !== undefined) where.push(lte(schema.vehicles.mileageKm, q.kmTo));
    if (q.fuel) where.push(eq(schema.vehicles.fuel, q.fuel));
    if (q.transmission) where.push(eq(schema.vehicles.transmission, q.transmission));
    if (q.body) where.push(eq(schema.vehicles.body, q.body));
    if (q.powerFrom) where.push(gte(schema.vehicles.powerKw, q.powerFrom));
    if (q.powerTo) where.push(lte(schema.vehicles.powerKw, q.powerTo));
    if (q.priceFrom !== undefined) where.push(sql`coalesce(${schema.auctions.currentBid}, ${schema.auctions.startPrice}) >= ${q.priceFrom}`);
    if (q.priceTo !== undefined) where.push(sql`coalesce(${schema.auctions.currentBid}, ${schema.auctions.startPrice}) <= ${q.priceTo}`);
    if (q.damaged) where.push(eq(schema.vehicles.hasDamages, q.damaged === 'yes'));
    if (q.paintFlagged) where.push(eq(schema.vehicles.paintFlagged, q.paintFlagged === 'yes'));
    if (q.city) where.push(sql`${schema.vehicles.locationCity} ILIKE ${`%${q.city.replace(/[%_]/g, '')}%`}`);
    if (q.endingWithinHours) where.push(sql`${schema.auctions.endsAt} <= now() + make_interval(hours => ${q.endingWithinHours})`);
    if (q.newWithinHours) where.push(sql`coalesce(${schema.auctions.startedAt}, ${schema.auctions.startsAt}) >= now() - make_interval(hours => ${q.newWithinHours})`);
    if (q.favorites && u.company) where.push(sql`EXISTS (SELECT 1 FROM watchlist w WHERE w.vehicle_id = ${schema.vehicles.id} AND w.user_id = ${u.userId})`);
    if (q.radiusKm) {
      const origin = approxCoordinatesForZip(q.zip ?? null) ?? (u.company ? await companyCoords(u.company.id) : null);
      if (!origin) throw new AppError(400, 'ORIGIN_REQUIRED', 'Für die Umkreissuche wird eine PLZ benötigt.');
      where.push(sql`${schema.vehicles.lat} IS NOT NULL AND (6371 * 2 * asin(sqrt(
        power(sin(radians(${schema.vehicles.lat} - ${origin.lat}) / 2), 2) +
        cos(radians(${origin.lat})) * cos(radians(${schema.vehicles.lat})) * power(sin(radians(${schema.vehicles.lng} - ${origin.lng}) / 2), 2)
      ))) <= ${q.radiusKm}`);
    } else if (q.zip) {
      where.push(sql`${schema.vehicles.locationZip} LIKE ${`${q.zip}%`}`);
    }
    const order =
      q.sort === 'newest'
        ? [desc(sql`coalesce(${schema.auctions.startedAt}, ${schema.auctions.startsAt})`)]
        : q.sort === 'price_asc'
          ? [asc(sql`coalesce(${schema.auctions.currentBid}, ${schema.auctions.startPrice})`)]
          : q.sort === 'price_desc'
            ? [desc(sql`coalesce(${schema.auctions.currentBid}, ${schema.auctions.startPrice})`)]
            : status === 'ended'
              ? [desc(schema.auctions.endsAt)]
              : [asc(schema.auctions.endsAt)];
    const page = q.page ?? 1;
    const rows = await db
      .select({
        id: schema.auctions.id,
        number: schema.auctions.number,
        status: schema.auctions.status,
        startsAt: schema.auctions.startsAt,
        endsAt: schema.auctions.endsAt,
        startPrice: schema.auctions.startPrice,
        currentBid: schema.auctions.currentBid,
        bidCount: schema.auctions.bidCount,
        outcome: schema.auctions.outcome,
        currentBidderCompanyId: schema.auctions.currentBidderCompanyId,
        reservePrice: schema.auctions.reservePrice,
        reserveVisible: schema.auctions.reserveVisible,
        vehicleId: schema.vehicles.id,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        variant: schema.vehicles.variant,
        firstRegistration: schema.vehicles.firstRegistration,
        mileageKm: schema.vehicles.mileageKm,
        powerKw: schema.vehicles.powerKw,
        fuel: schema.vehicles.fuel,
        transmission: schema.vehicles.transmission,
        hasDamages: schema.vehicles.hasDamages,
        paintFlagged: schema.vehicles.paintFlagged,
        locationZip: schema.vehicles.locationZip,
        locationCity: schema.vehicles.locationCity,
        mainPhotoId: sql<string | null>`(select p.id from vehicle_photos p where p.vehicle_id = ${schema.vehicles.id} and p.slot = 'FRONT_LEFT_45' and p.replaced_by_id is null order by p.created_at desc limit 1)`,
        isFavorite: sql<boolean>`EXISTS (SELECT 1 FROM watchlist w WHERE w.vehicle_id = ${schema.vehicles.id} AND w.user_id = ${u.userId})`,
        myBid: dealerCompanyId
          ? sql<number | null>`(select max(b.amount) from bids b where b.auction_id = ${schema.auctions.id} and b.company_id = ${dealerCompanyId})`
          : sql<number | null>`null`,
      })
      .from(schema.auctions)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.auctions.vehicleId))
      .where(and(...where))
      .orderBy(...order)
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    const serverNow = await dbClock(db);
    // Katalogname nur, wenn der Nutzer mindestens eine Auktion dieses Katalogs sehen darf (kein Rückschluss auf fremde Gruppenkataloge).
    const catalog = q.catalogId && rows.length > 0
      ? ((await db.select({ id: schema.catalogs.id, name: schema.catalogs.name, startsAt: schema.catalogs.startsAt }).from(schema.catalogs).where(eq(schema.catalogs.id, q.catalogId)))[0] ?? null)
      : null;
    return {
      serverNow,
      page,
      hasMore: rows.length > PAGE_SIZE,
      catalog,
      items: rows.slice(0, PAGE_SIZE).map(({ currentBidderCompanyId, reservePrice, reserveVisible, ...r }) => ({
        ...r,
        // Händler: nur eigener Status; Autohaus: eigener Mindestpreis.
        myStatus: dealerCompanyId && r.myBid !== null ? (currentBidderCompanyId === dealerCompanyId ? 'LEADING' : 'OUTBID') : null,
        reservePrice: u.company?.type === 'DEALERSHIP' || isAdmin(u) || reserveVisible ? reservePrice : undefined,
      })),
    };
  });

  app.get('/auctions/:id', { preHandler: requireAuth }, async (req) => {
    const id = aid(req);
    const { a, role } = await loadAuctionForViewer(db, req, id);
    const serverNow = await dbClock(db);
    if (role === 'dealer') {
      const c = companyOf(req);
      const user = getAuth(req);
      const [fav] = await db.select().from(schema.watchlist).where(and(eq(schema.watchlist.userId, user.userId), eq(schema.watchlist.vehicleId, a.vehicleId)));
      const settings = await getSettings(db);
      return {
        state: await dealerAuctionState(db, a, c.id, serverNow),
        vehicle: await buildVehicleFile(db, a.vehicleId, 'buyer'),
        isFavorite: !!fav,
        catalog: await catalogContext(db, user, a),
        // Verkäuferidentität bleibt bis zum Zuschlag vertraulich (§3.3); Fragen laufen über den Plattformbetreiber.
        contact: { name: settings.platformName, email: settings.supportEmail || null, phone: settings.supportPhone || null },
      };
    }
    return { state: sellerAuctionState(a, serverNow), vehicle: await buildVehicleFile(db, a.vehicleId, role === 'admin' ? 'admin' : 'dealership') };
  });

  app.get('/auctions/:id/state', { preHandler: requireAuth }, async (req) => {
    const id = aid(req);
    const { a, role } = await loadAuctionForViewer(db, req, id);
    const serverNow = await dbClock(db);
    return role === 'dealer' ? dealerAuctionState(db, a, companyOf(req).id, serverNow) : sellerAuctionState(a, serverNow);
  });

  /** Anonymisierter Gebotsverlauf: "Bieter 3", eigene Gebote markiert. */
  app.get('/auctions/:id/bids', { preHandler: requireAuth }, async (req) => {
    const id = aid(req);
    const { role } = await loadAuctionForViewer(db, req, id);
    const myCompany = role === 'dealer' ? companyOf(req).id : null;
    const rows = await db
      .select({
        sequence: schema.bids.sequence,
        amount: schema.bids.amount,
        kind: schema.bids.kind,
        serverTime: schema.bids.serverTime,
        companyId: schema.bids.companyId,
        label: schema.auctionBidders.label,
      })
      .from(schema.bids)
      .leftJoin(schema.auctionBidders, and(eq(schema.auctionBidders.auctionId, schema.bids.auctionId), eq(schema.auctionBidders.companyId, schema.bids.companyId)))
      .where(eq(schema.bids.auctionId, id))
      .orderBy(desc(schema.bids.sequence))
      .limit(200);
    return rows.map(({ companyId, ...r }) => ({ ...r, mine: myCompany !== null && companyId === myCompany }));
  });

  const bidderGuard = requireCompany({ type: 'DEALER' });
  const bidRateLimit = { rateLimit: { max: rateMax(30), timeWindow: '10 seconds' } };

  app.post('/auctions/:id/bids', { preHandler: bidderGuard, config: bidRateLimit }, async (req, reply) => {
    const id = aid(req);
    const input = parse(placeBidSchema, req.body);
    const result = await processBid({ auctionId: id, user: getAuth(req), actor: actorOf(req), clientRequestId: input.clientRequestId, mode: 'BID', amount: input.amount });
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.put('/auctions/:id/max-bid', { preHandler: bidderGuard, config: bidRateLimit }, async (req) => {
    const id = aid(req);
    const input = parse(maxBidSchema, req.body);
    return processBid({ auctionId: id, user: getAuth(req), actor: actorOf(req), clientRequestId: input.clientRequestId, mode: 'MAX', maxAmount: input.maxAmount });
  });

  app.delete('/auctions/:id/max-bid', { preHandler: bidderGuard }, async (req) => {
    const id = aid(req);
    const c = companyOf(req);
    return db.transaction(async (tx) => {
      const { a } = await loadAuctionForViewer(tx, req, id);
      if (a.status !== 'ACTIVE' && a.status !== 'SCHEDULED') throw new AppError(409, 'AUCTION_NOT_ACTIVE', 'Die Auktion läuft nicht.');
      await lockAuction(tx, id);
      const res = await tx
        .update(schema.maximumBids)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(schema.maximumBids.auctionId, id), eq(schema.maximumBids.companyId, c.id), eq(schema.maximumBids.active, true)))
        .returning({ id: schema.maximumBids.id });
      if (res.length) await audit(tx, actorOf(req), { event: 'MAX_BID_REMOVED', entityType: 'auction', entityId: id, newValue: { companyId: c.id } });
      return { ok: true };
    });
  });

  app.post('/auctions/:id/buy-now', { preHandler: bidderGuard, config: bidRateLimit }, async (req) => {
    const id = aid(req);
    const input = parse(buyNowSchema, req.body);
    return processBid({ auctionId: id, user: getAuth(req), actor: actorOf(req), clientRequestId: input.clientRequestId, mode: 'BUY_NOW' });
  });

  // ---------- Händler: eigene Gebote & Ergebnisse ----------
  app.get('/me/auctions', { preHandler: bidderGuard }, async (req) => {
    const c = companyOf(req);
    const { state } = parse(z.object({ state: z.enum(['active', 'won', 'lost', 'all']).default('all') }), req.query);
    const rows = await db
      .select({
        id: schema.auctions.id,
        number: schema.auctions.number,
        status: schema.auctions.status,
        outcome: schema.auctions.outcome,
        endsAt: schema.auctions.endsAt,
        currentBid: schema.auctions.currentBid,
        bidCount: schema.auctions.bidCount,
        leading: sql<boolean>`${schema.auctions.currentBidderCompanyId} = ${c.id}`,
        myHighestBid: sql<number>`(select max(b.amount) from bids b where b.auction_id = ${schema.auctions.id} and b.company_id = ${c.id})`,
        myBidCount: sql<number>`(select count(*)::int from bids b where b.auction_id = ${schema.auctions.id} and b.company_id = ${c.id})`,
        myMaxBid: sql<number | null>`(select m.max_amount from maximum_bids m where m.auction_id = ${schema.auctions.id} and m.company_id = ${c.id} and m.active)`,
        vehicleId: schema.vehicles.id,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        mainPhotoId: sql<string | null>`(select p.id from vehicle_photos p where p.vehicle_id = ${schema.vehicles.id} and p.slot = 'FRONT_LEFT_45' and p.replaced_by_id is null order by p.created_at desc limit 1)`,
        dealId: sql<string | null>`(select d.id from deals d where d.auction_id = ${schema.auctions.id} and d.buyer_company_id = ${c.id})`,
      })
      .from(schema.auctions)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.auctions.vehicleId))
      .where(sql`EXISTS (SELECT 1 FROM bids b WHERE b.auction_id = ${schema.auctions.id} AND b.company_id = ${c.id})`)
      .orderBy(desc(schema.auctions.endsAt))
      .limit(500);
    const items = rows.map((r) => {
      const won = r.dealId !== null;
      const result = r.status === 'ACTIVE' || r.status === 'SCHEDULED' ? (r.leading ? 'LEADING' : 'OUTBID') : won ? 'WON' : r.leading && r.outcome === 'RESERVE_NOT_MET' ? 'RESERVE_NOT_MET' : 'LOST';
      return { ...r, result };
    });
    return {
      serverNow: await dbClock(db),
      items: items.filter((i) =>
        state === 'all' ? true : state === 'active' ? i.result === 'LEADING' || i.result === 'OUTBID' : state === 'won' ? i.result === 'WON' : i.result === 'LOST' || i.result === 'RESERVE_NOT_MET',
      ),
    };
  });

  // ---------- Favoriten ----------
  app.get('/watchlist', { preHandler: bidderGuard }, async (req) => {
    const u = getAuth(req);
    return db.select({ vehicleId: schema.watchlist.vehicleId, createdAt: schema.watchlist.createdAt }).from(schema.watchlist).where(eq(schema.watchlist.userId, u.userId));
  });

  app.put('/watchlist/:vehicleId', { preHandler: bidderGuard }, async (req) => {
    const vehicleId = parse(uuidSchema, (req.params as { vehicleId: string }).vehicleId);
    const u = getAuth(req);
    const [a] = await db
      .select({ id: schema.auctions.id })
      .from(schema.auctions)
      .where(and(eq(schema.auctions.vehicleId, vehicleId), inArray(schema.auctions.status, ['SCHEDULED', 'ACTIVE']), dealerAuctionVisibility(u)))
      .limit(1);
    if (!a) throw notFound('Fahrzeug');
    await db.insert(schema.watchlist).values({ userId: u.userId, companyId: u.company!.id, vehicleId }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/watchlist/:vehicleId', { preHandler: bidderGuard }, async (req) => {
    const vehicleId = parse(uuidSchema, (req.params as { vehicleId: string }).vehicleId);
    await db.delete(schema.watchlist).where(and(eq(schema.watchlist.userId, getAuth(req).userId), eq(schema.watchlist.vehicleId, vehicleId)));
    return { ok: true };
  });
}

async function companyCoords(companyId: string) {
  const [c] = await db.select({ lat: schema.companies.lat, lng: schema.companies.lng, zip: schema.companies.zip }).from(schema.companies).where(eq(schema.companies.id, companyId));
  if (c?.lat && c.lng) return { lat: c.lat, lng: c.lng };
  return approxCoordinatesForZip(c?.zip);
}

/** Lädt eine Auktion nur, wenn der Betrachter sie sehen darf (sonst 404 – Existenz wird nicht verraten). */
export async function loadAuctionForViewer(tx: DbOrTx, req: FastifyRequest, id: string): Promise<{ a: Auction; role: 'admin' | 'dealer' | 'seller' }> {
  const u = getAuth(req);
  if (isAdmin(u)) {
    const [a] = await tx.select().from(schema.auctions).where(eq(schema.auctions.id, id));
    if (!a) throw notFound('Auktion');
    return { a, role: 'admin' };
  }
  if (u.company?.type === 'DEALER') {
    const [a] = await tx.select().from(schema.auctions).where(and(eq(schema.auctions.id, id), dealerAuctionVisibility(u)));
    if (!a) throw notFound('Auktion');
    return { a, role: 'dealer' };
  }
  if (u.company?.type === 'DEALERSHIP' && u.company.status === 'APPROVED') {
    const [row] = await tx
      .select({ a: schema.auctions })
      .from(schema.auctions)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.auctions.vehicleId))
      .where(and(eq(schema.auctions.id, id), eq(schema.vehicles.companyId, u.company.id), sql`${schema.auctions.status} <> 'DRAFT'`));
    if (!row) throw notFound('Auktion');
    return { a: row.a, role: 'seller' };
  }
  throw notFound('Auktion');
}
