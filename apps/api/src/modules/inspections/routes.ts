import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  approxCoordinatesForZip,
  assertTransition,
  assignInspectionSchema,
  cancelSchema,
  createInspectionRequestSchema,
  formatDateTimeDe,
  inspectorStatusSchema,
  scheduleInspectionSchema,
  shortName,
  uuidSchema,
  type InspectionStatus,
} from '@sd/shared';
import { db, schema, type DbOrTx } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, companyOf, getAuth, isAdmin, requireAdmin, requireAuth, requireCompany, requireInspectorOrAdmin } from '../../core/auth';
import { audit } from '../../core/audit';
import { publish, channels } from '../../core/realtime';
import { notifyAdmins, notifyCompany, notifyUsers } from '../notifications/service';

type RequestRow = typeof schema.inspectionRequests.$inferSelect;
const OPEN_STATUSES: InspectionStatus[] = ['NEW', 'PLANNED', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'];

const inspector = schema.users;

/** Basisselektion inkl. aktiver Zuweisung; Sichtbarkeit wird pro Rolle eingeschränkt. */
function baseSelect(tx: DbOrTx) {
  return tx
    .select({
      r: schema.inspectionRequests,
      companyName: schema.companies.name,
      a: schema.inspectionAssignments,
      inspectorFirstName: inspector.firstName,
      inspectorLastName: inspector.lastName,
      inspectorPhone: inspector.phone,
      vehiclesRecorded: sql<number>`(select count(*)::int from vehicles v where v.inspection_request_id = ${schema.inspectionRequests.id})`,
      vehiclesWaitingReview: sql<number>`(select count(*)::int from vehicles v where v.inspection_request_id = ${schema.inspectionRequests.id} and v.status = 'WAITING_REVIEW')`,
    })
    .from(schema.inspectionRequests)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.inspectionRequests.companyId))
    .leftJoin(
      schema.inspectionAssignments,
      and(eq(schema.inspectionAssignments.requestId, schema.inspectionRequests.id), eq(schema.inspectionAssignments.active, true)),
    )
    .leftJoin(inspector, eq(inspector.id, schema.inspectionAssignments.inspectorUserId));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseSelect>['execute']>>[number];

/** Mandanten-/Rollenfilter – wird in JEDE Abfrage eingebaut (nicht nachträglich gefiltert). */
function visibilityCondition(req: FastifyRequest): SQL | undefined {
  const u = getAuth(req);
  if (isAdmin(u)) return undefined;
  if (u.platformRole === 'INSPECTOR') return eq(schema.inspectionAssignments.inspectorUserId, u.userId);
  if (u.company?.type === 'DEALERSHIP' && u.company.status === 'APPROVED') return eq(schema.inspectionRequests.companyId, u.company.id);
  return sql`false`;
}

function present(req: FastifyRequest, row: Row) {
  const u = getAuth(req);
  const r = row.r;
  const admin = isAdmin(u);
  const assignment = row.a
    ? {
        inspectorUserId: admin || u.platformRole === 'INSPECTOR' ? row.a.inspectorUserId : undefined,
        inspectorName:
          admin || u.platformRole === 'INSPECTOR'
            ? `${row.inspectorFirstName} ${row.inspectorLastName}`
            : shortName(row.inspectorFirstName ?? '', row.inspectorLastName ?? ''),
        inspectorPhone: admin ? row.inspectorPhone : undefined,
        scheduledAt: row.a.scheduledAt,
        enRouteAt: row.a.enRouteAt,
        arrivedAt: row.a.arrivedAt,
        startedAt: row.a.startedAt,
        completedAt: row.a.completedAt,
      }
    : null;
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    company: { id: r.companyId, name: row.companyName },
    vehicleCount: r.vehicleCount,
    vehiclesRecorded: row.vehiclesRecorded,
    vehiclesWaitingReview: row.vehiclesWaitingReview,
    location: { street: r.locationStreet, zip: r.locationZip, city: r.locationCity },
    lat: r.lat,
    lng: r.lng,
    requestedDate: r.requestedDate,
    earliestTime: r.earliestTime,
    latestTime: r.latestTime,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    notes: r.notes,
    vehiclesDrivable: r.vehiclesDrivable,
    keysAvailable: r.keysAvailable,
    papersAvailable: r.papersAvailable,
    scheduledAt: r.scheduledAt,
    cancelledReason: r.cancelledReason,
    assignment,
    statusText: statusText(r, assignment?.inspectorName ?? null),
    createdAt: r.createdAt,
  };
}

