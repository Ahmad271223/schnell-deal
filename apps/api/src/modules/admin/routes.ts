import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminCreateCompanySchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  AUDIT_EVENTS,
  assertTransition,
  biddingStatusSchema,
  COMPANY_STATUSES,
  COMPANY_TYPES,
  companyStatusActionSchema,
  createLegalDocumentSchema,
  PLATFORM_ROLES,
  settingsSchema,
  updateCompanySchema,
  uuidSchema,
  type CompanyStatus,
  approxCoordinatesForZip,
} from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, getAuth, hashPassword, requireAdmin, requireSuperadmin, revokeUserSessions } from '../../core/auth';
import { audit, diff } from '../../core/audit';
import { receiveFile } from '../../core/upload';
import { signedUrl, malwareScanMode } from '../../core/storage';
import { schedulerStatus } from '../auctions/scheduler';
import { config } from '../../config';
import { getSettings, saveSettings } from '../../core/settings';
import { retryJob } from '../../core/jobs';
import { deactivateMaxBids, getCompany, lockCompany, setCompanyStatus, storeCompanyDocument } from '../companies/service';
import { notifyCompany } from '../notifications/service';

const idParam = (p: unknown, key = 'id') => parse(uuidSchema, (p as Record<string, string>)[key]);

const ACTION_TARGET: Record<string, CompanyStatus> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  block: 'BLOCKED',
  unblock: 'APPROVED',
  request_documents: 'DOCUMENTS_MISSING',
  reopen: 'IN_REVIEW',
};

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  // ---------- Unternehmen ----------
  app.get('/admin/companies', async (req) => {
    const q = parse(
      z.object({
        type: z.enum(COMPANY_TYPES).optional(),
        status: z.enum(COMPANY_STATUSES).optional(),
        q: z.string().max(100).optional(),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.type) where.push(eq(schema.companies.type, q.type));
    if (q.status) where.push(eq(schema.companies.status, q.status));
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      where.push(or(ilike(schema.companies.name, like), ilike(schema.companies.city, like), ilike(schema.companies.contactEmail, like))!);
    }
    return db
      .select({
        id: schema.companies.id,
        type: schema.companies.type,
        name: schema.companies.name,
        legalForm: schema.companies.legalForm,
        zip: schema.companies.zip,
        city: schema.companies.city,
        status: schema.companies.status,
        contactEmail: schema.companies.contactEmail,
        contactPhone: schema.companies.contactPhone,
        createdAt: schema.companies.createdAt,
        biddingStatus: schema.dealerVerifications.biddingStatus,
        userCount: sql<number>`(select count(*)::int from company_users cu where cu.company_id = ${schema.companies.id})`,
        documentCount: sql<number>`(select count(*)::int from company_documents cd where cd.company_id = ${schema.companies.id})`,
      })
      .from(schema.companies)
      .leftJoin(schema.dealerVerifications, eq(schema.dealerVerifications.companyId, schema.companies.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.companies.createdAt))
      .limit(500);
  });

  app.get('/admin/companies/:id', async (req) => {
    const id = idParam(req.params);
    const company = await getCompany(db, id);
    const [documents, users, verification, groups] = await Promise.all([
      db
        .select({
          id: schema.companyDocuments.id,
          kind: schema.companyDocuments.kind,
          fileName: schema.companyDocuments.fileName,
          mime: schema.companyDocuments.mime,
          sizeBytes: schema.companyDocuments.sizeBytes,
          sha256: schema.companyDocuments.sha256,
          createdAt: schema.companyDocuments.createdAt,
        })
        .from(schema.companyDocuments)
        .where(eq(schema.companyDocuments.companyId, id))
        .orderBy(asc(schema.companyDocuments.createdAt)),
      db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          phone: schema.users.phone,
          isActive: schema.users.isActive,
          lastLoginAt: schema.users.lastLoginAt,
          companyRole: schema.companyUsers.companyRole,
          jobTitle: schema.companyUsers.jobTitle,
        })
        .from(schema.companyUsers)
        .innerJoin(schema.users, eq(schema.users.id, schema.companyUsers.userId))
        .where(eq(schema.companyUsers.companyId, id)),
      db.select().from(schema.dealerVerifications).where(eq(schema.dealerVerifications.companyId, id)),
      db
        .select({ id: schema.dealerGroups.id, name: schema.dealerGroups.name })
        .from(schema.dealerGroupMembers)
        .innerJoin(schema.dealerGroups, eq(schema.dealerGroups.id, schema.dealerGroupMembers.groupId))
        .where(eq(schema.dealerGroupMembers.companyId, id)),
    ]);
    return { ...company, documents, users, verification: verification[0] ?? null, groups };
  });

  app.post('/admin/companies', async (req, reply) => {
    const input = parse(adminCreateCompanySchema, req.body);
    const actor = actorOf(req);
    const created = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(schema.companies)
        .values({
          type: input.type,
          name: input.name,
          legalForm: input.legalForm,
          street: input.street,
          houseNumber: input.houseNumber,
          zip: input.zip,
          city: input.city,
          website: input.website,
          registerNumber: input.registerNumber,
          vatId: input.vatId,
          brands: input.brands,
          tradeType: input.tradeType,
          contactFirstName: input.contactFirstName,
          contactLastName: input.contactLastName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          lat: approxCoordinatesForZip(input.zip)?.lat ?? null,
          lng: approxCoordinatesForZip(input.zip)?.lng ?? null,
          status: input.approve ? 'APPROVED' : 'IN_REVIEW',
          reviewedBy: input.approve ? actor.userId : null,
          reviewedAt: input.approve ? new Date() : null,
        })
        .returning();
      if (input.type === 'DEALER') {
        await tx.insert(schema.dealerVerifications).values({
          companyId: company!.id,
          biddingStatus: input.approve ? 'CAN_BID' : 'VIEW_ONLY',
          reviewedBy: input.approve ? actor.userId : null,
        });
      }
      await audit(tx, actor, { event: 'COMPANY_CREATED', entityType: 'company', entityId: company!.id, newValue: input });
      return company!;
    });
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/admin/companies/:id', async (req) => {
    const id = idParam(req.params);
    const input = parse(updateCompanySchema, req.body);
    return db.transaction(async (tx) => {
      const company = await lockCompany(tx, id);
      const d = diff(company as unknown as Record<string, unknown>, input as Record<string, unknown>);
      await tx.update(schema.companies).set({ ...input, updatedAt: new Date() }).where(eq(schema.companies.id, id));
      await audit(tx, actorOf(req), { event: 'COMPANY_UPDATED', entityType: 'company', entityId: id, oldValue: d.old, newValue: d.new });
      return { ok: true };
    });
  });

  app.post('/admin/companies/:id/status', async (req) => {
    const id = idParam(req.params);
    const input = parse(companyStatusActionSchema, req.body);
    const target = ACTION_TARGET[input.action]!;
    if ((input.action === 'reject' || input.action === 'block' || input.action === 'request_documents') && !input.note) {
      throw new AppError(400, 'NOTE_REQUIRED', 'Bitte eine Begründung angeben.');
    }
    return db.transaction(async (tx) => {
      const company = await lockCompany(tx, id);
      await setCompanyStatus(tx, actorOf(req), company, target, input.note);
      return { status: target };
    });
  });

  app.post('/admin/companies/:id/bidding-status', async (req) => {
    const id = idParam(req.params);
    const input = parse(biddingStatusSchema, req.body);
    if (input.status === 'TEMP_BLOCKED' && !input.blockedUntil) {
      throw new AppError(400, 'BLOCKED_UNTIL_REQUIRED', 'Für eine temporäre Sperre ist ein Enddatum erforderlich.');
    }
    const actor = actorOf(req);
    return db.transaction(async (tx) => {
      const company = await lockCompany(tx, id);
      if (company.type !== 'DEALER') throw new AppError(400, 'NOT_A_DEALER', 'Bieterstatus gilt nur für Händler.');
      if (input.status === 'CAN_BID' && company.status !== 'APPROVED') {
        throw new AppError(409, 'COMPANY_NOT_APPROVED', 'Nur freigegebene Händler dürfen bieten.');
      }
      const [current] = await tx.select().from(schema.dealerVerifications).where(eq(schema.dealerVerifications.companyId, id));
      const from = current?.biddingStatus ?? 'VIEW_ONLY';
      if (from !== input.status) assertTransition('bidding', from, input.status);
      await tx
        .insert(schema.dealerVerifications)
        .values({
          companyId: id,
          biddingStatus: input.status,
          blockedUntil: input.blockedUntil ? new Date(input.blockedUntil) : null,
          note: input.note,
          reviewedBy: actor.userId,
          reviewedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.dealerVerifications.companyId,
          set: {
            biddingStatus: input.status,
            blockedUntil: input.blockedUntil ? new Date(input.blockedUntil) : null,
            note: input.note,
            reviewedBy: actor.userId,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      if (input.status !== 'CAN_BID') await deactivateMaxBids(tx, actor, id, `Bieterstatus ${input.status}`);
      await audit(tx, actor, {
        event: 'BIDDING_STATUS_CHANGED',
        entityType: 'company',
        entityId: id,
        oldValue: { biddingStatus: from },
        newValue: { biddingStatus: input.status, blockedUntil: input.blockedUntil ?? null, note: input.note },
      });
      if (input.status === 'CAN_BID') {
        await notifyCompany(tx, id, { type: 'ACCOUNT_APPROVED', title: 'Sie dürfen jetzt bieten', body: 'Ihr Händlerkonto ist zur Gebotsabgabe freigeschaltet.', link: '/haendler' });
      }
      return { biddingStatus: input.status };
    });
  });

  app.post('/admin/companies/:id/documents', async (req, reply) => {
    const id = idParam(req.params);
    const file = await receiveFile(req);
    const r = await db.transaction(async (tx) => storeCompanyDocument(tx, actorOf(req), await lockCompany(tx, id), file.fields.kind, file));
    return reply.status(201).send(r);
  });

  app.get('/admin/companies/:id/documents/:docId/file', async (req, reply) => {
    const id = idParam(req.params);
    const docId = idParam(req.params, 'docId');
    const [doc] = await db
      .select()
      .from(schema.companyDocuments)
      .where(and(eq(schema.companyDocuments.id, docId), eq(schema.companyDocuments.companyId, id)));
    if (!doc) throw notFound('Dokument');
    return reply.redirect(await signedUrl(doc.storageKey, { downloadName: doc.fileName }));
  });

  // ---------- Benutzer ----------
  app.get('/admin/users', async (req) => {
    const q = parse(z.object({ role: z.enum(PLATFORM_ROLES).optional(), q: z.string().max(100).optional() }), req.query);
    const where: SQL[] = [];
    if (q.role) where.push(eq(schema.users.platformRole, q.role));
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      where.push(or(ilike(schema.users.email, like), ilike(schema.users.lastName, like), ilike(schema.users.firstName, like))!);
    }
    return db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        phone: schema.users.phone,
        platformRole: schema.users.platformRole,
        isActive: schema.users.isActive,
        lockedAt: schema.users.lockedAt,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
        companyId: schema.companies.id,
        companyName: schema.companies.name,
        companyType: schema.companies.type,
        companyRole: schema.companyUsers.companyRole,
      })
      .from(schema.users)
      .leftJoin(schema.companyUsers, eq(schema.companyUsers.userId, schema.users.id))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.companyUsers.companyId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(schema.users.lastName))
      .limit(1000);
  });

  app.post('/admin/users', async (req, reply) => {
    const me = getAuth(req);
    const input = parse(adminCreateUserSchema, req.body);
    if ((input.platformRole === 'ADMIN' || input.platformRole === 'SUPERADMIN') && me.platformRole !== 'SUPERADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Nur Superadmins können Administratoren anlegen.');
    }
    if (input.platformRole === 'USER' && !input.companyId) {
      throw new AppError(400, 'COMPANY_REQUIRED', 'Firmenbenutzer benötigen ein Unternehmen.');
    }
    if (input.platformRole !== 'USER' && input.companyId) {
      throw new AppError(400, 'NO_COMPANY_ALLOWED', 'Plattformrollen gehören keinem Unternehmen an.');
    }
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${input.email}`);
    if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    const passwordHash = await hashPassword(input.password);
    const created = await db.transaction(async (tx) => {
      if (input.companyId) await getCompany(tx, input.companyId);
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          platformRole: input.platformRole,
        })
        .returning({ id: schema.users.id });
      if (input.companyId) {
        await tx.insert(schema.companyUsers).values({ companyId: input.companyId, userId: user!.id, companyRole: input.companyRole ?? 'MEMBER' });
      }
      await audit(tx, actorOf(req), {
        event: 'USER_CREATED',
        entityType: 'user',
        entityId: user!.id,
        newValue: { email: input.email, platformRole: input.platformRole, companyId: input.companyId ?? null },
      });
      return user!;
    });
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/admin/users/:id', async (req) => {
    const me = getAuth(req);
    const id = idParam(req.params);
    const input = parse(adminUpdateUserSchema, req.body);
    return db.transaction(async (tx) => {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).for('update');
      if (!user) throw notFound('Benutzer');
      const touchesAdmin = user.platformRole === 'SUPERADMIN' || user.platformRole === 'ADMIN' || input.platformRole === 'ADMIN' || input.platformRole === 'SUPERADMIN';
      if (touchesAdmin && me.platformRole !== 'SUPERADMIN') throw new AppError(403, 'FORBIDDEN', 'Nur Superadmins dürfen Administratoren ändern.');
      if (id === me.userId && (input.isActive === false || input.platformRole)) {
        throw new AppError(400, 'SELF_CHANGE', 'Sie können Ihr eigenes Konto nicht sperren oder Ihre Rolle ändern.');
      }
      if (input.platformRole && input.platformRole !== user.platformRole) {
        const [membership] = await tx.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, id));
        if (membership && input.platformRole !== 'USER') throw new AppError(400, 'HAS_COMPANY', 'Firmenbenutzer können keine Plattformrolle erhalten.');
        if (!membership && input.platformRole === 'USER') throw new AppError(400, 'COMPANY_REQUIRED', 'Firmenbenutzer benötigen ein Unternehmen.');
      }
      const changes: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
      if (input.firstName !== undefined) changes.firstName = input.firstName;
      if (input.lastName !== undefined) changes.lastName = input.lastName;
      if (input.phone !== undefined) changes.phone = input.phone;
      if (input.platformRole !== undefined) changes.platformRole = input.platformRole;
      if (input.isActive !== undefined) {
        changes.isActive = input.isActive;
        changes.lockedAt = input.isActive ? null : new Date();
      }
      if (input.password) changes.passwordHash = await hashPassword(input.password);
      await tx.update(schema.users).set(changes).where(eq(schema.users.id, id));
      if (input.isActive === false || input.password || input.platformRole) await revokeUserSessions(tx, id);
      await audit(tx, actorOf(req), {
        event: input.isActive === false ? 'USER_LOCKED' : input.isActive === true && !user.isActive ? 'USER_UNLOCKED' : 'USER_UPDATED',
        entityType: 'user',
        entityId: id,
        oldValue: { isActive: user.isActive, platformRole: user.platformRole, firstName: user.firstName, lastName: user.lastName },
        newValue: { ...input, password: input.password ? '[geändert]' : undefined },
      });
      return { ok: true };
    });
  });

  // ---------- Rechtstexte ----------
  app.get('/admin/legal', async () =>
    db.select().from(schema.legalDocuments).orderBy(asc(schema.legalDocuments.kind), desc(schema.legalDocuments.activeFrom)),
  );

  app.post('/admin/legal', async (req, reply) => {
    const input = parse(createLegalDocumentSchema, req.body);
    const created = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(schema.legalDocuments)
        .values({
          kind: input.kind,
          version: input.version,
          title: input.title,
          content: input.content,
          activeFrom: input.activeFrom ? new Date(input.activeFrom) : new Date(),
          createdBy: getAuth(req).userId,
        })
        .returning();
      await audit(tx, actorOf(req), {
        event: 'LEGAL_PUBLISHED',
        entityType: 'legal_document',
        entityId: doc!.id,
        newValue: { kind: doc!.kind, version: doc!.version, activeFrom: doc!.activeFrom },
      });
      return doc!;
    });
    return reply.status(201).send(created);
  });

  // ---------- Einstellungen ----------
  app.get('/admin/settings', async () => getSettings());

  app.put('/admin/settings', { preHandler: requireSuperadmin }, async (req) => {
    const input = parse(settingsSchema, req.body);
    if (input.paintFlagBelowUm >= input.paintFlagAboveUm) throw new AppError(400, 'INVALID_THRESHOLDS', 'Untere Lackschwelle muss kleiner als die obere sein.');
    await db.transaction(async (tx) => {
      const before = await getSettings(tx);
      await saveSettings(tx, input, getAuth(req).userId);
      const d = diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>);
      await audit(tx, actorOf(req), { event: 'SETTINGS_CHANGED', entityType: 'settings', entityId: 'platform', oldValue: d.old, newValue: d.new });
    });
    return getSettings();
  });

  // ---------- Audit-Log ----------
  app.get('/admin/audit', async (req) => {
    const q = parse(
      z.object({
        entityType: z.string().max(50).optional(),
        entityId: z.string().max(80).optional(),
        event: z.enum(AUDIT_EVENTS).optional(),
        actorUserId: uuidSchema.optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.entityType) where.push(eq(schema.auditLogs.entityType, q.entityType));
    if (q.entityId) where.push(eq(schema.auditLogs.entityId, q.entityId));
    if (q.event) where.push(eq(schema.auditLogs.event, q.event));
    if (q.actorUserId) where.push(eq(schema.auditLogs.actorUserId, q.actorUserId));
    if (q.from) where.push(gte(schema.auditLogs.createdAt, new Date(q.from)));
    if (q.to) where.push(lte(schema.auditLogs.createdAt, new Date(q.to)));
    const pageSize = 100;
    const rows = await db
      .select({
        log: schema.auditLogs,
        actorEmail: schema.users.email,
        actorName: sql<string | null>`${schema.users.firstName} || ' ' || ${schema.users.lastName}`,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.auditLogs.id))
      .limit(pageSize + 1)
      .offset((q.page - 1) * pageSize);
    return {
      items: rows.slice(0, pageSize).map((r) => ({ ...r.log, actorEmail: r.actorEmail, actorName: r.actorName })),
      hasMore: rows.length > pageSize,
      page: q.page,
    };
  });

  // ---------- Systemstatus (Jobs, Worker) ----------
  app.get('/admin/system', async () => {
    const counts = await db.execute<{ type: string; status: string; n: number }>(
      sql`select type, status, count(*)::int as n from jobs group by type, status order by type, status`,
    );
    const failed = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'FAILED'))
      .orderBy(desc(schema.jobs.id))
      .limit(50);
    const stuck = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from jobs where status = 'PENDING' and run_at < now() - interval '2 minutes'`,
    );
    return {
      jobs: counts.rows,
      failedJobs: failed.map((j) => ({ id: j.id, type: j.type, attempts: j.attempts, lastError: j.lastError?.split('\n')[0], createdAt: j.createdAt, payload: j.payload })),
      overduePending: stuck.rows[0]?.n ?? 0,
      malwareScan: malwareScanMode,
      scheduler: { enabled: config.SCHEDULER_ENABLED, ...schedulerStatus },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/admin/system/jobs/:jobId/retry', async (req) => {
    const jobId = parse(z.coerce.number().int().positive(), (req.params as { jobId: string }).jobId);
    const ok = await retryJob(jobId);
    if (!ok) throw notFound('Fehlgeschlagener Job');
    await audit(db, actorOf(req), { event: 'SETTINGS_CHANGED', entityType: 'job', entityId: String(jobId), newValue: { action: 'retry' } });
    return { ok: true };
  });

  // ---------- Außendienstmitarbeiter (Liste für Disposition) ----------
  app.get('/admin/inspectors', async () =>
    db
      .select({
        id: schema.users.id,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        phone: schema.users.phone,
        email: schema.users.email,
        isActive: schema.users.isActive,
      })
      .from(schema.users)
      .where(and(eq(schema.users.platformRole, 'INSPECTOR'), eq(schema.users.isActive, true)))
      .orderBy(asc(schema.users.lastName)),
  );

  void inArray;
}
