import bcrypt from 'bcryptjs';
import { and, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../src/core/auth';
import { db, schema } from '../src/core/db/client';
import { PASSWORD, api, login, uniq } from './helpers';

/** Passwort-Hashing (PBKDF2-SHA256 im Threadpool) und automatische Umstellung älterer bcrypt-Hashes. */
describe('Passwort-Hashing', () => {
  it('erzeugt PBKDF2-Hashes mit Zufallssalt und prüft sie', async () => {
    const a = await hashPassword('Geheim-123!');
    const b = await hashPassword('Geheim-123!');
    expect(a).toMatch(/^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b); // unterschiedliche Salts
    expect(await verifyPassword('Geheim-123!', a)).toBe(true);
    expect(await verifyPassword('geheim-123!', a)).toBe(false);
    expect(needsRehash(a)).toBe(false);
  });

  it('lehnt beschädigte oder unbekannte Hash-Formate ab', async () => {
    for (const broken of ['', 'klartext', 'pbkdf2-sha256$abc$AAAA$AAAA', 'pbkdf2-sha256$1000$$', 'md5$abc']) {
      expect(await verifyPassword('egal', broken)).toBe(false);
    }
  });

  it('akzeptiert ältere bcrypt-Hashes und ersetzt sie bei der nächsten Anmeldung', async () => {
    const legacy = bcrypt.hashSync(PASSWORD, 4);
    expect(needsRehash(legacy)).toBe(true);
    expect(await verifyPassword(PASSWORD, legacy)).toBe(true);

    const email = `${uniq('legacy')}@test.local`;
    const [user] = await db
      .insert(schema.users)
      .values({ email, passwordHash: legacy, firstName: 'Alt', lastName: 'Hash', platformRole: 'ADMIN' })
      .returning();

    // Falsches Passwort ändert nichts.
    expect((await api('POST', '/auth/login', { body: { email, password: 'Falsch-12345!' } })).statusCode).toBe(401);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, user!.id)))[0]!.passwordHash).toBe(legacy);

    await login(email);
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, user!.id));
    expect(after!.passwordHash.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(await verifyPassword(PASSWORD, after!.passwordHash)).toBe(true);

    const [entry] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.entityId, user!.id), eq(schema.auditLogs.event, 'LOGIN')))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(1);
    expect(entry!.newValue).toEqual({ passwordHashUpgraded: true });

    // Zweite Anmeldung mit dem neuen Hash funktioniert und stellt nicht erneut um.
    await login(email);
    const [again] = await db.select().from(schema.users).where(eq(schema.users.id, user!.id));
    expect(again!.passwordHash).toBe(after!.passwordHash);
  });
});