/** Statustext für das Autohaus (Spec §5). */
function statusText(r: RequestRow, inspectorName: string | null): string {
  switch (r.status) {
    case 'NEW':
      return 'Anfrage eingegangen – Termin wird geplant.';
    case 'PLANNED':
      return `Aufnahme geplant für ${formatDateTimeDe(r.scheduledAt)} – Mitarbeiter wird zugewiesen.`;
    case 'ASSIGNED':
      return `Aufnahme geplant für ${formatDateTimeDe(r.scheduledAt)} – Mitarbeiter ${inspectorName ?? ''}`.trim();
    case 'EN_ROUTE':
      return `Mitarbeiter ${inspectorName ?? ''} ist unterwegs.`;
    case 'ON_SITE':
      return `Mitarbeiter ${inspectorName ?? ''} ist vor Ort.`;
    case 'IN_PROGRESS':
      return 'Fahrzeugaufnahme läuft.';
    case 'COMPLETED':
      return 'Aufnahme abgeschlossen – Fahrzeuge werden geprüft.';
    case 'CANCELLED':
      return `Storniert${r.cancelledReason ? `: ${r.cancelledReason}` : ''}`;
  }
}

async function loadVisible(tx: DbOrTx, req: FastifyRequest, id: string): Promise<Row> {
  const rows = await baseSelect(tx)
    .where(and(eq(schema.inspectionRequests.id, id), visibilityCondition(req)))
    .limit(1);
  if (!rows[0]) throw notFound('Aufnahmeauftrag');
  return rows[0];
}

async function lockRequest(tx: DbOrTx, id: string): Promise<RequestRow> {
  const [r] = await tx.select().from(schema.inspectionRequests).where(eq(schema.inspectionRequests.id, id)).for('update');
  if (!r) throw notFound('Aufnahmeauftrag');
  return r;
}

async function setStatus(tx: DbOrTx, req: FastifyRequest, r: RequestRow, to: InspectionStatus, extra: Partial<RequestRow> = {}): Promise<void> {
  assertTransition('inspection', r.status, to);
  await tx
    .update(schema.inspectionRequests)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(eq(schema.inspectionRequests.id, r.id));
  await audit(tx, actorOf(req), {
    event: 'INSPECTION_STATUS_CHANGED',
    entityType: 'inspection_request',
    entityId: r.id,
    oldValue: { status: r.status },
    newValue: { status: to, ...extra },
  });
  await publish(tx, channels.admin(), 'inspection.updated', { id: r.id, status: to });
}

/** Berliner Kalendertag als SQL-Ausdruck für "Heute/Morgen/Woche". */
const effectiveDate = sql`coalesce((${schema.inspectionRequests.scheduledAt} at time zone 'Europe/Berlin')::date, ${schema.inspectionRequests.requestedDate})`;
const berlinToday = sql`(now() at time zone 'Europe/Berlin')::date`;

