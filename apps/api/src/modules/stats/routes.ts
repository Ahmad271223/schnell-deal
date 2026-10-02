import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { uuidSchema } from '@sd/shared';
import { db } from '../../core/db/client';
import { notFound, parse } from '../../core/errors';
import { companyOf, getAuth, requireAdmin, requireCompany, requireRoles } from '../../core/auth';

/**
 * Alle Kennzahlen werden live aus der Datenbank berechnet (keine Mock-Werte, keine Caches).
 * Zeiträume werden in Europe/Berlin ausgewertet. Stornierte Deals zählen nicht als Verkauf.
 */

const TZ = `'Europe/Berlin'`;
const today = sql.raw(`(now() at time zone ${TZ})::date`);
const local = (col: string) => sql.raw(`(${col} at time zone ${TZ})`);

async function one<T>(q: ReturnType<typeof sql>): Promise<T> {
  const res = await db.execute(q);
  return res.rows[0] as T;
}
async function many<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(q);
  return res.rows as T[];
}

export async function platformOverview() {
  const day = await one<Record<string, number>>(sql`
    select
      (select count(*)::int from inspection_requests where ${local('created_at')}::date = ${today}) as "newRequests",
      (select count(*)::int from vehicles where ${local('inspection_completed_at')}::date = ${today}) as "vehiclesInspected",
      (select count(*)::int from vehicles where ${local('approved_at')}::date = ${today}) as "vehiclesApproved",
      (select count(*)::int from auctions where status = 'ACTIVE') as "activeAuctions",
      (select count(*)::int from deals where status <> 'CANCELLED' and ${local('sold_at')}::date = ${today}) as "sold",
      (select coalesce(sum(sale_price), 0)::bigint from deals where status <> 'CANCELLED' and ${local('sold_at')}::date = ${today}) as "revenue",
      (select coalesce(sum(buyer_fee_net + seller_fee_net), 0)::bigint from deals where status <> 'CANCELLED' and ${local('sold_at')}::date = ${today}) as "platformFees",
      (select count(*)::int from auctions where status = 'ENDED' and ${local('ended_at')}::date = ${today}) as "auctionsEnded"
  `);
  const month = await one<Record<string, number | null>>(sql`
    with ended as (
      select a.* from auctions a
      where a.status = 'ENDED' and date_trunc('month', ${local('a.ended_at')}) = date_trunc('month', ${today}::timestamp)
    ), sold as (
      select d.* from deals d
      where d.status <> 'CANCELLED' and date_trunc('month', ${local('d.sold_at')}) = date_trunc('month', ${today}::timestamp)
    )
    select
      (select count(*)::int from vehicles where date_trunc('month', ${local('inspection_completed_at')}) = date_trunc('month', ${today}::timestamp)) as "vehiclesInspected",
      (select count(*)::int from ended) as "auctioned",
      (select count(*)::int from sold) as "sold",
      (select count(*)::int from ended e where not exists (select 1 from deals d where d.auction_id = e.id and d.status <> 'CANCELLED')) as "unsold",
      (select coalesce(sum(sale_price), 0)::bigint from sold) as "totalHammer",
      (select round(avg(sale_price))::bigint from sold) as "avgPrice",
      (select count(*)::int from bids where date_trunc('month', ${local('server_time')}) = date_trunc('month', ${today}::timestamp)) as "bids",
      (select round(avg(bid_count)::numeric, 1)::float from ended) as "bidsPerVehicle",
      (select round(avg(bidder_count)::numeric, 1)::float from ended) as "avgBidders",
      (select coalesce(sum(buyer_fee_net + seller_fee_net), 0)::bigint from sold) as "platformFees",
      (select round(avg(extract(epoch from (s.sold_at - v.inspection_completed_at)) / 86400)::numeric, 1)::float
         from sold s join vehicles v on v.id = s.vehicle_id where v.inspection_completed_at is not null) as "avgDaysToSale"
  `);
  const series = await many<Record<string, unknown>>(sql`
    with months as (
      select generate_series(date_trunc('month', ${today}::timestamp) - interval '11 months', date_trunc('month', ${today}::timestamp), interval '1 month') as m
    )
    select to_char(m, 'YYYY-MM') as month,
      (select count(*)::int from vehicles v where date_trunc('month', ${local('v.inspection_completed_at')}) = m) as inspected,
      (select count(*)::int from deals d where d.status <> 'CANCELLED' and date_trunc('month', ${local('d.sold_at')}) = m) as sold,
      (select count(*)::int from auctions a where a.status = 'ENDED' and date_trunc('month', ${local('a.ended_at')}) = m) as ended,
      (select coalesce(sum(d.sale_price), 0)::bigint from deals d where d.status <> 'CANCELLED' and date_trunc('month', ${local('d.sold_at')}) = m) as revenue
    from months order by m
  `);
  const queue = await one<Record<string, number>>(sql`
    select
      (select count(*)::int from vehicles where status = 'WAITING_REVIEW') as "waitingReview",
      (select count(*)::int from inspection_requests where status = 'NEW') as "unplannedRequests",
      (select count(*)::int from companies where status = 'IN_REVIEW') as "companiesInReview",
      (select count(*)::int from auctions where status = 'ENDED' and outcome = 'RESERVE_NOT_MET' and resolved_at is null) as "reserveDecisions",
      (select count(*)::int from complaints where status in ('OPEN','IN_REVIEW')) as "openComplaints",
      (select count(*)::int from jobs where status = 'FAILED') as "failedJobs",
      (select count(*)::int from deals where status = 'PAYMENT_PENDING' and payment_due_at < now()) as "overduePayments"
  `);
  const saleRate = (sold: number, total: number) => (total > 0 ? Math.round((sold / total) * 1000) / 10 : null);
  return {
    today: { ...day, saleRate: saleRate(day.sold ?? 0, day.auctionsEnded ?? 0) },
    month: { ...month, saleRate: saleRate(Number(month.sold ?? 0), Number(month.auctioned ?? 0)) },
    series,
    queue,
    generatedAt: new Date().toISOString(),
  };
}

