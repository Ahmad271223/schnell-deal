import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  applyAntiSniping,
  assertTransition,
  determineOutcome,
  formatDateTimeDe,
  formatEuro,
  minNextBid,
  resolveBid,
  type AuctionStatus,
} from '@sd/shared';
import { db, schema, type DbOrTx } from '../../core/db/client';
import { AppError, notFound } from '../../core/errors';
import { audit, SYSTEM_ACTOR, type Actor } from '../../core/audit';
import { publish, channels } from '../../core/realtime';
import type { AuthUser } from '../../core/auth';
import { hasAcceptedCurrentBidderTerms } from '../legal/service';
import { companyUserIds, notifyAdmins, notifyCompany, notifyUsers } from '../notifications/service';
import { createDealFromAuction } from '../deals/service';

export type Auction = typeof schema.auctions.$inferSelect;

/** Mindestgebot einer Auktion (Startpreis bzw. aktuelles Gebot + Gebotsschritt). */
export function auctionMinNext(a: Pick<Auction, 'startPrice' | 'bidIncrement' | 'currentBid'>): number {
  return minNextBid({ startPrice: a.startPrice, increment: a.bidIncrement, currentBid: a.currentBid });
}

/** Wiederholt eine Transaktion bei Deadlock/Serialisierungsfehler (Gebote sind über clientRequestId idempotent). */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if ((code === '40P01' || code === '40001') && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

/** Uhrzeit der Datenbank zum aktuellen Zeitpunkt (nicht Transaktionsbeginn) – maßgeblich für Gebote und Auktionsende. */
export async function dbClock(tx: DbOrTx): Promise<Date> {
  const res = await tx.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
  return new Date(res.rows[0]!.now);
}

export async function lockAuction(tx: DbOrTx, id: string): Promise<Auction> {
  const [a] = await tx.select().from(schema.auctions).where(eq(schema.auctions.id, id)).for('update');
  if (!a) throw notFound('Auktion');
  return a;
}

async function setAuctionStatus(tx: DbOrTx, actor: Actor, a: Auction, to: AuctionStatus, extra: Partial<Auction> = {}): Promise<void> {
  assertTransition('auction', a.status, to);
  await tx
    .update(schema.auctions)
    .set({ ...extra, status: to, version: sql`${schema.auctions.version} + 1`, updatedAt: new Date() })
    .where(eq(schema.auctions.id, a.id));
  await audit(tx, actor, {
    event: 'AUCTION_STATUS_CHANGED',
    entityType: 'auction',
    entityId: a.id,
    oldValue: { status: a.status },
    newValue: { status: to, ...extra },
  });
}

async function setVehicleStatusRaw(tx: DbOrTx, actor: Actor, vehicleId: string, to: typeof schema.vehicles.$inferSelect.status): Promise<void> {
  const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).for('update');
  if (!v) throw notFound('Fahrzeug');
  if (v.status === to) return;
  assertTransition('vehicle', v.status, to);
  await tx.update(schema.vehicles).set({ status: to, updatedAt: new Date() }).where(eq(schema.vehicles.id, vehicleId));
  await audit(tx, actor, { event: 'VEHICLE_STATUS_CHANGED', entityType: 'vehicle', entityId: vehicleId, oldValue: { status: v.status }, newValue: { status: to } });
}

async function bidderCompanyIds(tx: DbOrTx, auctionId: string): Promise<string[]> {
  const rows = await tx.select({ c: schema.auctionBidders.companyId }).from(schema.auctionBidders).where(eq(schema.auctionBidders.auctionId, auctionId));
  return rows.map((r) => r.c);
}

async function watcherUserIds(tx: DbOrTx, vehicleId: string): Promise<string[]> {
  const rows = await tx.select({ u: schema.watchlist.userId }).from(schema.watchlist).where(eq(schema.watchlist.vehicleId, vehicleId));
  return rows.map((r) => r.u);
}

async function vehicleTitle(tx: DbOrTx, vehicleId: string): Promise<string> {
  const [v] = await tx
    .select({ make: schema.vehicles.make, model: schema.vehicles.model, n: schema.vehicles.internalNumber })
    .from(schema.vehicles)
    .where(eq(schema.vehicles.id, vehicleId));
  return v ? `${v.make ?? ''} ${v.model ?? ''} (${v.n})`.trim() : 'Fahrzeug';
}

// =====================================================================================
// Gebote
// =====================================================================================

export interface BidRequest {
  auctionId: string;
  user: AuthUser;
  actor: Actor;
  clientRequestId: string;
  mode: 'BID' | 'MAX' | 'BUY_NOW';
  amount?: number;
  maxAmount?: number;
}

