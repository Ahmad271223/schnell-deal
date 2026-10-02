import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CATALOG_STATUSES, catalogSchema, catalogVehiclesSchema, dealerGroupMembersSchema, dealerGroupSchema, uuidSchema } from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, getAuth, requireAdmin } from '../../core/auth';
import { audit } from '../../core/audit';

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  // ---------- Händlergruppen ----------
  app.get('/admin/dealer-groups', async () =>
    db
      .select({
        id: schema.dealerGroups.id,
        name: schema.dealerGroups.name,
        description: schema.dealerGroups.description,
        memberCount: sql<number>`(select count(*)::int from dealer_group_members m where m.group_id = ${schema.dealerGroups.id})`,
        members: sql<string[]>`coalesce((select array_agg(m.company_id::text) from dealer_group_members m where m.group_id = ${schema.dealerGroups.id}), '{}')`,
      })
      .from(schema.dealerGroups)
      .orderBy(asc(schema.dealerGroups.name)),
  );

  app.post('/admin/dealer-groups', async (req, reply) => {
    const input = parse(dealerGroupSchema, req.body);
    const [g] = await db.transaction(async (tx) => {
      const rows = await tx.insert(schema.dealerGroups).values(input).returning();
      await audit(tx, actorOf(req), { event: 'DEALER_GROUP_CHANGED', entityType: 'dealer_group', entityId: rows[0]!.id, newValue: input });
      return rows;
    });
    return reply.status(201).send(g);
  });

  app.patch('/admin/dealer-groups/:id', async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(dealerGroupSchema.partial(), req.body);
    return db.transaction(async (tx) => {
      const [g] = await tx.update(schema.dealerGroups).set({ ...input, updatedAt: new Date() }).where(eq(schema.dealerGroups.id, id)).returning();
      if (!g) throw notFound('Händlergruppe');
      await audit(tx, actorOf(req), { event: 'DEALER_GROUP_CHANGED', entityType: 'dealer_group', entityId: id, newValue: input });
      return g;
    });
  });

  app.put('/admin/dealer-groups/:id/members', async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(dealerGroupMembersSchema, req.body);
    return db.transaction(async (tx) => {
      const [g] = await tx.select().from(schema.dealerGroups).where(eq(schema.dealerGroups.id, id)).for('update');
      if (!g) throw notFound('Händlergruppe');
      if (input.companyIds.length) {
        const companies = await tx
          .select({ id: schema.companies.id, type: schema.companies.type })
          .from(schema.companies)
          .where(inArray(schema.companies.id, input.companyIds));
        if (companies.length !== new Set(input.companyIds).size || companies.some((c) => c.type !== 'DEALER')) {
          throw new AppError(400, 'INVALID_MEMBERS', 'Gruppen dürfen nur Händlerfirmen enthalten.');
        }
      }
      const before = await tx.select({ c: schema.dealerGroupMembers.companyId }).from(schema.dealerGroupMembers).where(eq(schema.dealerGroupMembers.groupId, id));
      await tx.delete(schema.dealerGroupMembers).where(eq(schema.dealerGroupMembers.groupId, id));
      if (input.companyIds.length) {
        await tx.insert(schema.dealerGroupMembers).values([...new Set(input.companyIds)].map((c) => ({ groupId: id, companyId: c })));
      }
      await audit(tx, actorOf(req), {
        event: 'DEALER_GROUP_CHANGED',
        entityType: 'dealer_group',
        entityId: id,
        oldValue: { members: before.map((b) => b.c) },
        newValue: { members: input.companyIds },
      });
      return { ok: true };
    });
  });

  // ---------- Kataloge ----------
  app.get('/admin/catalogs', async () =>
    db
      .select({
        id: schema.catalogs.id,
        name: schema.catalogs.name,
        description: schema.catalogs.description,
        startsAt: schema.catalogs.startsAt,
        endsAt: schema.catalogs.endsAt,
        status: schema.catalogs.status,
        dealerGroupId: schema.catalogs.dealerGroupId,
        dealerGroupName: schema.dealerGroups.name,
        vehicleCount: sql<number>`(select count(*)::int from catalog_vehicles cv where cv.catalog_id = ${schema.catalogs.id})`,
      })
      .from(schema.catalogs)
      .leftJoin(schema.dealerGroups, eq(schema.dealerGroups.id, schema.catalogs.dealerGroupId))
      .orderBy(desc(schema.catalogs.createdAt)),
  );

  app.get('/admin/catalogs/:id', async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const [c] = await db.select().from(schema.catalogs).where(eq(schema.catalogs.id, id));
    if (!c) throw notFound('Katalog');
    const vehicles = await db
      .select({
        vehicleId: schema.vehicles.id,
        sort: schema.catalogVehicles.sort,
        internalNumber: schema.vehicles.internalNumber,
        make: schema.vehicles.make,
        model: schema.vehicles.model,
        status: schema.vehicles.status,
        auction: sql<{ id: string; status: string; startsAt: string; endsAt: string; currentBid: number | null } | null>`(
          select json_build_object('id', a.id, 'number', a.number, 'status', a.status, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'currentBid', a.current_bid, 'outcome', a.outcome)
          from auctions a where a.vehicle_id = ${schema.vehicles.id} and a.catalog_id = ${id} order by a.created_at desc limit 1)`,
      })
      .from(schema.catalogVehicles)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.catalogVehicles.vehicleId))
      .where(eq(schema.catalogVehicles.catalogId, id))
      .orderBy(asc(schema.catalogVehicles.sort));
    return { ...c, vehicles };
  });

  app.post('/admin/catalogs', async (req, reply) => {
    const input = parse(catalogSchema, req.body);
    const c = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.catalogs)
        .values({
          name: input.name,
          description: input.description,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          dealerGroupId: input.dealerGroupId ?? null,
          createdBy: getAuth(req).userId,
        })
        .returning();
      await audit(tx, actorOf(req), { event: 'CATALOG_CHANGED', entityType: 'catalog', entityId: row!.id, newValue: input });
      return row!;
    });
    return reply.status(201).send(c);
  });

  app.patch('/admin/catalogs/:id', async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(catalogSchema.partial(), req.body);
    return db.transaction(async (tx) => {
      const changes: Partial<typeof schema.catalogs.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) changes.name = input.name;
      if (input.description !== undefined) changes.description = input.description;
      if (input.startsAt !== undefined) changes.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined) changes.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.dealerGroupId !== undefined) changes.dealerGroupId = input.dealerGroupId;
      const [c] = await tx.update(schema.catalogs).set(changes).where(eq(schema.catalogs.id, id)).returning();
      if (!c) throw notFound('Katalog');
      await audit(tx, actorOf(req), { event: 'CATALOG_CHANGED', entityType: 'catalog', entityId: id, newValue: input });
      return c;
    });
  });

  app.post('/admin/catalogs/:id/status', async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const { status } = parse(z.object({ status: z.enum(CATALOG_STATUSES) }), req.body);
    return db.transaction(async (tx) => {
      const [c] = await tx.update(schema.catalogs).set({ status, updatedAt: new Date() }).where(eq(schema.catalogs.id, id)).returning();
      if (!c) throw notFound('Katalog');
      await audit(tx, actorOf(req), { event: 'CATALOG_CHANGED', entityType: 'catalog', entityId: id, newValue: { status } });
      return c;
    });
  });

  /** Fahrzeuge und Sortierung festlegen. Reihenfolge des Arrays = Sortierung. */
  app.put('/admin/catalogs/:id/vehicles', async (req) => {
    const id = parse(uuidSchema, (req.params as { id: string }).id);
    const input = parse(catalogVehiclesSchema, req.body);
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.catalogs).where(eq(schema.catalogs.id, id)).for('update');
      if (!c) throw notFound('Katalog');
      if (input.vehicleIds.length) {
        const vs = await tx.select({ id: schema.vehicles.id, status: schema.vehicles.status }).from(schema.vehicles).where(inArray(schema.vehicles.id, input.vehicleIds));
        if (vs.length !== new Set(input.vehicleIds).size) throw new AppError(400, 'INVALID_VEHICLES', 'Unbekannte Fahrzeuge.');
        const notReady = vs.filter((v) => !['APPROVED', 'SCHEDULED', 'IN_AUCTION', 'UNSOLD', 'SOLD'].includes(v.status));
        if (notReady.length) throw new AppError(409, 'VEHICLE_NOT_READY', 'Nur geprüfte Fahrzeuge können in einen Katalog aufgenommen werden.');
      }
      await tx.delete(schema.catalogVehicles).where(eq(schema.catalogVehicles.catalogId, id));
      if (input.vehicleIds.length) {
        await tx.insert(schema.catalogVehicles).values(input.vehicleIds.map((v, i) => ({ catalogId: id, vehicleId: v, sort: i })));
      }
      await audit(tx, actorOf(req), { event: 'CATALOG_CHANGED', entityType: 'catalog', entityId: id, newValue: { vehicleIds: input.vehicleIds } });
      return { ok: true };
    });
  });
}