export async function dealershipStats(companyId: string) {
  const k = await one<Record<string, number | null>>(sql`
    with v as (select * from vehicles where company_id = ${companyId}),
    d as (select * from deals where seller_company_id = ${companyId} and status <> 'CANCELLED'),
    e as (select a.* from auctions a join v on v.id = a.vehicle_id where a.status = 'ENDED')
    select
      (select count(*)::int from v where ${local('created_at')}::date = ${today}) as "vehiclesToday",
      (select count(*)::int from v where date_trunc('week', ${local('created_at')}) = date_trunc('week', ${today}::timestamp)) as "vehiclesWeek",
      (select count(*)::int from v where date_trunc('month', ${local('created_at')}) = date_trunc('month', ${today}::timestamp)) as "vehiclesMonth",
      (select count(*)::int from v where date_trunc('year', ${local('created_at')}) = date_trunc('year', ${today}::timestamp)) as "vehiclesYear",
      (select count(*)::int from v) as "vehiclesTotal",
      (select count(*)::int from v where status = 'IN_AUCTION') as "inAuction",
      (select count(*)::int from d) as "sold",
      (select count(*)::int from e where not exists (select 1 from deals x where x.auction_id = e.id and x.status <> 'CANCELLED')) as "unsold",
      (select count(*)::int from e) as "auctionsEnded",
      (select coalesce(sum(sale_price), 0)::bigint from d) as "totalSales",
      (select round(avg(sale_price))::bigint from d) as "avgSalePrice",
      (select round(avg(bid_count)::numeric, 1)::float from e) as "avgBids",
      (select round(avg(bidder_count)::numeric, 1)::float from e) as "avgBidders",
      (select count(*)::int from inspection_requests where company_id = ${companyId} and status = 'COMPLETED') as "inspectionAppointments",
      (select round(avg(extract(epoch from (d.sold_at - v.inspection_completed_at)) / 86400)::numeric, 1)::float
         from d join v on v.id = d.vehicle_id where v.inspection_completed_at is not null) as "avgDaysToSale"
  `);
  const vehiclesInRequests = await one<{ n: number }>(sql`
    select count(*)::int as n from vehicles v join inspection_requests r on r.id = v.inspection_request_id
    where r.company_id = ${companyId} and r.status = 'COMPLETED'`);
  const series = await many<Record<string, unknown>>(sql`
    with months as (
      select generate_series(date_trunc('month', ${today}::timestamp) - interval '11 months', date_trunc('month', ${today}::timestamp), interval '1 month') as m
    )
    select to_char(m, 'YYYY-MM') as month,
      (select count(*)::int from vehicles v where v.company_id = ${companyId} and date_trunc('month', ${local('v.created_at')}) = m) as vehicles,
      (select count(*)::int from deals d where d.seller_company_id = ${companyId} and d.status <> 'CANCELLED' and date_trunc('month', ${local('d.sold_at')}) = m) as sold,
      (select count(*)::int from auctions a join vehicles v on v.id = a.vehicle_id where v.company_id = ${companyId} and a.status = 'ENDED' and date_trunc('month', ${local('a.ended_at')}) = m) as ended,
      (select round(avg(d.sale_price))::bigint from deals d where d.seller_company_id = ${companyId} and d.status <> 'CANCELLED' and date_trunc('month', ${local('d.sold_at')}) = m) as "avgPrice"
    from months order by m
  `);
  const byMake = await many<{ make: string; count: number }>(sql`
    select coalesce(make, 'Unbekannt') as make, count(*)::int as count from vehicles where company_id = ${companyId}
    group by 1 order by 2 desc limit 15`);
  const ended = Number(k.auctionsEnded ?? 0);
  return {
    kpis: {
      ...k,
      saleRate: ended > 0 ? Math.round((Number(k.sold ?? 0) / ended) * 1000) / 10 : null,
      vehiclesPerAppointment: Number(k.inspectionAppointments) > 0 ? Math.round((vehiclesInRequests.n / Number(k.inspectionAppointments)) * 10) / 10 : null,
    },
    series: series.map((s) => ({ ...s, saleRate: Number(s.ended) > 0 ? Math.round((Number(s.sold) / Number(s.ended)) * 1000) / 10 : null })),
    byMake,
  };
}

