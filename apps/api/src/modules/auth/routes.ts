import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { acceptLegalSchema, changePasswordSchema, loginSchema } from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { AppError, parse } from '../../core/errors';
import {
  DUMMY_HASH,
  SESSION_COOKIE,
  actorOf,
  createSession,
  getAuth,
  hashPassword,
  needsRehash,
  requireAuth,
  revokeSession,
  revokeUserSessions,
  verifyPassword,
} from '../../core/auth';
import { audit } from '../../core/audit';
import { config, rateMax } from '../../config';
import { aiVisionEnabled } from '../../core/ai-vision';
import { activeLegalDocuments, pendingLegalDocuments, recordAcceptances } from '../legal/service';

/** Zusätzliche Begrenzung pro E-Mail-Adresse gegen verteiltes Passwort-Raten. */
const emailAttempts = new Map<string, { count: number; resetAt: number }>();
function checkEmailThrottle(email: string): void {
  if (config.RATE_LIMIT_DISABLED) return;
  const now = Date.now();
  const entry = emailAttempts.get(email);
  if (entry && entry.resetAt > now && entry.count >= 10) {
    throw new AppError(429, 'RATE_LIMITED', 'Zu viele Anmeldeversuche für dieses Konto. Bitte in 15 Minuten erneut versuchen.');
  }
}
function registerFailure(email: string): void {
  const now = Date.now();
  const entry = emailAttempts.get(email);
  if (!entry || entry.resetAt <= now) emailAttempts.set(email, { count: 1, resetAt: now + 15 * 60_000 });
  else entry.count++;
}

export function setSessionCookie(reply: import('fastify').FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: rateMax(20), timeWindow: '15 minutes', keyGenerator: (r) => r.ip } } },
    async (req, reply) => {
      const input = parse(loginSchema, req.body);
      checkEmailThrottle(input.email);
      const [user] = await db
        .select()
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${input.email}`)
        .limit(1);
      const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
      const actor = { ...actorOf(req), userId: user?.id ?? null, role: user?.platformRole ?? 'ANONYMOUS' };
      if (!user || !ok) {
        registerFailure(input.email);
        await db.transaction(async (tx) => {
          if (user) await tx.update(schema.users).set({ failedLogins: sql`${schema.users.failedLogins} + 1` }).where(eq(schema.users.id, user.id));
          await audit(tx, actor, { event: 'LOGIN_FAILED', entityType: 'user', entityId: user?.id ?? null, newValue: { email: input.email } });
        });
        throw new AppError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch.');
      }
      if (!user.isActive || user.lockedAt) {
        await audit(db, actor, { event: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, newValue: { reason: 'locked' } });
        throw new AppError(403, 'ACCOUNT_LOCKED', 'Ihr Konto ist gesperrt. Bitte wenden Sie sich an den Plattformbetreiber.');
      }
      const [membership] = await db
        .select({ status: schema.companies.status })
        .from(schema.companyUsers)
        .innerJoin(schema.companies, eq(schema.companies.id, schema.companyUsers.companyId))
        .where(eq(schema.companyUsers.userId, user.id))
        .limit(1);
      if (membership?.status === 'BLOCKED') {
        await audit(db, actor, { event: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, newValue: { reason: 'company_blocked' } });
        throw new AppError(403, 'COMPANY_BLOCKED', 'Ihr Unternehmen ist gesperrt. Bitte wenden Sie sich an den Plattformbetreiber.');
      }
      // Ältere Hash-Verfahren nach erfolgreicher Anmeldung umstellen (nur jetzt liegt das Klartextpasswort vor).
      const upgradedHash = needsRehash(user.passwordHash) ? await hashPassword(input.password) : null;
      const { token, expiresAt } = await createSession(user.id, req.ip, req.headers['user-agent'] ?? null);
      await db.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ lastLoginAt: new Date(), failedLogins: 0, ...(upgradedHash ? { passwordHash: upgradedHash } : {}) })
          .where(eq(schema.users.id, user.id));
        await audit(tx, actor, { event: 'LOGIN', entityType: 'user', entityId: user.id, ...(upgradedHash ? { newValue: { passwordHashUpgraded: true } } : {}) });
      });
      emailAttempts.delete(input.email);
      setSessionCookie(reply, token, expiresAt);
      return { ok: true };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth) {
      await revokeSession(req.auth.sessionId);
      await audit(db, actorOf(req), { event: 'LOGOUT', entityType: 'user', entityId: req.auth.userId });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    const pending = u.platformRole === 'USER' ? await pendingLegalDocuments(db, u.userId, u.company?.type ?? null) : [];
    return {
      user: {
        id: u.userId,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        platformRole: u.platformRole,
      },
      company: u.company,
      pendingLegal: pending.map((d) => ({ id: d.id, kind: d.kind, version: d.version, title: d.title })),
      features: { aiVision: aiVisionEnabled() },
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/auth/password', { preHandler: requireAuth, config: { rateLimit: { max: rateMax(10), timeWindow: '15 minutes' } } }, async (req) => {
    const u = getAuth(req);
    const input = parse(changePasswordSchema, req.body);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, u.userId));
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Das aktuelle Passwort ist falsch.');
    }
    const hash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(schema.users.id, u.userId));
      // Alle anderen Sessions beenden.
      await revokeUserSessions(tx, u.userId);
      await audit(tx, actorOf(req), { event: 'PASSWORD_CHANGED', entityType: 'user', entityId: u.userId });
    });
    return { ok: true, reloginRequired: true };
  });

  app.post('/auth/accept-legal', { preHandler: requireAuth }, async (req) => {
    const u = getAuth(req);
    const input = parse(acceptLegalSchema, req.body);
    const active = await activeLegalDocuments(db);
    const activeIds = new Set(active.map((d) => d.id));
    const invalid = input.legalDocumentIds.filter((id) => !activeIds.has(id));
    if (invalid.length) throw new AppError(400, 'LEGAL_NOT_CURRENT', 'Nur aktuell gültige Rechtstexte können akzeptiert werden.');
    await db.transaction(async (tx) => {
      await recordAcceptances(tx, {
        userId: u.userId,
        companyId: u.company?.id ?? null,
        docIds: input.legalDocumentIds,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      await audit(tx, actorOf(req), {
        event: 'LEGAL_ACCEPTED',
        entityType: 'legal_document',
        newValue: active.filter((d) => input.legalDocumentIds.includes(d.id)).map((d) => ({ kind: d.kind, version: d.version, id: d.id })),
      });
    });
    return { ok: true };
  });

  app.get('/legal/current', async () => {
    const docs = await activeLegalDocuments(db);
    return docs.map((d) => ({ id: d.id, kind: d.kind, version: d.version, title: d.title, content: d.content, activeFrom: d.activeFrom }));
  });
}
