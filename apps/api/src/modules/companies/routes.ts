import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  createCompanyUserSchema,
  registerDealerSchema,
  registerDealershipSchema,
  updateCompanySchema,
  updateCompanyUserSchema,
  uuidSchema,
  type CompanyType,
  approxCoordinatesForZip,
} from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { AppError, notFound, parse } from '../../core/errors';
import { actorOf, companyOf, createSession, getAuth, hashPassword, requireAuth, requireCompany, revokeUserSessions } from '../../core/auth';
import { audit, diff } from '../../core/audit';
import { receiveFile } from '../../core/upload';
import { signedUrl } from '../../core/storage';
import { activeLegalDocuments, recordAcceptances, requiredLegalKinds } from '../legal/service';
import { setSessionCookie } from '../auth/routes';
import { getCompany, hasTradeLicense, lockCompany, setCompanyStatus, storeCompanyDocument } from './service';
import { rateMax } from '../../config';

async function emailTaken(email: string): Promise<boolean> {
  const [r] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return !!r;
}

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Registrierung ----------
  const register = async (req: FastifyRequest, type: CompanyType) => {
    const input =
      type === 'DEALER' ? parse(registerDealerSchema, req.body) : parse(registerDealershipSchema, req.body);
    if (await emailTaken(input.email)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    }
    const legal = await activeLegalDocuments(db, requiredLegalKinds(type));
    if (legal.length < requiredLegalKinds(type).length) {
      throw new AppError(503, 'LEGAL_NOT_CONFIGURED', 'Rechtstexte sind noch nicht konfiguriert. Registrierung derzeit nicht möglich.');
    }
    const passwordHash = await hashPassword(input.password);
    const result = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(schema.companies)
        .values({
          type,
          name: input.name,
          legalForm: input.legalForm,
          street: input.street,
          houseNumber: input.houseNumber,
          zip: input.zip,
          city: input.city,
          website: input.website,
          registerNumber: input.registerNumber,
          vatId: input.vatId,
          brands: 'brands' in input ? input.brands : [],
          tradeType: 'tradeType' in input ? input.tradeType : null,
          bankIban: 'bankIban' in input ? input.bankIban : null,
          contactFirstName: input.firstName,
          contactLastName: input.lastName,
          contactPhone: input.phone,
          contactEmail: input.email,
          status: 'REGISTRATION_STARTED',
          lat: approxCoordinatesForZip(input.zip)?.lat ?? null,
          lng: approxCoordinatesForZip(input.zip)?.lng ?? null,
        })
        .returning();
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          platformRole: 'USER',
        })
        .returning({ id: schema.users.id });
      await tx.insert(schema.companyUsers).values({ companyId: company!.id, userId: user!.id, companyRole: 'OWNER' });
      if (type === 'DEALER') {
        await tx.insert(schema.dealerVerifications).values({ companyId: company!.id, biddingStatus: 'VIEW_ONLY' });
      }
      await recordAcceptances(tx, {
        userId: user!.id,
        companyId: company!.id,
        docIds: legal.map((d) => d.id),
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      const actor = { ...actorOf(req), userId: user!.id, role: `USER:${type}:OWNER`, companyId: company!.id };
      await audit(tx, actor, {
        event: 'REGISTER',
        entityType: 'company',
        entityId: company!.id,
        newValue: { type, name: input.name, email: input.email },
      });
      await audit(tx, actor, {
        event: 'LEGAL_ACCEPTED',
        entityType: 'legal_document',
        newValue: legal.map((d) => ({ kind: d.kind, version: d.version, id: d.id })),
      });
      return { companyId: company!.id, userId: user!.id };
    });
    return result;
  };

  app.post('/register/dealership', { config: { rateLimit: { max: rateMax(10), timeWindow: '1 hour', keyGenerator: (r) => r.ip } } }, async (req, reply) => {
    const r = await register(req, 'DEALERSHIP');
    const s = await createSession(r.userId, req.ip, req.headers['user-agent'] ?? null);
    setSessionCookie(reply, s.token, s.expiresAt);
    return reply.status(201).send({ companyId: r.companyId });
  });

  app.post('/register/dealer', { config: { rateLimit: { max: rateMax(10), timeWindow: '1 hour', keyGenerator: (r) => r.ip } } }, async (req, reply) => {
    const r = await register(req, 'DEALER');
    const s = await createSession(r.userId, req.ip, req.headers['user-agent'] ?? null);
    setSessionCookie(reply, s.token, s.expiresAt);
    return reply.status(201).send({ companyId: r.companyId });
  });

  /** Registrierung abschließen: ohne Gewerbenachweis → "Unterlagen fehlen". */
  app.post('/register/submit', { preHandler: requireCompany({ approved: false, roles: ['OWNER', 'MANAGER'] }) }, async (req) => {
    const c = companyOf(req);
    return db.transaction(async (tx) => {
      const company = await lockCompany(tx, c.id);
      if (company.status !== 'REGISTRATION_STARTED') return { status: company.status };
      const next = (await hasTradeLicense(tx, c.id)) ? 'IN_REVIEW' : 'DOCUMENTS_MISSING';
      await setCompanyStatus(tx, actorOf(req), company, next, null);
      return { status: next };
    });
  });

  // ---------- Eigene Firma ----------
  const companyGuard = requireCompany({ approved: false });
  const managerGuard = requireCompany({ approved: false, roles: ['OWNER', 'MANAGER'] });

  app.get('/company', { preHandler: companyGuard }, async (req) => {
    const c = companyOf(req);
    const company = await getCompany(db, c.id);
    const docs = await db
      .select({
        id: schema.companyDocuments.id,
        kind: schema.companyDocuments.kind,
        fileName: schema.companyDocuments.fileName,
        sizeBytes: schema.companyDocuments.sizeBytes,
        createdAt: schema.companyDocuments.createdAt,
      })
      .from(schema.companyDocuments)
      .where(eq(schema.companyDocuments.companyId, c.id))
      .orderBy(asc(schema.companyDocuments.createdAt));
    const [verification] =
      company.type === 'DEALER'
        ? await db.select().from(schema.dealerVerifications).where(eq(schema.dealerVerifications.companyId, c.id))
        : [];
    const { bankIban, ...rest } = company;
    return {
      ...rest,
      // IBAN nur maskiert ausliefern.
      bankIban: bankIban ? `${bankIban.slice(0, 4)} •••• ${bankIban.slice(-4)}` : null,
      documents: docs,
      biddingStatus: verification?.biddingStatus ?? null,
      blockedUntil: verification?.blockedUntil ?? null,
    };
  });

  app.patch('/company', { preHandler: managerGuard }, async (req) => {
    const c = companyOf(req);
    const input = parse(updateCompanySchema, req.body);
    return db.transaction(async (tx) => {
      const company = await lockCompany(tx, c.id);
      if (company.status === 'BLOCKED' || company.status === 'REJECTED') {
        throw new AppError(403, 'COMPANY_LOCKED', 'Firmendaten können in diesem Status nicht geändert werden.');
      }
      const changes = { ...input, updatedAt: new Date() };
      const d = diff(company as unknown as Record<string, unknown>, input as Record<string, unknown>);
      await tx.update(schema.companies).set(changes).where(eq(schema.companies.id, c.id));
      await audit(tx, actorOf(req), { event: 'COMPANY_UPDATED', entityType: 'company', entityId: c.id, oldValue: d.old, newValue: d.new });
      return { ok: true };
    });
  });

  app.post('/company/documents', { preHandler: managerGuard }, async (req, reply) => {
    const c = companyOf(req);
    const file = await receiveFile(req);
    const result = await db.transaction(async (tx) => {
      const company = await lockCompany(tx, c.id);
      return storeCompanyDocument(tx, actorOf(req), company, file.fields.kind, file);
    });
    return reply.status(201).send(result);
  });

  app.get('/company/documents/:docId/file', { preHandler: companyGuard }, async (req, reply) => {
    const c = companyOf(req);
    const docId = parse(uuidSchema, (req.params as { docId: string }).docId);
    const [doc] = await db
      .select()
      .from(schema.companyDocuments)
      .where(and(eq(schema.companyDocuments.id, docId), eq(schema.companyDocuments.companyId, c.id)));
    if (!doc) throw notFound('Dokument');
    return reply.redirect(await signedUrl(doc.storageKey, { downloadName: doc.fileName }));
  });

  // ---------- Firmenmitarbeiter ----------
  app.get('/company/users', { preHandler: companyGuard }, async (req) => {
    const c = companyOf(req);
    return db
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
      .where(eq(schema.companyUsers.companyId, c.id))
      .orderBy(asc(schema.users.lastName));
  });

  app.post('/company/users', { preHandler: requireCompany({ roles: ['OWNER', 'MANAGER'] }) }, async (req, reply) => {
    const c = companyOf(req);
    const me = getAuth(req);
    const input = parse(createCompanyUserSchema, req.body);
    if (input.companyRole === 'OWNER' && c.role !== 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Nur Inhaber können weitere Inhaber anlegen.');
    }
    if (await emailTaken(input.email)) throw new AppError(409, 'EMAIL_TAKEN', 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    const passwordHash = await hashPassword(input.password);
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          platformRole: 'USER',
        })
        .returning({ id: schema.users.id });
      await tx.insert(schema.companyUsers).values({
        companyId: c.id,
        userId: user!.id,
        companyRole: input.companyRole,
        jobTitle: input.jobTitle,
      });
      await audit(tx, actorOf(req), {
        event: 'USER_CREATED',
        entityType: 'user',
        entityId: user!.id,
        newValue: { email: input.email, companyId: c.id, companyRole: input.companyRole, createdBy: me.userId },
      });
      return user!;
    });
    return reply.status(201).send({ id: created.id });
  });

  app.patch('/company/users/:userId', { preHandler: requireCompany({ roles: ['OWNER', 'MANAGER'] }) }, async (req) => {
    const c = companyOf(req);
    const me = getAuth(req);
    const userId = parse(uuidSchema, (req.params as { userId: string }).userId);
    const input = parse(updateCompanyUserSchema, req.body);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ user: schema.users, membership: schema.companyUsers })
        .from(schema.companyUsers)
        .innerJoin(schema.users, eq(schema.users.id, schema.companyUsers.userId))
        .where(and(eq(schema.companyUsers.companyId, c.id), eq(schema.companyUsers.userId, userId)))
        .for('update');
      if (!row) throw notFound('Benutzer');
      if (row.membership.companyRole === 'OWNER' && c.role !== 'OWNER') throw new AppError(403, 'FORBIDDEN', 'Inhaber können nur von Inhabern geändert werden.');
      if (input.companyRole === 'OWNER' && c.role !== 'OWNER') throw new AppError(403, 'FORBIDDEN', 'Nur Inhaber können Inhaber ernennen.');
      if (userId === me.userId && (input.isActive === false || (input.companyRole && input.companyRole !== row.membership.companyRole))) {
        throw new AppError(400, 'SELF_CHANGE', 'Sie können Ihr eigenes Konto nicht deaktivieren oder Ihre Rolle ändern.');
      }
      const userChanges: Partial<typeof schema.users.$inferInsert> = {};
      if (input.firstName !== undefined) userChanges.firstName = input.firstName;
      if (input.lastName !== undefined) userChanges.lastName = input.lastName;
      if (input.phone !== undefined) userChanges.phone = input.phone;
      if (input.isActive !== undefined) userChanges.isActive = input.isActive;
      if (Object.keys(userChanges).length) {
        await tx.update(schema.users).set({ ...userChanges, updatedAt: new Date() }).where(eq(schema.users.id, userId));
      }
      if (input.companyRole !== undefined || input.jobTitle !== undefined) {
        await tx
          .update(schema.companyUsers)
          .set({
            ...(input.companyRole ? { companyRole: input.companyRole } : {}),
            ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          })
          .where(eq(schema.companyUsers.id, row.membership.id));
      }
      if (input.isActive === false) await revokeUserSessions(tx, userId);
      await audit(tx, actorOf(req), {
        event: input.isActive === false ? 'USER_LOCKED' : 'USER_UPDATED',
        entityType: 'user',
        entityId: userId,
        oldValue: { isActive: row.user.isActive, companyRole: row.membership.companyRole },
        newValue: input,
      });
      return { ok: true };
    });
  });

  // Status-Endpunkt auch für nicht freigegebene Firmen (Registrierungsfortschritt).
  app.get('/register/status', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    if (!u.company) return { status: null };
    const company = await getCompany(db, u.company.id);
    return {
      status: company.status,
      reviewNote: company.reviewNote,
      hasTradeLicense: await hasTradeLicense(db, company.id),
      type: company.type,
    };
  });
}
