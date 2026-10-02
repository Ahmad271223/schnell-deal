import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  complaintSchema,
  DEAL_STATUSES,
  dealStatusSchema,
  pickupConfirmSchema,
  pickupInfoSchema,
  pickupScheduleSchema,
  regenerateDocsSchema,
  resolveComplaintSchema,
  uuidSchema,
  type DealStatus,
  type GeneratedDocumentKind,
} from '@sd/shared';
import { db, schema, type DbOrTx } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, getAuth, isAdmin, requireAdmin, requireAuth } from '../../core/auth';
import { audit } from '../../core/audit';
import { enqueue } from '../../core/jobs';
import { signedUrl } from '../../core/storage';
import { notifyAdmins, notifyCompany } from '../notifications/service';
import { lockDeal, setDealStatus, type Deal } from './service';

type Role = 'admin' | 'buyer' | 'seller';
const did = (req: FastifyRequest) => parse(uuidSchema, (req.params as { id: string }).id);

/** Mandantenfilter für Deals: Käufer- oder Verkäuferfirma, Admin alle. */
function dealVisibility(req: FastifyRequest): SQL | undefined {
  const u = getAuth(req);
  if (isAdmin(u)) return undefined;
  const c = u.company;
  if (!c || c.status !== 'APPROVED') return sql`false`;
  return c.type === 'DEALER' ? eq(schema.deals.buyerCompanyId, c.id) : eq(schema.deals.sellerCompanyId, c.id);
}

async function loadDeal(tx: DbOrTx, req: FastifyRequest, id: string, forUpdate = false): Promise<{ deal: Deal; role: Role }> {
  const q = tx.select().from(schema.deals).where(and(eq(schema.deals.id, id), dealVisibility(req))).limit(1);
  const [deal] = forUpdate ? await q.for('update') : await q;
  if (!deal) throw notFound('Deal');
  const u = getAuth(req);
  const role: Role = isAdmin(u) ? 'admin' : u.company?.type === 'DEALER' ? 'buyer' : 'seller';
  return { deal, role };
}

function visibleDocKinds(role: Role): GeneratedDocumentKind[] {
  return role === 'admin' ? ['BUYER', 'SELLER', 'INTERNAL'] : role === 'buyer' ? ['BUYER'] : ['SELLER'];
}