export interface BidResult {
  accepted: true;
  duplicate: boolean;
  status: 'LEADING' | 'OUTBID' | 'WON';
  currentBid: number | null;
  minNextBid: number;
  bidCount: number;
  endsAt: Date;
  extended: boolean;
  serverTime: Date;
}

/** Prüft innerhalb der Transaktion, ob der Händler bieten darf (Sperren während der Auktion greifen sofort). */
async function assertEligibleBidder(tx: DbOrTx, user: AuthUser, auction: Auction, now: Date): Promise<void> {
  const c = user.company;
  if (!c || c.type !== 'DEALER') throw new AppError(403, 'NOT_A_DEALER', 'Nur geprüfte Händler dürfen bieten.');
  const [row] = await tx
    .select({ status: schema.companies.status, bidding: schema.dealerVerifications.biddingStatus, blockedUntil: schema.dealerVerifications.blockedUntil })
    .from(schema.companies)
    .innerJoin(schema.dealerVerifications, eq(schema.dealerVerifications.companyId, schema.companies.id))
    .where(eq(schema.companies.id, c.id))
    .for('share');
  if (!row || row.status !== 'APPROVED') throw new AppError(403, 'COMPANY_NOT_APPROVED', 'Ihr Unternehmen ist nicht freigegeben.');
  const tempExpired = row.bidding === 'TEMP_BLOCKED' && row.blockedUntil !== null && row.blockedUntil <= now;
  if (row.bidding !== 'CAN_BID' && !tempExpired) {
    throw new AppError(403, 'BIDDING_NOT_ALLOWED', row.bidding === 'VIEW_ONLY' ? 'Ihr Konto ist nur zur Ansicht freigeschaltet.' : 'Ihr Bieterkonto ist gesperrt.');
  }
  if (auction.dealerGroupId) {
    const [m] = await tx
      .select({ g: schema.dealerGroupMembers.groupId })
      .from(schema.dealerGroupMembers)
      .where(and(eq(schema.dealerGroupMembers.groupId, auction.dealerGroupId), eq(schema.dealerGroupMembers.companyId, c.id)));
    if (!m) throw notFound('Auktion');
  }
  if (!(await hasAcceptedCurrentBidderTerms(tx, user.userId))) {
    throw new AppError(403, 'BIDDER_TERMS_REQUIRED', 'Bitte stimmen Sie zuerst den aktuell gültigen Bieterbedingungen zu.');
  }
}

/**
 * Zentrale Gebotsverarbeitung. Ablauf in EINER Transaktion:
 *  1. Händlerberechtigung (FOR SHARE → serialisiert mit Sperrungen)
 *  2. Row-Lock auf der Auktion (FOR UPDATE → alle Gebote einer Auktion strikt nacheinander)
 *  3. Serverzeit NACH Lock-Erwerb; Gebote nach ends_at werden abgelehnt
 *  4. Idempotenz über clientRequestId
 *  5. Bietagent-Auflösung (reine Funktion), Speicherung, Anti-Sniping
 *  6. Realtime-Event (wird erst beim COMMIT zugestellt) und Benachrichtigungen
 */
