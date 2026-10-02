import crypto from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BiddingStatus, CompanyRole, CompanyStatus, CompanyType, PlatformRole } from '@sd/shared';
import { config } from '../config';
import { db, schema, type DbOrTx } from './db/client';
import { AppError, forbidden } from './errors';
import { publish, channels } from './realtime';
import type { Actor } from './audit';

export const SESSION_COOKIE = 'sd_session';

/*
 * Passwort-Hashing: PBKDF2-HMAC-SHA256 mit 600 000 Iterationen (OWASP-Empfehlung) und 16 Byte Zufallssalt.
 * Die Berechnung läuft im libuv-Threadpool und blockiert die Ereignisschleife nicht. So verzögern viele
 * gleichzeitige Anmeldungen keine Gebote und keine Live-Ereignisse (Lasttest: 100 parallele Logins).
 * Format: pbkdf2-sha256$<Iterationen>$<Salt base64>$<Schlüssel base64>.
 * Ältere bcrypt-Hashes werden weiter geprüft und nach der nächsten erfolgreichen Anmeldung ersetzt (needsRehash).
 */
const pbkdf2 = promisify(crypto.pbkdf2);
const PBKDF2_PREFIX = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = config.NODE_ENV === 'test' ? 1_000 : 600_000;
const PBKDF2_KEY_BYTES = 32;
const LEGACY_BCRYPT = /^\$2[aby]\$\d{2}\$/;

const formatHash = (iterations: number, salt: Buffer, key: Buffer) => [PBKDF2_PREFIX, iterations, salt.toString('base64'), key.toString('base64')].join('$');

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return formatHash(PBKDF2_ITERATIONS, salt, await pbkdf2(pw, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, 'sha256'));
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts[0] === PBKDF2_PREFIX && parts.length === 4) {
    const iterations = Number(parts[1]);
    const salt = Buffer.from(parts[2]!, 'base64');
    const expected = Buffer.from(parts[3]!, 'base64');
    if (!Number.isInteger(iterations) || iterations < 1 || salt.length === 0 || expected.length === 0) return false;
    const actual = await pbkdf2(pw, salt, iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  }
  if (LEGACY_BCRYPT.test(stored)) return bcrypt.compare(pw, stored);
  return false;
}

/** true, wenn der gespeicherte Hash nicht dem aktuellen Verfahren entspricht; er wird nach erfolgreicher Anmeldung ersetzt. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  return parts[0] !== PBKDF2_PREFIX || Number(parts[1]) < PBKDF2_ITERATIONS;
}

/**
 * Konstante Laufzeit auch bei unbekannter E-Mail (verhindert User-Enumeration über Timing):
 * Die Prüfung gegen diesen Hash kostet dieselbe Schlüsselableitung wie bei einem echten Konto.
 */
export const DUMMY_HASH = formatHash(PBKDF2_ITERATIONS, crypto.randomBytes(16), crypto.randomBytes(PBKDF2_KEY_BYTES));

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface AuthCompany {
  id: string;
  name: string;
  type: CompanyType;
  status: CompanyStatus;
  role: CompanyRole;
  biddingStatus: BiddingStatus | null;
  blockedUntil: Date | null;
}

export interface AuthUser {
  sessionId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: PlatformRole;
  company: AuthCompany | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthUser | null;
  }
}