export async function dealerStats(companyId: string) {
  return one<Record<string, unknown>>(sql`
    with d as (select * from deals where buyer_company_id = ${companyId})
    select
      (select count(*)::int from bids where company_id = ${companyId} and kind <> 'PROXY') as "bids",
      (select count(*)::int from bids where company_id = ${companyId}) as "bidsInclProxy",
      (select count(distinct auction_id)::int from bids where company_id = ${companyId}) as "auctionsParticipated",
      (select count(*)::int from d where status <> 'CANCELLED') as "purchases",
      (select coalesce(sum(sale_price), 0)::bigint from d where status <> 'CANCELLED') as "purchaseVolume",
      (select round(avg(sale_price))::bigint from d where status <> 'CANCELLED') as "avgPurchasePrice",
      (select count(*)::int from d where status = 'PAYMENT_PENDING') as "openPayments",
      (select coalesce(sum(buyer_total), 0)::bigint from d where status = 'PAYMENT_PENDING') as "openPaymentAmount",
      (select count(*)::int from d where status = 'CANCELLED') as "cancellations",
      (select count(*)::int from complaints c join d on d.id = c.deal_id) as "complaints",
      (select max(server_time) from bids where company_id = ${companyId}) as "lastBidAt",
      (select max(u.last_login_at) from users u join company_users cu on cu.user_id = u.id where cu.company_id = ${companyId}) as "lastLoginAt"
  `).then((r) => {
    const participated = Number(r.auctionsParticipated ?? 0);
    return { ...r, purchaseRate: participated > 0 ? Math.round((Number(r.purchases ?? 0) / participated) * 1000) / 10 : null };
  });
}