export async function processBid(req: BidRequest): Promise<BidResult> {
  return withTxRetry(() =>
    db.transaction(async (tx) => {
      const me = req.user.company!.id;
      // Vorab ohne Lock prüfen, ob es die Auktion für diesen Händler überhaupt gibt (IDOR-Schutz).
      const [pre] = await tx.select({ id: schema.auctions.id, dealerGroupId: schema.auctions.dealerGroupId, status: schema.auctions.status }).from(schema.auctions).where(eq(schema.auctions.id, req.auctionId));
      if (!pre || pre.status === 'DRAFT') throw notFound('Auktion');

      await assertEligibleBidder(tx, req.user, { ...(pre as unknown as Auction) }, new Date());
      const a = await lockAuction(tx, req.auctionId);
      const now = await dbClock(tx);

      // Idempotenz: identischer Request (z. B. Doppelklick, Retry nach Timeout) erzeugt kein zweites Gebot.
      const [dup] = await tx
        .select({ id: schema.bids.id })
        .from(schema.bids)
        .where(and(eq(schema.bids.auctionId, a.id), eq(schema.bids.companyId, me), eq(schema.bids.clientRequestId, req.clientRequestId)))
        .limit(1);
      if (dup) return snapshotResult(a, me, true, false, now);

      if (a.status !== 'ACTIVE' || now < a.startsAt) {
        throw new AppError(409, a.status === 'ENDED' ? 'AUCTION_ENDED' : 'AUCTION_NOT_ACTIVE', a.status === 'ENDED' ? 'Die Auktion ist beendet.' : 'Die Auktion läuft nicht.');
      }
      if (now >= a.endsAt) {
        // Endzeit erreicht, aber der Scheduler hat noch nicht beendet → Gebot trotzdem ablehnen.
        throw new AppError(409, 'AUCTION_ENDED', 'Die Auktion ist beendet. Ihr Gebot ging nach Ablauf der Endzeit ein.');
      }

      // ---------- Sofortkauf ----------
      if (req.mode === 'BUY_NOW') {
        if (!a.buyNowPrice) throw new AppError(409, 'BUY_NOW_UNAVAILABLE', 'Für diese Auktion ist kein Sofortkauf möglich.');
        if (a.currentBid !== null && a.currentBid >= a.buyNowPrice) {
          throw new AppError(409, 'BUY_NOW_UNAVAILABLE', 'Sofortkauf ist nicht mehr verfügbar, da das Höchstgebot den Sofortkaufpreis erreicht hat.');
        }
        await tx.update(schema.bids).set({ status: 'OUTBID' }).where(and(eq(schema.bids.auctionId, a.id), eq(schema.bids.status, 'WINNING')));
        const [bid] = await tx
          .insert(schema.bids)
          .values({
            auctionId: a.id,
            companyId: me,
            userId: req.user.userId,
            amount: a.buyNowPrice,
            kind: 'BUY_NOW',
            status: 'WINNING',
            sequence: a.bidCount + 1,
            serverTime: now,
            clientRequestId: req.clientRequestId,
            ip: req.actor.ip ?? null,
            userAgent: req.actor.userAgent?.slice(0, 300) ?? null,
          })
          .returning();
        await ensureBidderLabels(tx, a.id, [me]);
        const bidderCount = (await bidderCompanyIds(tx, a.id)).length;
        await audit(tx, req.actor, { event: 'BID_PLACED', entityType: 'auction', entityId: a.id, newValue: { bidId: bid!.id, amount: bid!.amount, kind: 'BUY_NOW', transactionId: bid!.transactionId } });
        const ended: Auction = { ...a, currentBid: bid!.amount, currentBidderCompanyId: me, winningBidId: bid!.id, bidCount: a.bidCount + 1, bidderCount };
        await tx
          .update(schema.auctions)
          .set({ currentBid: bid!.amount, currentBidderCompanyId: me, winningBidId: bid!.id, bidCount: a.bidCount + 1, bidderCount })
          .where(eq(schema.auctions.id, a.id));
        await finalizeAuction(tx, ended, now, req.actor, 'BUY_NOW');
        return { accepted: true, duplicate: false, status: 'WON', currentBid: bid!.amount, minNextBid: bid!.amount, bidCount: a.bidCount + 1, endsAt: now, extended: false, serverTime: now };
      }

      // ---------- Maximalgebot als aktueller Führender: nur Limit anpassen (geheim, kein neues Gebot) ----------
      if (req.mode === 'MAX' && a.currentBidderCompanyId === me) {
        if (!req.maxAmount || req.maxAmount <= (a.currentBid ?? 0)) {
          throw new AppError(409, 'MAX_TOO_LOW', 'Das Maximalgebot muss über dem aktuellen Gebot liegen.', { minNextBid: auctionMinNext(a) });
        }
        await upsertMaxBid(tx, a.id, me, req.user.userId, req.maxAmount);
        await audit(tx, req.actor, { event: 'MAX_BID_SET', entityType: 'auction', entityId: a.id, newValue: { maxAmount: req.maxAmount } });
        return snapshotResult(a, me, false, false, now);
      }

      const leaderMaxRow = a.currentBidderCompanyId
        ? (
            await tx
              .select()
              .from(schema.maximumBids)
              .where(and(eq(schema.maximumBids.auctionId, a.id), eq(schema.maximumBids.companyId, a.currentBidderCompanyId), eq(schema.maximumBids.active, true)))
          )[0]
        : undefined;

      const amount = req.mode === 'MAX' ? auctionMinNext(a) : req.amount!;
      const maxAmount = req.mode === 'MAX' ? req.maxAmount! : null;
      if (req.mode === 'MAX' && maxAmount! < amount) {
        throw new AppError(409, 'MAX_TOO_LOW', `Das Maximalgebot muss mindestens ${formatEuro(amount)} betragen.`, { minNextBid: amount });
      }
      const resolution = resolveBid(
        {
          startPrice: a.startPrice,
          increment: a.bidIncrement,
          currentBid: a.currentBid,
          leaderId: a.currentBidderCompanyId,
          leaderMax: leaderMaxRow?.maxAmount ?? null,
        },
        { bidderId: me, amount, maxAmount, proxyOnly: req.mode === 'MAX' },
      );
      if (!resolution.ok) {
        const messages: Record<string, string> = {
          BID_TOO_LOW: `Das Gebot ist zu niedrig. Mindestgebot: ${formatEuro(resolution.minNextBid)}.`,
          ALREADY_LEADING: 'Sie führen bereits. Sie können stattdessen Ihr Maximalgebot erhöhen.',
          MAX_BELOW_AMOUNT: 'Das Maximalgebot muss mindestens so hoch wie das Gebot sein.',
          INVALID_AMOUNT: 'Ungültiger Betrag.',
        };
        throw new AppError(409, resolution.code, messages[resolution.code]!, { minNextBid: resolution.minNextBid });
      }

      // Bisher führendes Gebot wird überboten (Partial-Unique-Index erlaubt nur ein WINNING je Auktion).
      await tx.update(schema.bids).set({ status: 'OUTBID' }).where(and(eq(schema.bids.auctionId, a.id), eq(schema.bids.status, 'WINNING')));
      const last = resolution.records.length - 1;
      const inserted = await tx
        .insert(schema.bids)
        .values(
          resolution.records.map((r, i) => {
            const own = r.bidderId === me;
            return {
              auctionId: a.id,
              companyId: r.bidderId,
              userId: own ? req.user.userId : leaderMaxRow!.userId,
              amount: r.amount,
              kind: r.kind,
              status: i === last ? ('WINNING' as const) : ('OUTBID' as const),
              sequence: a.bidCount + i + 1,
              serverTime: now,
              clientRequestId: own ? req.clientRequestId : `proxy:${req.clientRequestId}`,
              ip: own ? (req.actor.ip ?? null) : null,
              userAgent: own ? (req.actor.userAgent?.slice(0, 300) ?? null) : null,
            };
          }),
        )
        .returning();
      if (maxAmount !== null) await upsertMaxBid(tx, a.id, me, req.user.userId, maxAmount);

      const labels = await ensureBidderLabels(tx, a.id, [...new Set(resolution.records.map((r) => r.bidderId))]);
      const bidderCount = labels.size;
      const anti = applyAntiSniping(a.endsAt, now, a.antiSnipeMinutes);
      const winning = inserted[inserted.length - 1]!;
      const bidCount = a.bidCount + inserted.length;
      await tx
        .update(schema.auctions)
        .set({
          currentBid: resolution.newCurrentBid,
          currentBidderCompanyId: resolution.newLeaderId,
          winningBidId: winning.id,
          bidCount,
          bidderCount,
          endsAt: anti.endsAt,
          extensionCount: anti.extended ? a.extensionCount + 1 : a.extensionCount,
          version: sql`${schema.auctions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.auctions.id, a.id));

      for (const b of inserted) {
        await audit(tx, b.companyId === me ? req.actor : { ...SYSTEM_ACTOR, role: 'PROXY_AGENT', companyId: b.companyId }, {
          event: 'BID_PLACED',
          entityType: 'auction',
          entityId: a.id,
          newValue: { bidId: b.id, companyId: b.companyId, amount: b.amount, kind: b.kind, sequence: b.sequence, transactionId: b.transactionId, serverTime: now.toISOString() },
        });
      }
      if (maxAmount !== null) await audit(tx, req.actor, { event: 'MAX_BID_SET', entityType: 'auction', entityId: a.id, newValue: { maxAmount } });
      if (anti.extended) {
        await audit(tx, SYSTEM_ACTOR, {
          event: 'AUCTION_EXTENDED',
          entityType: 'auction',
          entityId: a.id,
          oldValue: { endsAt: a.endsAt },
          newValue: { endsAt: anti.endsAt, reason: 'anti_sniping', minutes: a.antiSnipeMinutes },
        });
      }

      const nextMin = resolution.newCurrentBid + a.bidIncrement;
      await publish(tx, channels.auction(a.id), 'bid', {
        auctionId: a.id,
        currentBid: resolution.newCurrentBid,
        bidCount,
        bidderCount,
        minNextBid: nextMin,
        endsAt: anti.endsAt.toISOString(),
        extended: anti.extended,
        leaderLabel: labels.get(resolution.newLeaderId) ?? null,
        reserveMet: a.reserveVisible && a.reservePrice !== null ? resolution.newCurrentBid >= a.reservePrice : undefined,
        version: a.version + 1,
        bids: inserted.map((b) => ({ label: labels.get(b.companyId) ?? null, amount: b.amount, kind: b.kind, at: now.toISOString(), sequence: b.sequence })),
      });
      await publish(tx, channels.admin(), 'auction.bid', { auctionId: a.id, currentBid: resolution.newCurrentBid, bidCount });

      const title = await vehicleTitle(tx, a.vehicleId);
      if (resolution.leaderChanged && resolution.previousLeaderId && resolution.previousLeaderId !== me) {
        await notifyCompany(tx, resolution.previousLeaderId, {
          type: 'OUTBID',
          title: `Sie wurden überboten: ${title}`,
          body: `Aktuelles Gebot: ${formatEuro(resolution.newCurrentBid)}. Auktion endet ${formatDateTimeDe(anti.endsAt)}.`,
          link: `/haendler/auktionen/${a.id}`,
        });
      }
      if (resolution.outbidByProxy) {
        await notifyCompany(tx, me, {
          type: 'OUTBID',
          title: `Sie wurden überboten: ${title}`,
          body: `Ein Maximalgebot eines anderen Händlers liegt höher. Aktuelles Gebot: ${formatEuro(resolution.newCurrentBid)}.`,
          link: `/haendler/auktionen/${a.id}`,
          email: false,
        });
      }

      return {
        accepted: true,
        duplicate: false,
        status: resolution.newLeaderId === me ? 'LEADING' : 'OUTBID',
        currentBid: resolution.newCurrentBid,
        minNextBid: nextMin,
        bidCount,
        endsAt: anti.endsAt,
        extended: anti.extended,
        serverTime: now,
      };
    }),
  );
}

function snapshotResult(a: Auction, me: string, duplicate: boolean, extended: boolean, now: Date): BidResult {
  return {
    accepted: true,
    duplicate,
    status: a.currentBidderCompanyId === me ? 'LEADING' : 'OUTBID',
    currentBid: a.currentBid,
    minNextBid: auctionMinNext(a),
    bidCount: a.bidCount,
    endsAt: a.endsAt,
    extended,
    serverTime: now,
  };
}

async function upsertMaxBid(tx: DbOrTx, auctionId: string, companyId: string, userId: string, maxAmount: number): Promise<void> {
  await tx
    .insert(schema.maximumBids)
    .values({ auctionId, companyId, userId, maxAmount, active: true })
    .onConflictDoUpdate({
      target: [schema.maximumBids.auctionId, schema.maximumBids.companyId],
      set: { maxAmount, userId, active: true, updatedAt: new Date() },
    });
}

/** Vergibt anonyme Bieternummern ("Bieter 3") in Reihenfolge des ersten Gebots. */
async function ensureBidderLabels(tx: DbOrTx, auctionId: string, companyIds: string[]): Promise<Map<string, number>> {
  for (const companyId of companyIds) {
    await tx.execute(sql`
      INSERT INTO auction_bidders (auction_id, company_id, label)
      VALUES (${auctionId}, ${companyId}, (SELECT coalesce(max(label), 0) + 1 FROM auction_bidders WHERE auction_id = ${auctionId}))
      ON CONFLICT DO NOTHING`);
  }
  const rows = await tx.select().from(schema.auctionBidders).where(eq(schema.auctionBidders.auctionId, auctionId));
  return new Map(rows.map((r) => [r.companyId, r.label]));
}

// =====================================================================================
// Lebenszyklus
// =====================================================================================

/** SCHEDULED → ACTIVE. Prüft, dass das Fahrzeug weiterhin startbereit ist (kein Start mit unvollständiger Akte). */
export async function activateAuction(tx: DbOrTx, a: Auction, now: Date, actor: Actor): Promise<boolean> {
  const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, a.vehicleId)).for('update');
  if (!v || v.status !== 'SCHEDULED' || !v.approvedAt) {
    await setAuctionStatus(tx, actor, a, 'CANCELLED', { cancelledReason: 'Fahrzeug war zum Startzeitpunkt nicht freigegeben', outcome: 'CANCELLED', endedAt: now });
    if (v && v.status === 'SCHEDULED') await setVehicleStatusRaw(tx, actor, v.id, 'APPROVED');
    await notifyAdmins(tx, {
      type: 'SYSTEM_ALERT',
      title: `Auktion ${a.number} nicht gestartet`,
      body: `Das Fahrzeug ${v?.internalNumber ?? ''} war zum Startzeitpunkt nicht freigegeben (Status ${v?.status ?? 'unbekannt'}). Die Auktion wurde abgebrochen.`,
      link: `/admin/auktionen/${a.id}`,
    });
    return false;
  }
  await setAuctionStatus(tx, actor, a, 'ACTIVE', { startedAt: now });
  await setVehicleStatusRaw(tx, actor, a.vehicleId, 'IN_AUCTION');
  await publish(tx, channels.auction(a.id), 'started', { auctionId: a.id, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString() });
  await publish(tx, channels.admin(), 'auction.started', { auctionId: a.id });
  const watchers = await watcherUserIds(tx, a.vehicleId);
  if (watchers.length) {
    await notifyUsers(tx, watchers, {
      type: 'AUCTION_STARTED',
      title: `Auktion gestartet: ${await vehicleTitle(tx, a.vehicleId)}`,
      body: `Startpreis ${formatEuro(a.startPrice)}. Endet ${formatDateTimeDe(a.endsAt)}.`,
      link: `/haendler/auktionen/${a.id}`,
    });
  }
  return true;
}

/**
 * ACTIVE → ENDED im selben Commit mit Ergebnis, Fahrzeugstatus und ggf. Deal.
 * Die Auktion muss vom Aufrufer gesperrt sein (FOR UPDATE).
 */
export async function finalizeAuction(tx: DbOrTx, a: Auction, now: Date, actor: Actor, reason: 'TIME' | 'BUY_NOW'): Promise<void> {
  const outcome = reason === 'BUY_NOW' ? 'BUY_NOW' : determineOutcome({ bidCount: a.bidCount, currentBid: a.currentBid, reservePrice: a.reservePrice });
  await setAuctionStatus(tx, actor, a, 'ENDED', { outcome, endedAt: now });
  await tx.update(schema.maximumBids).set({ active: false, updatedAt: new Date() }).where(and(eq(schema.maximumBids.auctionId, a.id), eq(schema.maximumBids.active, true)));
  await audit(tx, actor, {
    event: 'AUCTION_ENDED',
    entityType: 'auction',
    entityId: a.id,
    newValue: { outcome, finalBid: a.currentBid, bidCount: a.bidCount, bidderCount: a.bidderCount, winnerCompanyId: a.currentBidderCompanyId, endsAt: a.endsAt.toISOString(), endedAt: now.toISOString() },
  });
  const title = await vehicleTitle(tx, a.vehicleId);
  const bidders = await bidderCompanyIds(tx, a.id);
  const [vehicle] = await tx.select({ companyId: schema.vehicles.companyId }).from(schema.vehicles).where(eq(schema.vehicles.id, a.vehicleId));

  if ((outcome === 'SOLD' || outcome === 'BUY_NOW') && a.winningBidId) {
    const [winningBid] = await tx.select().from(schema.bids).where(eq(schema.bids.id, a.winningBidId));
    await setVehicleStatusRaw(tx, actor, a.vehicleId, 'SOLD');
    await createDealFromAuction(tx, actor, a, winningBid!, outcome === 'BUY_NOW' ? 'BUY_NOW' : 'AUCTION', now);
    for (const c of bidders.filter((b) => b !== a.currentBidderCompanyId)) {
      await notifyCompany(tx, c, { type: 'AUCTION_LOST', title: `Auktion beendet: ${title}`, body: 'Sie haben diese Auktion leider nicht gewonnen.', link: `/haendler/auktionen/${a.id}`, email: false });
    }
  } else {
    await setVehicleStatusRaw(tx, actor, a.vehicleId, 'UNSOLD');
    if (outcome === 'RESERVE_NOT_MET') {
      await notifyAdmins(tx, {
        type: 'RESERVE_NOT_MET',
        title: `Mindestpreis nicht erreicht: ${title}`,
        body: `Höchstgebot ${formatEuro(a.currentBid)} (Mindestpreis ${formatEuro(a.reservePrice)}). Bitte Vorgehen festlegen.`,
        link: `/admin/auktionen/${a.id}`,
      });
      if (a.currentBidderCompanyId) {
        await notifyCompany(tx, a.currentBidderCompanyId, {
          type: 'RESERVE_NOT_MET',
          title: `Mindestpreis nicht erreicht: ${title}`,
          body: `Ihr Höchstgebot von ${formatEuro(a.currentBid)} hat den Mindestpreis nicht erreicht. Der Plattformbetreiber prüft das weitere Vorgehen.`,
          link: `/haendler/auktionen/${a.id}`,
        });
      }
    }
    if (vehicle) {
      await notifyCompany(tx, vehicle.companyId, {
        type: outcome === 'RESERVE_NOT_MET' ? 'RESERVE_NOT_MET' : 'AUCTION_LOST',
        title: `Auktion ohne Verkauf beendet: ${title}`,
        body: outcome === 'RESERVE_NOT_MET' ? `Höchstgebot ${formatEuro(a.currentBid)} – Mindestpreis nicht erreicht. Wir melden uns bei Ihnen.` : 'Es wurden keine Gebote abgegeben.',
        link: '/autohaus/nicht-verkauft',
      });
    }
    for (const c of bidders.filter((b) => b !== a.currentBidderCompanyId)) {
      await notifyCompany(tx, c, { type: 'AUCTION_LOST', title: `Auktion beendet: ${title}`, body: 'Sie haben diese Auktion nicht gewonnen.', link: `/haendler/auktionen/${a.id}`, email: false });
    }
  }
  await publish(tx, channels.auction(a.id), 'ended', { auctionId: a.id, endedAt: now.toISOString(), finalBid: a.currentBid, bidCount: a.bidCount });
  await publish(tx, channels.admin(), 'auction.ended', { auctionId: a.id, outcome });
}

export async function cancelAuction(tx: DbOrTx, a: Auction, actor: Actor, reason: string): Promise<void> {
  if (a.status === 'ENDED') throw new AppError(409, 'AUCTION_ENDED', 'Beendete Auktionen können nicht abgebrochen werden.');
  const [deal] = await tx.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.auctionId, a.id));
  if (deal) throw new AppError(409, 'DEAL_EXISTS', 'Nach einem verbindlichen Zuschlag kann die Auktion nicht gestoppt werden.');
  const now = await dbClock(tx);
  await setAuctionStatus(tx, actor, a, 'CANCELLED', { cancelledReason: reason, outcome: 'CANCELLED', endedAt: now });
  await tx.update(schema.maximumBids).set({ active: false }).where(eq(schema.maximumBids.auctionId, a.id));
  const [v] = await tx.select({ status: schema.vehicles.status }).from(schema.vehicles).where(eq(schema.vehicles.id, a.vehicleId));
  if (v && (v.status === 'SCHEDULED' || v.status === 'IN_AUCTION')) await setVehicleStatusRaw(tx, actor, a.vehicleId, 'APPROVED');
  const title = await vehicleTitle(tx, a.vehicleId);
  for (const c of await bidderCompanyIds(tx, a.id)) {
    await notifyCompany(tx, c, { type: 'AUCTION_CANCELLED', title: `Auktion abgebrochen: ${title}`, body: `Die Auktion wurde vom Plattformbetreiber gestoppt. Grund: ${reason}`, link: `/haendler/auktionen/${a.id}` });
  }
  await publish(tx, channels.auction(a.id), 'cancelled', { auctionId: a.id, reason });
  await publish(tx, channels.admin(), 'auction.cancelled', { auctionId: a.id });
}

/** Admin ändert die Endzeit einer laufenden Auktion – live bei allen Teilnehmern sichtbar. */
export async function changeEndTime(tx: DbOrTx, a: Auction, actor: Actor, endsAt: Date, reason: string): Promise<void> {
  if (a.status !== 'ACTIVE' && a.status !== 'SCHEDULED') throw new AppError(409, 'INVALID_TRANSITION', 'Endzeit kann nur bei geplanten oder laufenden Auktionen geändert werden.');
  const now = await dbClock(tx);
  if (endsAt.getTime() < now.getTime() + 60_000) throw new AppError(400, 'END_TOO_SOON', 'Die neue Endzeit muss mindestens eine Minute in der Zukunft liegen.');
  if (endsAt <= a.startsAt) throw new AppError(400, 'END_BEFORE_START', 'Die Endzeit muss nach dem Start liegen.');
  await tx
    .update(schema.auctions)
    .set({ endsAt, endingSoonNotifiedAt: null, version: sql`${schema.auctions.version} + 1`, updatedAt: new Date() })
    .where(eq(schema.auctions.id, a.id));
  await audit(tx, actor, { event: 'AUCTION_EXTENDED', entityType: 'auction', entityId: a.id, oldValue: { endsAt: a.endsAt }, newValue: { endsAt, reason } });
  await publish(tx, channels.auction(a.id), 'extended', { auctionId: a.id, endsAt: endsAt.toISOString(), reason: 'admin' });
  const title = await vehicleTitle(tx, a.vehicleId);
  for (const c of await bidderCompanyIds(tx, a.id)) {
    await notifyCompany(tx, c, { type: 'AUCTION_EXTENDED', title: `Endzeit geändert: ${title}`, body: `Neue Endzeit: ${formatDateTimeDe(endsAt)}. Grund: ${reason}`, link: `/haendler/auktionen/${a.id}`, email: false });
  }
}

// =====================================================================================
// Scheduler-Operationen (mehrinstanzfähig durch SKIP LOCKED)
// =====================================================================================

export async function startDueAuctions(limit = 50): Promise<number> {
  const due = await db
    .select({ id: schema.auctions.id })
    .from(schema.auctions)
    .where(and(eq(schema.auctions.status, 'SCHEDULED'), sql`${schema.auctions.startsAt} <= clock_timestamp()`))
    .orderBy(asc(schema.auctions.startsAt))
    .limit(limit);
  let started = 0;
  for (const { id } of due) {
    const ok = await withTxRetry(() =>
      db.transaction(async (tx) => {
        const [a] = await tx.select().from(schema.auctions).where(eq(schema.auctions.id, id)).for('update', { skipLocked: true });
        if (!a || a.status !== 'SCHEDULED') return false;
        const now = await dbClock(tx);
        if (a.startsAt > now) return false;
        return activateAuction(tx, a, now, SYSTEM_ACTOR);
      }),
    );
    if (ok) started++;
  }
  return started;
}

export async function endDueAuctions(limit = 50): Promise<number> {
  const due = await db
    .select({ id: schema.auctions.id })
    .from(schema.auctions)
    .where(and(eq(schema.auctions.status, 'ACTIVE'), sql`${schema.auctions.endsAt} <= clock_timestamp()`))
    .orderBy(asc(schema.auctions.endsAt))
    .limit(limit);
  let ended = 0;
  for (const { id } of due) {
    const ok = await withTxRetry(() =>
      db.transaction(async (tx) => {
        // SKIP LOCKED: läuft gerade ein Gebot (evtl. mit Verlängerung), wird im nächsten Takt erneut geprüft.
        const [a] = await tx.select().from(schema.auctions).where(eq(schema.auctions.id, id)).for('update', { skipLocked: true });
        if (!a || a.status !== 'ACTIVE') return false;
        const now = await dbClock(tx);
        if (a.endsAt > now) return false; // wurde zwischenzeitlich verlängert
        await finalizeAuction(tx, a, now, SYSTEM_ACTOR, 'TIME');
        return true;
      }),
    );
    if (ok) ended++;
  }
  return ended;
}

export async function notifyEndingSoon(minutes: number): Promise<number> {
  const due = await db
    .select()
    .from(schema.auctions)
    .where(
      and(
        eq(schema.auctions.status, 'ACTIVE'),
        sql`${schema.auctions.endingSoonNotifiedAt} IS NULL`,
        sql`${schema.auctions.endsAt} <= clock_timestamp() + make_interval(mins => ${minutes})`,
      ),
    )
    .limit(50);
  for (const a of due) {
    await db.transaction(async (tx) => {
      const res = await tx
        .update(schema.auctions)
        .set({ endingSoonNotifiedAt: new Date() })
        .where(and(eq(schema.auctions.id, a.id), sql`${schema.auctions.endingSoonNotifiedAt} IS NULL`))
        .returning({ id: schema.auctions.id });
      if (!res.length) return;
      const users = new Set(await watcherUserIds(tx, a.vehicleId));
      for (const c of await bidderCompanyIds(tx, a.id)) for (const u of await companyUserIds(tx, c)) users.add(u);
      if (users.size) {
        await notifyUsers(tx, [...users], {
          type: 'AUCTION_ENDING_SOON',
          title: `Auktion endet bald: ${await vehicleTitle(tx, a.vehicleId)}`,
          body: `Endet ${formatDateTimeDe(a.endsAt)}. Aktuelles Gebot: ${formatEuro(a.currentBid ?? a.startPrice)}.`,
          link: `/haendler/auktionen/${a.id}`,
          email: false,
        });
      }
    });
  }
  return due.length;
}

/** Temporäre Bietersperren laufen automatisch aus. */
export async function releaseExpiredTempBlocks(): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.dealerVerifications)
      .set({ biddingStatus: 'CAN_BID', blockedUntil: null, updatedAt: new Date() })
      .where(and(eq(schema.dealerVerifications.biddingStatus, 'TEMP_BLOCKED'), sql`${schema.dealerVerifications.blockedUntil} <= clock_timestamp()`))
      .returning({ companyId: schema.dealerVerifications.companyId });
    for (const r of rows) {
      await audit(tx, SYSTEM_ACTOR, { event: 'BIDDING_STATUS_CHANGED', entityType: 'company', entityId: r.companyId, oldValue: { biddingStatus: 'TEMP_BLOCKED' }, newValue: { biddingStatus: 'CAN_BID', reason: 'Sperrfrist abgelaufen' } });
    }
    return rows.length;
  });
}

void inArray;
void ne;