export async function createSession(userId: string, ip: string | null, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

/** Alle Sessions eines Benutzers ungültig machen und offene WebSockets trennen. */
export async function revokeUserSessions(tx: DbOrTx, userId: string): Promise<void> {
  await tx
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  await publish(tx, channels.user(userId), '__disconnect', {});
}

export async function revokeCompanySessions(tx: DbOrTx, companyId: string): Promise<void> {
  const members = await tx
    .select({ userId: schema.companyUsers.userId })
    .from(schema.companyUsers)
    .where(eq(schema.companyUsers.companyId, companyId));
  for (const m of members) await revokeUserSessions(tx, m.userId);
}

export async function resolveSession(token: string): Promise<AuthUser | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      lastSeenAt: schema.sessions.lastSeenAt,
      userId: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
      platformRole: schema.users.platformRole,
      isActive: schema.users.isActive,
      lockedAt: schema.users.lockedAt,
      companyId: schema.companies.id,
      companyName: schema.companies.name,
      companyType: schema.companies.type,
      companyStatus: schema.companies.status,
      companyRole: schema.companyUsers.companyRole,
      biddingStatus: schema.dealerVerifications.biddingStatus,
      blockedUntil: schema.dealerVerifications.blockedUntil,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .leftJoin(schema.companyUsers, eq(schema.companyUsers.userId, schema.users.id))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.companyUsers.companyId))
    .leftJoin(schema.dealerVerifications, eq(schema.dealerVerifications.companyId, schema.companies.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r || !r.isActive || r.lockedAt) return null;
  // Gesperrte Firmen: Benutzer werden abgemeldet.
  if (r.companyStatus === 'BLOCKED') return null;

  if (Date.now() - r.lastSeenAt.getTime() > 60_000) {
    void db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, r.sessionId))
      .catch(() => undefined);
  }

  return {
    sessionId: r.sessionId,
    userId: r.userId,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    platformRole: r.platformRole,
    company:
      r.companyId && r.companyType && r.companyStatus && r.companyRole && r.companyName
        ? {
            id: r.companyId,
            name: r.companyName,
            type: r.companyType,
            status: r.companyStatus,
            role: r.companyRole,
            biddingStatus: r.biddingStatus ?? null,
            blockedUntil: r.blockedUntil ?? null,
          }
        : null,
  };
}

// ---------- Guards (serverseitige Autorisierung bei jedem Request) ----------

export function isAdmin(user: AuthUser | null): boolean {
  return !!user && (user.platformRole === 'ADMIN' || user.platformRole === 'SUPERADMIN');
}

export function getAuth(req: FastifyRequest): AuthUser {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
  return req.auth;
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  getAuth(req);
}

export function requireRoles(...roles: PlatformRole[]) {
  return async (req: FastifyRequest): Promise<void> => {
    const user = getAuth(req);
    if (!roles.includes(user.platformRole)) throw forbidden();
  };
}

export const requireAdmin = requireRoles('ADMIN', 'SUPERADMIN');
export const requireSuperadmin = requireRoles('SUPERADMIN');
export const requireInspectorOrAdmin = requireRoles('INSPECTOR', 'ADMIN', 'SUPERADMIN');

export interface CompanyGuardOptions {
  type?: CompanyType;
  /** Firma muss freigegeben sein (Standard: true). */
  approved?: boolean;
  roles?: CompanyRole[];
}

export function requireCompany(opts: CompanyGuardOptions = {}) {
  return async (req: FastifyRequest): Promise<void> => {
    const user = getAuth(req);
    const c = user.company;
    if (user.platformRole !== 'USER' || !c) throw forbidden('Nur für Firmenkonten.');
    if (opts.type && c.type !== opts.type) throw forbidden();
    if ((opts.approved ?? true) && c.status !== 'APPROVED') {
      throw new AppError(403, 'COMPANY_NOT_APPROVED', 'Ihr Unternehmen ist noch nicht freigegeben.');
    }
    if (opts.roles && !opts.roles.includes(c.role)) throw forbidden('Diese Aktion ist der Firmenleitung vorbehalten.');
  };
}

export function companyOf(req: FastifyRequest): AuthCompany {
  const c = getAuth(req).company;
  if (!c) throw forbidden('Nur für Firmenkonten.');
  return c;
}

export function actorOf(req: FastifyRequest): Actor {
  const u = req.auth;
  return {
    userId: u?.userId ?? null,
    role: u ? (u.company ? `${u.platformRole}:${u.company.type}:${u.company.role}` : u.platformRole) : 'ANONYMOUS',
    companyId: u?.company?.id ?? null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