/** Betriebskennzahlen je Außendienstmitarbeiter – bewusst ohne Ranking (Spec §42). */
export async function inspectorStats(userId?: string) {
  const rows = await many<Record<string, unknown>>(sql`
    select u.id, u.first_name as "firstName", u.last_name as "lastName",
      (select count(*)::int from inspection_assignments ia where ia.inspector_user_id = u.id and ia.completed_at is not null) as "appointments",
      (select count(*)::int from vehicles v where v.inspector_user_id = u.id and v.inspection_completed_at is not null) as "vehiclesInspected",
      (select count(distinct (v.inspection_completed_at at time zone 'Europe/Berlin')::date)::int from vehicles v where v.inspector_user_id = u.id and v.inspection_completed_at is not null) as "activeDays",
      (select round(avg(extract(epoch from (v.inspection_completed_at - v.inspection_started_at)) / 60)::numeric, 1)::float
         from vehicles v where v.inspector_user_id = u.id and v.inspection_completed_at is not null and v.inspection_started_at is not null) as "avgInspectionMinutes",
      (select count(*)::int from vehicle_photos p join vehicles v on v.id = p.vehicle_id where v.inspector_user_id = u.id and p.quality <> 'OK' and not p.quality_override) as "photosRejectedByQualityCheck",
      (select count(*)::int from vehicle_photos p join vehicles v on v.id = p.vehicle_id where v.inspector_user_id = u.id and p.quality = 'CROPPED' and p.replaced_by_id is null and not p.quality_override) as "photosNotFullyVisible",
      (select coalesce(sum(coalesce(array_length(v.requested_photo_slots, 1), 0)), 0)::int from vehicles v where v.inspector_user_id = u.id) as "photosRequestedByAdmin",
      (select count(*)::int from vehicles v where v.inspector_user_id = u.id and v.return_count > 0) as "vehiclesReturned",
      (select coalesce(sum(v.return_count), 0)::int from vehicles v where v.inspector_user_id = u.id) as "returnsTotal"
    from users u
    where u.platform_role = 'INSPECTOR' ${userId ? sql`and u.id = ${userId}` : sql``}
    order by u.last_name, u.first_name
  `);
  return rows.map((r) => {
    const inspected = Number(r.vehiclesInspected ?? 0);
    const days = Number(r.activeDays ?? 0);
    return {
      ...r,
      vehiclesPerDay: days > 0 ? Math.round((inspected / days) * 10) / 10 : null,
      reworkRate: inspected > 0 ? Math.round((Number(r.vehiclesReturned ?? 0) / inspected) * 1000) / 10 : null,
    };
  });
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/stats/overview', { preHandler: requireAdmin }, async () => platformOverview());

  app.get('/admin/stats/companies/:id', { preHandler: requireAdmin }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const [c] = (await db.execute<{ type: string; name: string }>(sql`select type, name from companies where id = ${id}`)).rows;
    if (!c) throw notFound('Unternehmen');
    return { company: c, stats: c.type === 'DEALER' ? await dealerStats(id) : await dealershipStats(id) };
  });

  app.get('/admin/stats/dealerships', { preHandler: requireAdmin }, async () =>
    many(sql`
      select c.id, c.name, c.city,
        (select count(*)::int from vehicles v where v.company_id = c.id) as vehicles,
        (select count(*)::int from vehicles v where v.company_id = c.id and date_trunc('month', (v.created_at at time zone 'Europe/Berlin')) = date_trunc('month', (now() at time zone 'Europe/Berlin'))) as "vehiclesMonth",
        (select count(*)::int from deals d where d.seller_company_id = c.id and d.status <> 'CANCELLED') as sold,
        (select coalesce(sum(d.sale_price), 0)::bigint from deals d where d.seller_company_id = c.id and d.status <> 'CANCELLED') as "totalSales"
      from companies c where c.type = 'DEALERSHIP' and c.status = 'APPROVED' order by c.name`),
  );

  app.get('/admin/stats/dealers', { preHandler: requireAdmin }, async () =>
    many(sql`
      select c.id, c.name, c.city, dv.bidding_status as "biddingStatus",
        (select count(*)::int from bids b where b.company_id = c.id and b.kind <> 'PROXY') as bids,
        (select count(distinct b.auction_id)::int from bids b where b.company_id = c.id) as "auctionsParticipated",
        (select count(*)::int from deals d where d.buyer_company_id = c.id and d.status <> 'CANCELLED') as purchases,
        (select coalesce(sum(d.sale_price), 0)::bigint from deals d where d.buyer_company_id = c.id and d.status <> 'CANCELLED') as "purchaseVolume",
        (select count(*)::int from deals d where d.buyer_company_id = c.id and d.status = 'PAYMENT_PENDING') as "openPayments",
        (select max(b.server_time) from bids b where b.company_id = c.id) as "lastBidAt"
      from companies c left join dealer_verifications dv on dv.company_id = c.id
      where c.type = 'DEALER' and c.status in ('APPROVED','BLOCKED') order by c.name`),
  );

  app.get('/admin/stats/inspectors', { preHandler: requireAdmin }, async () => inspectorStats());

  app.get('/inspector/stats', { preHandler: requireRoles('INSPECTOR') }, async (req) => (await inspectorStats(getAuth(req).userId))[0] ?? null);

  app.get('/company/stats', { preHandler: requireCompany() }, async (req) => {
    const c = companyOf(req);
    return c.type === 'DEALER' ? { type: 'DEALER', stats: await dealerStats(c.id) } : { type: 'DEALERSHIP', ...(await dealershipStats(c.id)) };
  });
}