export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Autohaus: Anfrage anlegen ----------
  app.post('/inspection-requests', { preHandler: requireCompany({ type: 'DEALERSHIP' }) }, async (req, reply) => {
    const c = companyOf(req);
    const input = parse(createInspectionRequestSchema, req.body);
    // Kalendertag in Europe/Berlin (nicht UTC), sonst gilt kurz nach Mitternacht "heute" als Vergangenheit.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    if (input.requestedDate < today) throw new AppError(400, 'DATE_IN_PAST', 'Das Wunschdatum darf nicht in der Vergangenheit liegen.');
    const coords = approxCoordinatesForZip(input.locationZip);
    const created = await db.transaction(async (tx) => {
      const [{ n }] = (await tx.execute<{ n: string }>(sql`select nextval('inspection_number_seq')::text as n`)).rows as [{ n: string }];
      const [r] = await tx
        .insert(schema.inspectionRequests)
        .values({
          number: `AU-${new Date().getFullYear()}-${n.padStart(5, '0')}`,
          companyId: c.id,
          createdBy: getAuth(req).userId,
          ...input,
          status: 'NEW',
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        })
        .returning();
      await audit(tx, actorOf(req), { event: 'INSPECTION_CREATED', entityType: 'inspection_request', entityId: r!.id, newValue: input });
      await notifyAdmins(tx, {
        type: 'INSPECTION_REQUEST_CREATED',
        title: `Neue Aufnahmeanfrage: ${c.name}`,
        body: `${input.vehicleCount} Fahrzeug(e) in ${input.locationZip} ${input.locationCity}, Wunschtermin ${input.requestedDate.split('-').reverse().join('.')} ${input.earliestTime}–${input.latestTime} Uhr.`,
        link: `/admin/disposition?request=${r!.id}`,
      });
      await publish(tx, channels.admin(), 'inspection.created', { id: r!.id });
      return r!;
    });
    return reply.status(201).send({ id: created.id, number: created.number, status: created.status, statusText: statusText(created, null) });
  });

  // ---------- Liste (rollenabhängig) ----------
  app.get('/inspection-requests', { preHandler: requireAuth }, async (req) => {
    const q = parse(
      z.object({
        view: z.enum(['open', 'today', 'tomorrow', 'week', 'unplanned', 'done', 'cancelled', 'all', 'range']).default('open'),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      req.query,
    );
    const where: (SQL | undefined)[] = [visibilityCondition(req)];
    switch (q.view) {
      case 'open':
        where.push(inArray(schema.inspectionRequests.status, OPEN_STATUSES));
        break;
      case 'today':
        where.push(sql`${effectiveDate} = ${berlinToday}`, notInArray(schema.inspectionRequests.status, ['CANCELLED']));
        break;
      case 'tomorrow':
        where.push(sql`${effectiveDate} = ${berlinToday} + 1`, notInArray(schema.inspectionRequests.status, ['CANCELLED']));
        break;
      case 'week':
        where.push(sql`${effectiveDate} between ${berlinToday} and ${berlinToday} + 6`, notInArray(schema.inspectionRequests.status, ['CANCELLED']));
        break;
      case 'unplanned':
        where.push(eq(schema.inspectionRequests.status, 'NEW'));
        break;
      case 'done':
        where.push(eq(schema.inspectionRequests.status, 'COMPLETED'));
        break;
      case 'cancelled':
        where.push(eq(schema.inspectionRequests.status, 'CANCELLED'));
        break;
      case 'range':
        if (!q.from || !q.to) throw new AppError(400, 'RANGE_REQUIRED', 'Für den Kalender sind from und to erforderlich.');
        where.push(sql`${effectiveDate} between ${q.from}::date and ${q.to}::date`);
        break;
      case 'all':
        break;
    }
    const rows = await baseSelect(db)
      .where(and(...where))
      .orderBy(
        q.view === 'done' || q.view === 'cancelled' || q.view === 'all' ? desc(schema.inspectionRequests.createdAt) : asc(effectiveDate),
        asc(sql`coalesce(${schema.inspectionRequests.scheduledAt}, ${schema.inspectionRequests.createdAt})`),
      )
      .limit(500);
    return rows.map((r) => present(req, r));
  });

  app.get('/inspection-requests/:id', { preHandler: requireAuth }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const row = await loadVisible(db, req, id);
    const vehicles = await db
      .select({
        id: schema.vehicles.id,
        internalNumber: schema.vehicles.internalNumber,
        vin: schema.vehicles.vin,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        status: schema.vehicles.status,
        completenessPct: schema.vehicles.completenessPct,
        createdAt: schema.vehicles.createdAt,
      })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.inspectionRequestId, id))
      .orderBy(asc(schema.vehicles.createdAt));
    return { ...present(req, row), vehicles };
  });

  // ---------- Stornierung ----------
  app.post('/inspection-requests/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(cancelSchema, req.body);
    const u = getAuth(req);
    return db.transaction(async (tx) => {
      const visible = await loadVisible(tx, req, id);
      if (u.platformRole === 'INSPECTOR') throw new AppError(403, 'FORBIDDEN', 'Außendienst kann Aufträge nicht stornieren.');
      const r = await lockRequest(tx, id);
      if (!isAdmin(u) && !['NEW', 'PLANNED'].includes(r.status)) {
        throw new AppError(409, 'CANNOT_CANCEL', 'Bereits disponierte Aufträge können nur vom Plattformbetreiber storniert werden.');
      }
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from vehicles where inspection_request_id = ${id}`)).rows as [{ n: number }];
      if (n > 0) throw new AppError(409, 'HAS_VEHICLES', 'Auftrag enthält bereits aufgenommene Fahrzeuge und kann nicht storniert werden.');
      await setStatus(tx, req, r, 'CANCELLED', { cancelledReason: input.reason });
      await tx.update(schema.inspectionAssignments).set({ active: false }).where(eq(schema.inspectionAssignments.requestId, id));
      const inspectorId = visible.a?.inspectorUserId;
      if (inspectorId) {
        await notifyUsers(tx, [inspectorId], {
          type: 'INSPECTION_CANCELLED',
          title: `Termin storniert: ${visible.companyName}`,
          body: `Der Aufnahmetermin ${r.number} wurde storniert. Grund: ${input.reason}`,
          link: '/aussendienst',
        });
      }
      if (isAdmin(u)) {
        await notifyCompany(tx, r.companyId, {
          type: 'INSPECTION_CANCELLED',
          title: 'Aufnahmetermin storniert',
          body: `Ihr Aufnahmeauftrag ${r.number} wurde storniert. Grund: ${input.reason}`,
          link: '/autohaus/termine',
        });
      } else {
        await notifyAdmins(tx, {
          type: 'INSPECTION_CANCELLED',
          title: `Aufnahmeanfrage storniert: ${visible.companyName}`,
          body: `${r.number}: ${input.reason}`,
          link: '/admin/disposition',
          email: false,
        });
      }
      return { status: 'CANCELLED' };
    });
  });

  // ---------- Admin: Disposition ----------
  app.post('/admin/inspection-requests/:id/schedule', { preHandler: requireAdmin }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(scheduleInspectionSchema, req.body);
    return db.transaction(async (tx) => {
      const r = await lockRequest(tx, id);
      const scheduledAt = new Date(input.scheduledAt);
      if (r.status === 'NEW') {
        await setStatus(tx, req, r, 'PLANNED', { scheduledAt });
      } else if (['PLANNED', 'ASSIGNED'].includes(r.status)) {
        await tx.update(schema.inspectionRequests).set({ scheduledAt, updatedAt: new Date() }).where(eq(schema.inspectionRequests.id, id));
        await tx
          .update(schema.inspectionAssignments)
          .set({ scheduledAt })
          .where(and(eq(schema.inspectionAssignments.requestId, id), eq(schema.inspectionAssignments.active, true)));
        await publish(tx, channels.admin(), 'inspection.updated', { id, status: r.status });
      } else {
        throw new AppError(409, 'INVALID_TRANSITION', 'Termin kann in diesem Status nicht mehr geändert werden.');
      }
      await audit(tx, actorOf(req), {
        event: 'INSPECTION_SCHEDULED',
        entityType: 'inspection_request',
        entityId: id,
        oldValue: { scheduledAt: r.scheduledAt },
        newValue: { scheduledAt },
      });
      await notifyCompany(tx, r.companyId, {
        type: 'INSPECTION_SCHEDULED',
        title: 'Aufnahmetermin geplant',
        body: `Aufnahme geplant für ${formatDateTimeDe(scheduledAt)} (${r.number}).`,
        link: '/autohaus/termine',
      });
      return { ok: true };
    });
  });

  app.post('/admin/inspection-requests/:id/assign', { preHandler: requireAdmin }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(assignInspectionSchema, req.body);
    return db.transaction(async (tx) => {
      const r = await lockRequest(tx, id);
      if (!['NEW', 'PLANNED', 'ASSIGNED'].includes(r.status)) {
        throw new AppError(409, 'INVALID_TRANSITION', 'Mitarbeiter kann nur vor Beginn der Aufnahme (um)disponiert werden.');
      }
      const [insp] = await tx
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, input.inspectorUserId), eq(schema.users.platformRole, 'INSPECTOR'), eq(schema.users.isActive, true)));
      if (!insp) throw new AppError(400, 'INVALID_INSPECTOR', 'Unbekannter oder inaktiver Außendienstmitarbeiter.');
      const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : r.scheduledAt;
      if (!scheduledAt) throw new AppError(400, 'SCHEDULE_REQUIRED', 'Bitte zuerst einen Termin festlegen.');

      const [previous] = await tx
        .select()
        .from(schema.inspectionAssignments)
        .where(and(eq(schema.inspectionAssignments.requestId, id), eq(schema.inspectionAssignments.active, true)));
      if (previous) {
        await tx.update(schema.inspectionAssignments).set({ active: false }).where(eq(schema.inspectionAssignments.id, previous.id));
      }
      await tx.insert(schema.inspectionAssignments).values({
        requestId: id,
        inspectorUserId: insp.id,
        assignedBy: getAuth(req).userId,
        scheduledAt,
        note: input.note,
      });
      if (r.status !== 'ASSIGNED') await setStatus(tx, req, r, 'ASSIGNED', { scheduledAt });
      else await tx.update(schema.inspectionRequests).set({ scheduledAt, updatedAt: new Date() }).where(eq(schema.inspectionRequests.id, id));
      await audit(tx, actorOf(req), {
        event: 'INSPECTION_ASSIGNED',
        entityType: 'inspection_request',
        entityId: id,
        oldValue: { inspectorUserId: previous?.inspectorUserId ?? null, scheduledAt: r.scheduledAt },
        newValue: { inspectorUserId: insp.id, scheduledAt },
      });
      const [company] = await tx.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, r.companyId));
      await notifyUsers(tx, [insp.id], {
        type: 'INSPECTOR_ASSIGNED',
        title: `Neuer Aufnahmetermin: ${company?.name ?? ''}`,
        body: `${formatDateTimeDe(scheduledAt)} – ${r.locationStreet}, ${r.locationZip} ${r.locationCity} – ${r.vehicleCount} Fahrzeug(e).`,
        link: `/aussendienst/auftrag/${id}`,
      });
      if (previous && previous.inspectorUserId !== insp.id) {
        await notifyUsers(tx, [previous.inspectorUserId], {
          type: 'INSPECTION_CANCELLED',
          title: `Termin neu disponiert: ${company?.name ?? ''}`,
          body: `Der Termin ${r.number} wurde einem anderen Mitarbeiter zugewiesen.`,
          link: '/aussendienst',
        });
      }
      await notifyCompany(tx, r.companyId, {
        type: 'INSPECTOR_ASSIGNED',
        title: 'Aufnahmetermin bestätigt',
        body: `Aufnahme geplant für ${formatDateTimeDe(scheduledAt)} – Mitarbeiter ${shortName(insp.firstName, insp.lastName)}.`,
        link: '/autohaus/termine',
      });
      return { ok: true };
    });
  });

  app.post('/admin/inspection-requests/:id/unassign', { preHandler: requireAdmin }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    return db.transaction(async (tx) => {
      const r = await lockRequest(tx, id);
      if (r.status !== 'ASSIGNED') throw new AppError(409, 'INVALID_TRANSITION', 'Nur zugewiesene, noch nicht begonnene Aufträge können entzogen werden.');
      const [a] = await tx
        .update(schema.inspectionAssignments)
        .set({ active: false })
        .where(and(eq(schema.inspectionAssignments.requestId, id), eq(schema.inspectionAssignments.active, true)))
        .returning();
      await setStatus(tx, req, r, 'PLANNED');
      if (a) {
        await notifyUsers(tx, [a.inspectorUserId], {
          type: 'INSPECTION_CANCELLED',
          title: 'Termin entzogen',
          body: `Der Termin ${r.number} wurde Ihnen entzogen.`,
          link: '/aussendienst',
        });
      }
      return { ok: true };
    });
  });

  // ---------- Außendienst: Statusmeldungen ----------
  app.post('/inspector/requests/:id/status', { preHandler: requireInspectorOrAdmin }, async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(inspectorStatusSchema, req.body);
    return db.transaction(async (tx) => {
      const visible = await loadVisible(tx, req, id);
      if (!visible.a) throw new AppError(409, 'NOT_ASSIGNED', 'Auftrag ist keinem Mitarbeiter zugewiesen.');
      const r = await lockRequest(tx, id);
      const now = new Date();
      const assignmentPatch: Partial<typeof schema.inspectionAssignments.$inferInsert> = {};
      if (input.status === 'EN_ROUTE') assignmentPatch.enRouteAt = now;
      if (input.status === 'ON_SITE') assignmentPatch.arrivedAt = now;
      if (input.status === 'IN_PROGRESS') assignmentPatch.startedAt = now;
      if (input.status === 'COMPLETED') {
        const vehicles = await tx
          .select({ id: schema.vehicles.id, status: schema.vehicles.status, internalNumber: schema.vehicles.internalNumber })
          .from(schema.vehicles)
          .where(eq(schema.vehicles.inspectionRequestId, id));
        if (vehicles.length === 0) throw new AppError(409, 'NO_VEHICLES', 'Es wurde noch kein Fahrzeug aufgenommen.');
        const open = vehicles.filter((v) => v.status === 'DRAFT' || v.status === 'INSPECTION_IN_PROGRESS' || v.status === 'REQUIRES_CORRECTION');
        if (open.length) {
          throw new AppError(409, 'VEHICLES_OPEN', 'Nicht alle Fahrzeugaufnahmen sind abgeschlossen.', { open: open.map((v) => v.internalNumber) });
        }
        assignmentPatch.completedAt = now;
      }
      // "Angekommen" ist auch ohne vorheriges "unterwegs" zulässig.
      await setStatus(tx, req, r, input.status);
      await tx.update(schema.inspectionAssignments).set(assignmentPatch).where(eq(schema.inspectionAssignments.id, visible.a.id));
      if (input.status === 'COMPLETED') {
        await notifyCompany(tx, r.companyId, {
          type: 'INSPECTION_SCHEDULED',
          title: 'Fahrzeugaufnahme abgeschlossen',
          body: `Die Aufnahme ${r.number} ist abgeschlossen. Die Fahrzeuge werden jetzt geprüft.`,
          link: '/autohaus/fahrzeuge',
          email: false,
        });
      }
      return { status: input.status };
    });
  });

  void gte;
  void lt;
}