function presentDeal(deal: Deal, role: Role) {
  const base = {
    id: deal.id,
    dealNumber: deal.dealNumber,
    auctionId: deal.auctionId,
    vehicleId: deal.vehicleId,
    status: deal.status,
    salePrice: deal.salePrice,
    vehicleVat: deal.vehicleVat,
    vatRateBp: deal.vatRateBp,
    taxType: deal.taxType,
    vin: deal.vinSnapshot,
    vehicle: deal.vehicleSnapshot,
    soldAt: deal.soldAt,
    auctionEndedAt: deal.auctionEndedAt,
    paymentDueAt: deal.paymentDueAt,
    paidAt: deal.paidAt,
    completedAt: deal.completedAt,
    cancelledReason: deal.cancelledReason,
    origin: role === 'admin' ? deal.origin : undefined,
  };
  if (role === 'buyer') {
    return { ...base, seller: deal.sellerSnapshot, buyerFeeNet: deal.buyerFeeNet, buyerFeeVat: deal.buyerFeeVat, buyerTotal: deal.buyerTotal };
  }
  if (role === 'seller') {
    return { ...base, buyer: deal.buyerSnapshot, sellerFeeNet: deal.sellerFeeNet, sellerFeeVat: deal.sellerFeeVat, sellerPayout: deal.sellerPayout };
  }
  return { ...deal, ...base };
}

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.get('/deals', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    const q = parse(z.object({ status: z.enum(DEAL_STATUSES).optional() }), req.query);
    if (!isAdmin(u) && !u.company) throw new AppError(403, 'FORBIDDEN', 'Keine Berechtigung.');
    const rows = await db
      .select()
      .from(schema.deals)
      .where(and(dealVisibility(req), q.status ? eq(schema.deals.status, q.status) : undefined))
      .orderBy(desc(schema.deals.soldAt))
      .limit(500);
    const role: Role = isAdmin(u) ? 'admin' : u.company?.type === 'DEALER' ? 'buyer' : 'seller';
    return rows.map((d) => presentDeal(d, role));
  });

  app.get('/deals/:id', { preHandler: requireAuth }, async (req) => {
    const { deal, role } = await loadDeal(db, req, did(req));
    const history = await db
      .select({ fromStatus: schema.dealStatusHistory.fromStatus, toStatus: schema.dealStatusHistory.toStatus, note: schema.dealStatusHistory.note, createdAt: schema.dealStatusHistory.createdAt })
      .from(schema.dealStatusHistory)
      .where(eq(schema.dealStatusHistory.dealId, deal.id))
      .orderBy(asc(schema.dealStatusHistory.createdAt));
    const documents = await db
      .select({
        id: schema.generatedDocuments.id,
        kind: schema.generatedDocuments.kind,
        version: schema.generatedDocuments.version,
        reason: schema.generatedDocuments.reason,
        sha256: schema.generatedDocuments.sha256,
        sizeBytes: schema.generatedDocuments.sizeBytes,
        generatedAt: schema.generatedDocuments.generatedAt,
      })
      .from(schema.generatedDocuments)
      .where(and(eq(schema.generatedDocuments.dealId, deal.id), sql`${schema.generatedDocuments.kind} = ANY(${sql.raw(`ARRAY[${visibleDocKinds(role).map((k) => `'${k}'`).join(',')}]::generated_document_kind[]`)})`))
      .orderBy(desc(schema.generatedDocuments.version), asc(schema.generatedDocuments.kind));
    const [pickup] = await db.select().from(schema.pickups).where(eq(schema.pickups.dealId, deal.id));
    const complaints = await db.select().from(schema.complaints).where(eq(schema.complaints.dealId, deal.id)).orderBy(desc(schema.complaints.createdAt));
    const invoices = (await db.select().from(schema.invoices).where(eq(schema.invoices.dealId, deal.id))).filter(
      (i) => role === 'admin' || (role === 'buyer' ? i.kind === 'BUYER_FEE' : i.kind === 'SELLER_FEE'),
    );
    const pdfJob = role === 'admin'
      ? (await db.execute<{ status: string; attempts: number; last_error: string | null }>(sql`select status, attempts, last_error from jobs where type = 'pdf.deal' and payload->>'dealId' = ${deal.id} order by id desc limit 1`)).rows[0] ?? null
      : undefined;
    return {
      deal: presentDeal(deal, role),
      role,
      history,
      documents,
      invoices,
      pdfJob,
      pickup: pickup
        ? {
            locationStreet: pickup.locationStreet,
            locationZip: pickup.locationZip,
            locationCity: pickup.locationCity,
            contactName: pickup.contactName,
            contactPhone: pickup.contactPhone,
            openingHours: pickup.openingHours,
            scheduledAt: pickup.scheduledAt,
            handedOverAt: pickup.handedOverAt,
            takenOverAt: pickup.takenOverAt,
            // Abholcode nur für Käufer (und Admin); der Verkäufer prüft ihn bei Übergabe.
            pickupCode: role === 'seller' ? undefined : pickup.pickupCode,
            qrPayload: role === 'seller' ? undefined : `SD-PICKUP:${deal.dealNumber}:${pickup.pickupCode}`,
          }
        : null,
      complaints,
    };
  });

  app.get('/documents/:id/file', { preHandler: requireAuth }, async (req, reply) => {
    const id = did(req);
    const [doc] = await db.select().from(schema.generatedDocuments).where(eq(schema.generatedDocuments.id, id));
    if (!doc) throw notFound('Dokument');
    // Zugriff nur über den zugehörigen Deal (Mandantentrennung) und die Dokumentart der Rolle.
    const { deal, role } = await loadDeal(db, req, doc.dealId);
    if (!visibleDocKinds(role).includes(doc.kind)) throw notFound('Dokument');
    return reply.redirect(await signedUrl(doc.storageKey, { downloadName: `${deal.dealNumber}_${doc.kind}_v${doc.version}.pdf` }));
  });

  app.get('/documents', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    if (!isAdmin(u) && !u.company) throw new AppError(403, 'FORBIDDEN', 'Keine Berechtigung.');
    const role: Role = isAdmin(u) ? 'admin' : u.company?.type === 'DEALER' ? 'buyer' : 'seller';
    const kinds = visibleDocKinds(role);
    return db
      .select({
        id: schema.generatedDocuments.id,
        kind: schema.generatedDocuments.kind,
        version: schema.generatedDocuments.version,
        reason: schema.generatedDocuments.reason,
        generatedAt: schema.generatedDocuments.generatedAt,
        dealId: schema.deals.id,
        dealNumber: schema.deals.dealNumber,
        vehicle: schema.deals.vehicleSnapshot,
      })
      .from(schema.generatedDocuments)
      .innerJoin(schema.deals, eq(schema.deals.id, schema.generatedDocuments.dealId))
      .where(and(dealVisibility(req), sql`${schema.generatedDocuments.kind} = ANY(${sql.raw(`ARRAY[${kinds.map((k) => `'${k}'`).join(',')}]::generated_document_kind[]`)})`))
      .orderBy(desc(schema.generatedDocuments.generatedAt))
      .limit(1000);
  });

  // ---------- Statuskette (Admin) ----------
  app.post('/admin/deals/:id/status', { preHandler: requireAdmin }, async (req) => {
    const id = did(req);
    const input = parse(dealStatusSchema, req.body);
    const allowed: DealStatus[] = ['PAID', 'READY_FOR_PICKUP', 'PICKUP_SCHEDULED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'PAYMENT_PENDING'];
    if (!allowed.includes(input.status)) throw new AppError(400, 'INVALID_STATUS', 'Dieser Status wird über einen eigenen Vorgang gesetzt.');
    if (input.status === 'CANCELLED' && !input.note) throw new AppError(400, 'NOTE_REQUIRED', 'Für eine Stornierung ist eine Begründung erforderlich.');
    return db.transaction(async (tx) => {
      const deal = await lockDeal(tx, id);
      const extra: Partial<Deal> = {};
      if (input.status === 'PAID') extra.paidAt = new Date();
      if (input.status === 'COMPLETED') extra.completedAt = new Date();
      if (input.status === 'CANCELLED') extra.cancelledReason = input.note;
      await setDealStatus(tx, actorOf(req), deal, input.status, input.note, extra);
      if (input.status === 'COMPLETED') {
        await tx.update(schema.vehicles).set({ status: 'COMPLETED', updatedAt: new Date() }).where(and(eq(schema.vehicles.id, deal.vehicleId), eq(schema.vehicles.status, 'SOLD')));
        await audit(tx, actorOf(req), { event: 'VEHICLE_STATUS_CHANGED', entityType: 'vehicle', entityId: deal.vehicleId, oldValue: { status: 'SOLD' }, newValue: { status: 'COMPLETED' } });
      }
      if (input.status === 'CANCELLED') {
        await tx.update(schema.vehicles).set({ status: 'UNSOLD', updatedAt: new Date() }).where(and(eq(schema.vehicles.id, deal.vehicleId), eq(schema.vehicles.status, 'SOLD')));
        await audit(tx, actorOf(req), { event: 'VEHICLE_STATUS_CHANGED', entityType: 'vehicle', entityId: deal.vehicleId, oldValue: { status: 'SOLD' }, newValue: { status: 'UNSOLD', reason: 'Stornierung' } });
        // Stornierung erzeugt eine neue Dokumentversion (alte bleiben erhalten).
        await enqueue(tx, 'pdf.deal', { dealId: id, reason: `Stornierung: ${input.note}`, requestedBy: getAuth(req).userId });
      }
      return { status: input.status };
    });
  });

  app.post('/admin/deals/:id/documents/regenerate', { preHandler: requireAdmin }, async (req) => {
    const id = did(req);
    const input = parse(regenerateDocsSchema, req.body);
    await db.transaction(async (tx) => {
      await lockDeal(tx, id);
      await enqueue(tx, 'pdf.deal', { dealId: id, reason: input.reason, requestedBy: getAuth(req).userId });
      await audit(tx, actorOf(req), { event: 'ADMIN_ACTION', entityType: 'deal', entityId: id, newValue: { action: 'regenerate_documents', reason: input.reason } });
    });
    return { queued: true };
  });

  // ---------- Abholung ----------
  app.put('/deals/:id/pickup', { preHandler: requireAuth }, async (req) => {
    const input = parse(pickupInfoSchema, req.body);
    return db.transaction(async (tx) => {
      const { deal, role } = await loadDeal(tx, req, did(req), true);
      if (role === 'buyer') throw new AppError(403, 'FORBIDDEN', 'Abholinformationen pflegt der Verkäufer.');
      if (['PICKED_UP', 'COMPLETED', 'CANCELLED'].includes(deal.status)) throw new AppError(409, 'DEAL_CLOSED', 'Der Vorgang ist abgeschlossen.');
      await tx.update(schema.pickups).set({ ...input, updatedAt: new Date() }).where(eq(schema.pickups.dealId, deal.id));
      await audit(tx, actorOf(req), { event: 'PICKUP_UPDATED', entityType: 'deal', entityId: deal.id, newValue: input });
      return { ok: true };
    });
  });

  /** Verkäufer oder Admin meldet "abholbereit" (nach Zahlungseingang). */
  app.post('/deals/:id/ready-for-pickup', { preHandler: requireAuth }, async (req) => {
    return db.transaction(async (tx) => {
      const { deal, role } = await loadDeal(tx, req, did(req), true);
      if (role === 'buyer') throw new AppError(403, 'FORBIDDEN', 'Nur Verkäufer oder Plattform.');
      const [p] = await tx.select().from(schema.pickups).where(eq(schema.pickups.dealId, deal.id));
      if (!p?.openingHours || !p.contactName || !p.locationStreet) throw new AppError(409, 'PICKUP_INFO_MISSING', 'Bitte zuerst Standort, Ansprechpartner und Öffnungszeiten hinterlegen.');
      await setDealStatus(tx, actorOf(req), deal, 'READY_FOR_PICKUP', `Abholcode für Käufer bereitgestellt`);
      return { status: 'READY_FOR_PICKUP' };
    });
  });

  app.post('/deals/:id/pickup/schedule', { preHandler: requireAuth }, async (req) => {
    const input = parse(pickupScheduleSchema, req.body);
    return db.transaction(async (tx) => {
      const { deal, role } = await loadDeal(tx, req, did(req), true);
      if (role === 'seller') throw new AppError(403, 'FORBIDDEN', 'Den Abholtermin legt der Käufer fest.');
      if (deal.status !== 'READY_FOR_PICKUP' && deal.status !== 'PICKUP_SCHEDULED') throw new AppError(409, 'INVALID_TRANSITION', 'Das Fahrzeug ist noch nicht abholbereit.');
      const scheduledAt = new Date(input.scheduledAt);
      if (scheduledAt.getTime() < Date.now()) throw new AppError(400, 'DATE_IN_PAST', 'Der Abholtermin darf nicht in der Vergangenheit liegen.');
      await tx.update(schema.pickups).set({ scheduledAt, updatedAt: new Date() }).where(eq(schema.pickups.dealId, deal.id));
      if (deal.status === 'READY_FOR_PICKUP') await setDealStatus(tx, actorOf(req), deal, 'PICKUP_SCHEDULED', `Abholung am ${scheduledAt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
      await audit(tx, actorOf(req), { event: 'PICKUP_UPDATED', entityType: 'deal', entityId: deal.id, newValue: { scheduledAt } });
      return { ok: true };
    });
  });

  const confirm = (side: 'handed' | 'taken') => async (req: FastifyRequest) => {
    const input = parse(pickupConfirmSchema, req.body ?? {});
    return db.transaction(async (tx) => {
      const { deal, role } = await loadDeal(tx, req, did(req), true);
      if (side === 'handed' && role === 'buyer') throw new AppError(403, 'FORBIDDEN', 'Die Übergabe bestätigt der Verkäufer.');
      if (side === 'taken' && role === 'seller') throw new AppError(403, 'FORBIDDEN', 'Die Übernahme bestätigt der Käufer.');
      if (deal.status !== 'READY_FOR_PICKUP' && deal.status !== 'PICKUP_SCHEDULED' && deal.status !== 'PICKED_UP') {
        throw new AppError(409, 'INVALID_TRANSITION', 'Das Fahrzeug ist nicht zur Abholung freigegeben.');
      }
      const [p] = await tx.select().from(schema.pickups).where(eq(schema.pickups.dealId, deal.id)).for('update');
      if (!p) throw notFound('Abholung');
      if (side === 'handed') {
        if (role === 'seller' && (input.pickupCode ?? '').toUpperCase() !== p.pickupCode) {
          throw new AppError(400, 'INVALID_PICKUP_CODE', 'Der Abholcode ist ungültig.');
        }
        if (p.handedOverAt) return { ok: true, already: true };
        await tx.update(schema.pickups).set({ handedOverAt: new Date(), handedOverBy: getAuth(req).userId, updatedAt: new Date() }).where(eq(schema.pickups.dealId, deal.id));
      } else {
        if (p.takenOverAt) return { ok: true, already: true };
        await tx.update(schema.pickups).set({ takenOverAt: new Date(), takenOverBy: getAuth(req).userId, updatedAt: new Date() }).where(eq(schema.pickups.dealId, deal.id));
      }
      await audit(tx, actorOf(req), { event: 'PICKUP_CONFIRMED', entityType: 'deal', entityId: deal.id, newValue: { side: side === 'handed' ? 'Fahrzeug übergeben' : 'Fahrzeug übernommen', at: new Date().toISOString() } });
      const [after] = await tx.select().from(schema.pickups).where(eq(schema.pickups.dealId, deal.id));
      if (after?.handedOverAt && after.takenOverAt && deal.status !== 'PICKED_UP') {
        await setDealStatus(tx, actorOf(req), deal, 'PICKED_UP', 'Übergabe und Übernahme bestätigt');
      }
      return { ok: true };
    });
  };
  app.post('/deals/:id/pickup/handed-over', { preHandler: requireAuth }, confirm('handed'));
  app.post('/deals/:id/pickup/taken-over', { preHandler: requireAuth }, confirm('taken'));

  // ---------- Reklamationen ----------
  app.post('/deals/:id/complaints', { preHandler: requireAuth }, async (req, reply) => {
    const input = parse(complaintSchema, req.body);
    const created = await db.transaction(async (tx) => {
      const { deal, role } = await loadDeal(tx, req, did(req), true);
      if (role === 'seller') throw new AppError(403, 'FORBIDDEN', 'Reklamationen eröffnet der Käufer oder die Plattform.');
      if (deal.status === 'CANCELLED' || deal.status === 'COMPLETED') throw new AppError(409, 'DEAL_CLOSED', 'Für abgeschlossene Vorgänge kann keine Reklamation eröffnet werden.');
      const [c] = await tx.insert(schema.complaints).values({ dealId: deal.id, openedBy: getAuth(req).userId, reason: input.reason, description: input.description }).returning();
      if (deal.status !== 'DISPUTED') {
        await setDealStatus(tx, actorOf(req), deal, 'DISPUTED', `Reklamation: ${input.reason}`, { statusBeforeDispute: deal.status });
      }
      await audit(tx, actorOf(req), { event: 'COMPLAINT_OPENED', entityType: 'deal', entityId: deal.id, newValue: { complaintId: c!.id, ...input } });
      await notifyAdmins(tx, { type: 'COMPLAINT_UPDATE', title: `Reklamation zu ${deal.dealNumber}`, body: `${input.reason}: ${input.description.slice(0, 200)}`, link: '/admin/reklamationen' });
      return c!;
    });
    return reply.status(201).send({ id: created.id });
  });

  app.get('/admin/complaints', { preHandler: requireAdmin }, async () =>
    db
      .select({
        id: schema.complaints.id,
        reason: schema.complaints.reason,
        description: schema.complaints.description,
        status: schema.complaints.status,
        resolution: schema.complaints.resolution,
        createdAt: schema.complaints.createdAt,
        resolvedAt: schema.complaints.resolvedAt,
        dealId: schema.deals.id,
        dealNumber: schema.deals.dealNumber,
        dealStatus: schema.deals.status,
        buyer: sql<string>`${schema.deals.buyerSnapshot}->>'name'`,
        seller: sql<string>`${schema.deals.sellerSnapshot}->>'name'`,
      })
      .from(schema.complaints)
      .innerJoin(schema.deals, eq(schema.deals.id, schema.complaints.dealId))
      .orderBy(desc(schema.complaints.createdAt)),
  );

  app.post('/admin/complaints/:id/resolve', { preHandler: requireAdmin }, async (req) => {
    const id = did(req);
    const input = parse(resolveComplaintSchema, req.body);
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.complaints).where(eq(schema.complaints.id, id)).for('update');
      if (!c) throw notFound('Reklamation');
      const final = input.status === 'RESOLVED' || input.status === 'REJECTED';
      await tx
        .update(schema.complaints)
        .set({ status: input.status, resolution: input.resolution, resolvedBy: final ? getAuth(req).userId : null, resolvedAt: final ? new Date() : null, updatedAt: new Date() })
        .where(eq(schema.complaints.id, id));
      await audit(tx, actorOf(req), { event: 'COMPLAINT_UPDATED', entityType: 'deal', entityId: c.dealId, oldValue: { status: c.status }, newValue: input });
      const deal = await lockDeal(tx, c.dealId);
      if (final && deal.status === 'DISPUTED') {
        const openOthers = await tx
          .select({ id: schema.complaints.id })
          .from(schema.complaints)
          .where(and(eq(schema.complaints.dealId, c.dealId), or(eq(schema.complaints.status, 'OPEN'), eq(schema.complaints.status, 'IN_REVIEW')), sql`${schema.complaints.id} <> ${id}`));
        if (openOthers.length === 0) {
          const back = input.dealStatus ?? deal.statusBeforeDispute ?? 'PAYMENT_PENDING';
          await setDealStatus(tx, actorOf(req), deal, back, `Reklamation ${input.status === 'RESOLVED' ? 'gelöst' : 'abgelehnt'}${input.resolution ? `: ${input.resolution}` : ''}`, {
            ...(back === 'CANCELLED' ? { cancelledReason: input.resolution ?? 'Reklamation' } : {}),
          });
          if (back === 'CANCELLED') {
            await tx.update(schema.vehicles).set({ status: 'UNSOLD', updatedAt: new Date() }).where(and(eq(schema.vehicles.id, deal.vehicleId), eq(schema.vehicles.status, 'SOLD')));
            await enqueue(tx, 'pdf.deal', { dealId: deal.id, reason: 'Stornierung nach Reklamation', requestedBy: getAuth(req).userId });
          }
        }
      }
      await notifyCompany(tx, deal.buyerCompanyId, {
        type: 'COMPLAINT_UPDATE',
        title: `Reklamation ${deal.dealNumber}: ${input.status === 'RESOLVED' ? 'gelöst' : input.status === 'REJECTED' ? 'abgelehnt' : 'in Bearbeitung'}`,
        body: input.resolution ?? 'Der Status Ihrer Reklamation wurde aktualisiert.',
        link: `/haendler/kaeufe/${deal.id}`,
      });
      return { ok: true };
    });
  });
}
