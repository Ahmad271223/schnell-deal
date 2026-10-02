import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/core/db/client';
import {
  api,
  approvedDealer,
  approvedDealership,
  auditEvents,
  createPlatformUser,
  dealerPayload,
  dealershipPayload,
  json,
  login,
  PASSWORD,
  PDF_BYTES,
  upload,
  type Session,
} from './helpers';

let superadmin: Session;
let admin: Session;

beforeAll(async () => {
  superadmin = await createPlatformUser('SUPERADMIN');
  admin = await createPlatformUser('ADMIN');
});

describe('Login & Sessions', () => {
  it('lehnt falsche Passwörter ab und protokolliert den Fehlversuch', async () => {
    const res = await api('POST', '/auth/login', { body: { email: admin.email, password: 'falsch-falsch-1' } });
    expect(res.statusCode).toBe(401);
    expect(json(res).error.code).toBe('INVALID_CREDENTIALS');
    expect(await auditEvents(admin.userId)).toContain('LOGIN_FAILED');
  });

  it('gibt bei unbekannter E-Mail dieselbe Fehlermeldung zurück (keine User-Enumeration)', async () => {
    const res = await api('POST', '/auth/login', { body: { email: 'gibt-es-nicht@test.local', password: 'egal-egal-1' } });
    expect(res.statusCode).toBe(401);
    expect(json(res).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('setzt ein httpOnly-Session-Cookie mit SameSite=Lax', async () => {
    const res = await api('POST', '/auth/login', { body: { email: admin.email, password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('ohne Session → 401, Logout invalidiert die Session serverseitig', async () => {
    expect((await api('GET', '/auth/me')).statusCode).toBe(401);
    const s = await login(admin.email);
    expect((await api('GET', '/auth/me', { session: s })).statusCode).toBe(200);
    await api('POST', '/auth/logout', { session: s });
    expect((await api('GET', '/auth/me', { session: s })).statusCode).toBe(401);
  });

  it('Passwortänderung beendet alle Sessions', async () => {
    const inspector = await createPlatformUser('INSPECTOR');
    const second = await login(inspector.email);
    const res = await api('POST', '/auth/password', {
      session: inspector,
      body: { currentPassword: PASSWORD, newPassword: 'NeuesPasswort99' },
    });
    expect(res.statusCode).toBe(200);
    expect((await api('GET', '/auth/me', { session: second })).statusCode).toBe(401);
    expect((await api('GET', '/auth/me', { session: inspector })).statusCode).toBe(401);
    await login(inspector.email, 'NeuesPasswort99');
  });
});

describe('CSRF-Schutz', () => {
  it('lehnt mutierende Requests von fremden Origins ab', async () => {
    const res = await api('POST', '/auth/logout', { session: admin, headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('BAD_ORIGIN');
  });

  it('lehnt Cross-Site-Requests ohne Origin ab', async () => {
    const res = await api('POST', '/auth/logout', {
      session: admin,
      headers: { origin: '', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Registrierung Autohaus', () => {
  it('validiert Pflichtfelder und Zustimmungen', async () => {
    const res = await api('POST', '/register/dealership', { body: dealershipPayload({ acceptTerms: false, zip: 'abc' }) });
    expect(res.statusCode).toBe(400);
    const fields = json(res).error.details.fields;
    expect(fields.acceptTerms).toBeTruthy();
    expect(fields.zip).toBeTruthy();
  });

  it('kompletter Ablauf: Registrierung → Gewerbenachweis → Prüfung → Freigabe', async () => {
    const payload = dealershipPayload();
    const reg = await api('POST', '/register/dealership', { body: payload });
    expect(reg.statusCode).toBe(201);
    const companyId = json(reg).companyId as string;
    const s = await login(payload.email);

    let status = json(await api('GET', '/register/status', { session: s }));
    expect(status.status).toBe('REGISTRATION_STARTED');

    // Zustimmungen zu den aktuell gültigen Rechtstexten sind mit Zeitpunkt gespeichert.
    const acceptances = await db.select().from(schema.legalAcceptances).where(eq(schema.legalAcceptances.userId, s.userId));
    expect(acceptances.length).toBe(2);
    expect(acceptances.every((a) => a.acceptedAt instanceof Date)).toBe(true);

    // Vor Freigabe keine Teilnahme (z. B. keine Mitarbeiterverwaltung).
    const early = await api('POST', '/company/users', {
      session: s,
      body: { firstName: 'X', lastName: 'Y', email: 'early@test.local', companyRole: 'MEMBER', password: PASSWORD },
    });
    expect(early.statusCode).toBe(403);
    expect(json(early).error.code).toBe('COMPANY_NOT_APPROVED');

    const up = await upload('/company/documents', s, { kind: 'TRADE_LICENSE' }, { name: 'gewerbe.pdf', content: PDF_BYTES, type: 'application/pdf' });
    expect(up.statusCode).toBe(201);
    status = json(await api('GET', '/register/status', { session: s }));
    expect(status.status).toBe('IN_REVIEW');

    // Admin wurde benachrichtigt.
    const notes = json(await api('GET', '/notifications', { session: admin }));
    expect(notes.items.some((n: { type: string }) => n.type === 'COMPANY_REGISTERED')).toBe(true);

    // Admin sieht Gewerbenachweis.
    const detail = json(await api('GET', `/admin/companies/${companyId}`, { session: admin }));
    expect(detail.documents).toHaveLength(1);
    const file = await api('GET', `/admin/companies/${companyId}/documents/${detail.documents[0].id}/file`, { session: admin });
    expect(file.statusCode).toBe(302);
    expect(String(file.headers.location)).toContain('X-Amz-Signature');

    // Ablehnen ohne Begründung ist nicht erlaubt.
    expect((await api('POST', `/admin/companies/${companyId}/status`, { session: admin, body: { action: 'reject' } })).statusCode).toBe(400);

    const ap = await api('POST', `/admin/companies/${companyId}/status`, { session: admin, body: { action: 'approve' } });
    expect(ap.statusCode).toBe(200);
    status = json(await api('GET', '/register/status', { session: s }));
    expect(status.status).toBe('APPROVED');
    expect(await auditEvents(companyId)).toEqual(expect.arrayContaining(['REGISTER', 'COMPANY_DOCUMENT_UPLOADED', 'COMPANY_STATUS_CHANGED']));

    // Ungültiger Statuswechsel wird abgelehnt (APPROVED → IN_REVIEW).
    const bad = await api('POST', `/admin/companies/${companyId}/status`, { session: admin, body: { action: 'reopen' } });
    expect(bad.statusCode).toBe(409);
    expect(json(bad).error.code).toBe('INVALID_TRANSITION');
  });

  it('Registrierung ohne Gewerbenachweis → Unterlagen fehlen', async () => {
    const payload = dealershipPayload();
    await api('POST', '/register/dealership', { body: payload });
    const s = await login(payload.email);
    const res = await api('POST', '/register/submit', { session: s });
    expect(json(res).status).toBe('DOCUMENTS_MISSING');
  });

  it('doppelte E-Mail-Adresse wird erkannt', async () => {
    const payload = dealershipPayload();
    expect((await api('POST', '/register/dealership', { body: payload })).statusCode).toBe(201);
    const again = await api('POST', '/register/dealership', { body: { ...dealershipPayload(), email: payload.email.toUpperCase() } });
    expect(again.statusCode).toBe(409);
    expect(json(again).error.code).toBe('EMAIL_TAKEN');
  });
});

describe('Registrierung Händler & Bieterstatus', () => {
  it('Händler erfordert USt-ID und Bieterbedingungen', async () => {
    const res = await api('POST', '/register/dealer', { body: dealerPayload({ vatId: '', acceptBidderTerms: false }) });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.details.fields.vatId).toBeTruthy();
    expect(json(res).error.details.fields.acceptBidderTerms).toBeTruthy();
  });

  it('nach Freigabe darf der Händler bieten; Admin kann temporär sperren', async () => {
    const dealer = await approvedDealer(admin);
    let me = json(await api('GET', '/auth/me', { session: dealer }));
    expect(me.company.biddingStatus).toBe('CAN_BID');

    const noDate = await api('POST', `/admin/companies/${dealer.companyId}/bidding-status`, { session: admin, body: { status: 'TEMP_BLOCKED' } });
    expect(noDate.statusCode).toBe(400);

    const until = new Date(Date.now() + 86400_000).toISOString();
    const res = await api('POST', `/admin/companies/${dealer.companyId}/bidding-status`, {
      session: admin,
      body: { status: 'TEMP_BLOCKED', blockedUntil: until, note: 'Zahlungsverzug' },
    });
    expect(res.statusCode).toBe(200);
    me = json(await api('GET', '/auth/me', { session: dealer }));
    expect(me.company.biddingStatus).toBe('TEMP_BLOCKED');
    expect(await auditEvents(dealer.companyId)).toContain('BIDDING_STATUS_CHANGED');
  });

  it('Sperrung einer Firma beendet alle Sessions und verhindert Login', async () => {
    const dealer = await approvedDealer(admin);
    const res = await api('POST', `/admin/companies/${dealer.companyId}/status`, { session: admin, body: { action: 'block', note: 'Verstoß' } });
    expect(res.statusCode).toBe(200);
    expect((await api('GET', '/auth/me', { session: dealer })).statusCode).toBe(401);
    const loginRes = await api('POST', '/auth/login', { body: { email: dealer.email, password: PASSWORD } });
    expect(loginRes.statusCode).toBe(403);
    expect(json(loginRes).error.code).toBe('COMPANY_BLOCKED');
  });
});

describe('Rollen & Rechte', () => {
  it('Firmenbenutzer und Außendienst haben keinen Zugriff auf Admin-Routen', async () => {
    const ah = await approvedDealership(admin);
    const inspector = await createPlatformUser('INSPECTOR');
    for (const s of [ah, inspector]) {
      expect((await api('GET', '/admin/companies', { session: s })).statusCode).toBe(403);
      expect((await api('GET', '/admin/audit', { session: s })).statusCode).toBe(403);
      expect((await api('GET', '/admin/users', { session: s })).statusCode).toBe(403);
    }
    expect((await api('GET', '/admin/companies')).statusCode).toBe(401);
  });

  it('nur Superadmins dürfen Administratoren anlegen und Einstellungen ändern', async () => {
    const body = { firstName: 'Neu', lastName: 'Admin', email: 'neu-admin@test.local', platformRole: 'ADMIN', password: PASSWORD };
    expect((await api('POST', '/admin/users', { session: admin, body })).statusCode).toBe(403);
    expect((await api('POST', '/admin/users', { session: superadmin, body })).statusCode).toBe(201);
    const settings = json(await api('GET', '/admin/settings', { session: admin }));
    expect((await api('PUT', '/admin/settings', { session: admin, body: settings })).statusCode).toBe(403);
    expect((await api('PUT', '/admin/settings', { session: superadmin, body: { ...settings, paymentDueDays: 7 } })).statusCode).toBe(200);
  });

  it('Admin legt Außendienstmitarbeiter an; dieser kann sich anmelden', async () => {
    const res = await api('POST', '/admin/users', {
      session: admin,
      body: { firstName: 'Max', lastName: 'Mustermann', email: 'max.m@test.local', platformRole: 'INSPECTOR', password: PASSWORD, phone: '+49 170 1234567' },
    });
    expect(res.statusCode).toBe(201);
    const s = await login('max.m@test.local');
    expect(json(await api('GET', '/auth/me', { session: s })).user.platformRole).toBe('INSPECTOR');
    const list = json(await api('GET', '/admin/inspectors', { session: admin }));
    expect(list.some((u: { email: string }) => u.email === 'max.m@test.local')).toBe(true);
  });

  it('Firmenmitarbeiter: Inhaber legt Mitarbeiter an, Mitarbeiter darf keine Benutzer verwalten', async () => {
    const ah = await approvedDealership(admin);
    const res = await api('POST', '/company/users', {
      session: ah,
      body: { firstName: 'Vera', lastName: 'Verkauf', email: `vera-${ah.companyId}@test.local`, companyRole: 'MEMBER', jobTitle: 'Verkäuferin', password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    const vera = await login(`vera-${ah.companyId}@test.local`);
    expect(vera.companyId).toBe(ah.companyId);
    const denied = await api('POST', '/company/users', {
      session: vera,
      body: { firstName: 'X', lastName: 'Y', email: `x-${ah.companyId}@test.local`, companyRole: 'MEMBER', password: PASSWORD },
    });
    expect(denied.statusCode).toBe(403);
    // Mitarbeiter deaktivieren → Sessions beendet
    const off = await api('PATCH', `/company/users/${vera.userId}`, { session: ah, body: { isActive: false } });
    expect(off.statusCode).toBe(200);
    expect((await api('GET', '/auth/me', { session: vera })).statusCode).toBe(401);
  });
});

describe('Mandantentrennung (IDOR)', () => {
  it('Firma A kann Dokumente und Benutzer von Firma B nicht abrufen oder ändern', async () => {
    const a = await approvedDealership(admin);
    const b = await approvedDealership(admin);
    const docs = json(await api('GET', `/admin/companies/${b.companyId}`, { session: admin })).documents;
    const res = await api('GET', `/company/documents/${docs[0].id}/file`, { session: a });
    expect(res.statusCode).toBe(404);
    const patch = await api('PATCH', `/company/users/${b.userId}`, { session: a, body: { isActive: false } });
    expect(patch.statusCode).toBe(404);
    // Firmendaten liefern immer nur die eigene Firma, unabhängig von Parametern.
    const own = json(await api('GET', `/company?companyId=${b.companyId}`, { session: a }));
    expect(own.id).toBe(a.companyId);
  });

  it('ungültige UUIDs führen zu 400 statt Datenbankfehler', async () => {
    const res = await api('GET', '/admin/companies/1%20OR%201=1', { session: admin });
    expect(res.statusCode).toBe(400);
  });
});

describe('Upload-Validierung', () => {
  it('lehnt Dateien ab, deren Inhalt nicht zum erlaubten Typ passt', async () => {
    const payload = dealershipPayload();
    await api('POST', '/register/dealership', { body: payload });
    const s = await login(payload.email);
    const fake = await upload('/company/documents', s, { kind: 'TRADE_LICENSE' }, { name: 'gewerbe.pdf', content: Buffer.from('MZ\x90\x00 kein pdf'), type: 'application/pdf' });
    expect(fake.statusCode).toBe(415);
    const js = Buffer.from(PDF_BYTES.toString('latin1').replace('/Type/Catalog', '/Type/Catalog/OpenAction<</S/JavaScript/JS(app.alert(1))>>'), 'latin1');
    const evil = await upload('/company/documents', s, { kind: 'TRADE_LICENSE' }, { name: 'x.pdf', content: js, type: 'application/pdf' });
    expect(evil.statusCode).toBe(415);
    expect(json(evil).error.code).toBe('UNSAFE_PDF');
    const badKind = await upload('/company/documents', s, { kind: 'PASSPORT' }, { name: 'a.pdf', content: PDF_BYTES, type: 'application/pdf' });
    expect(badKind.statusCode).toBe(400);
  });
});

describe('Rechtstexte versionieren', () => {
  it('neue Version erfordert erneute Zustimmung mit Zeitstempel', async () => {
    const dealer = await approvedDealer(admin);
    expect(json(await api('GET', '/auth/me', { session: dealer })).pendingLegal).toHaveLength(0);
    const created = await api('POST', '/admin/legal', {
      session: admin,
      body: { kind: 'BIDDER_TERMS', version: `0.2-${Date.now()}`, title: 'Bieterbedingungen (Vorlage 0.2)', content: '[VORLAGE] neue Fassung' },
    });
    expect(created.statusCode).toBe(201);
    const pending = json(await api('GET', '/auth/me', { session: dealer })).pendingLegal;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('BIDDER_TERMS');
    const acc = await api('POST', '/auth/accept-legal', { session: dealer, body: { legalDocumentIds: [pending[0].id] } });
    expect(acc.statusCode).toBe(200);
    expect(json(await api('GET', '/auth/me', { session: dealer })).pendingLegal).toHaveLength(0);
  });
});

describe('Audit-Log ist unveränderlich', () => {
  it('UPDATE und DELETE auf audit_logs schlagen auf Datenbankebene fehl', async () => {
    const immutable = { cause: expect.objectContaining({ message: expect.stringMatching(/unveränderlich/) }) };
    await expect(db.execute(sql`UPDATE audit_logs SET event = 'X'`)).rejects.toMatchObject(immutable);
    await expect(db.execute(sql`DELETE FROM audit_logs`)).rejects.toMatchObject(immutable);
  });

  it('Admin kann das Audit-Log filtern', async () => {
    const res = json(await api('GET', `/admin/audit?event=LOGIN&actorUserId=${admin.userId}`, { session: admin }));
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i: { event: string }) => i.event === 'LOGIN')).toBe(true);
  });
});
