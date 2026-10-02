import { beforeAll, describe, expect, it } from 'vitest';
import { api, approvedDealership, approvedDealer, auditEvents, createPlatformUser, json, type Session } from './helpers';
import { inspectFullVehicle, startedInspection } from './flows';

let admin: Session;
let ah: Session;
let other: Session;
let inspector: Session;
let inspector2: Session;

const berlinDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const tomorrow = () => berlinDate(1);
const requestBody = (overrides: Record<string, unknown> = {}) => ({
  vehicleCount: 4,
  locationStreet: 'Lister Meile 10',
  locationZip: '30161',
  locationCity: 'Hannover',
  requestedDate: tomorrow(),
  earliestTime: '09:00',
  latestTime: '12:00',
  contactName: 'Frau Meyer',
  contactPhone: '+49 511 999999',
  notes: null,
  vehiclesDrivable: true,
  keysAvailable: true,
  papersAvailable: false,
  ...overrides,
});

beforeAll(async () => {
  admin = await createPlatformUser('ADMIN');
  ah = await approvedDealership(admin);
  other = await approvedDealership(admin);
  inspector = await createPlatformUser('INSPECTOR');
  inspector2 = await createPlatformUser('INSPECTOR');
});

describe('Aufnahmeanfrage (Autohaus)', () => {
  it('validiert Zeitfenster und Datum', async () => {
    const bad = await api('POST', '/inspection-requests', { session: ah, body: requestBody({ earliestTime: '14:00', latestTime: '10:00' }) });
    expect(bad.statusCode).toBe(400);
    const past = await api('POST', '/inspection-requests', { session: ah, body: requestBody({ requestedDate: '2020-01-01' }) });
    expect(past.statusCode).toBe(400);
  });

  it('legt eine Anfrage an, Admin wird informiert, Status-Text gemäß Spezifikation', async () => {
    const res = await api('POST', '/inspection-requests', { session: ah, body: requestBody() });
    expect(res.statusCode).toBe(201);
    const body = json(res);
    expect(body.status).toBe('NEW');
    expect(body.statusText).toBe('Anfrage eingegangen – Termin wird geplant.');
    expect(body.number).toMatch(/^AU-\d{4}-\d{5}$/);
    const unplanned = json(await api('GET', '/inspection-requests?view=unplanned', { session: admin }));
    expect(unplanned.some((r: { id: string }) => r.id === body.id)).toBe(true);
    expect(await auditEvents(body.id)).toContain('INSPECTION_CREATED');
  });

  it('Händler und nicht freigegebene Firmen können keine Anfragen stellen', async () => {
    const dealer = await approvedDealer(admin);
    expect((await api('POST', '/inspection-requests', { session: dealer, body: requestBody() })).statusCode).toBe(403);
  });
});

describe('Disposition & Sichtbarkeit', () => {
  it('Admin plant und weist zu; Autohaus sieht "Mitarbeiter Max M."; Außendienst sieht nur eigene Termine', async () => {
    const created = json(await api('POST', '/inspection-requests', { session: ah, body: requestBody() }));
    const scheduledAt = new Date(Date.now() + 86400_000).toISOString();
    expect((await api('POST', `/admin/inspection-requests/${created.id}/schedule`, { session: admin, body: { scheduledAt } })).statusCode).toBe(200);
    let detail = json(await api('GET', `/inspection-requests/${created.id}`, { session: ah }));
    expect(detail.status).toBe('PLANNED');
    expect(detail.statusText).toContain('Aufnahme geplant für');

    const assign = await api('POST', `/admin/inspection-requests/${created.id}/assign`, { session: admin, body: { inspectorUserId: inspector.userId } });
    expect(assign.statusCode).toBe(200);
    detail = json(await api('GET', `/inspection-requests/${created.id}`, { session: ah }));
    expect(detail.status).toBe('ASSIGNED');
    expect(detail.statusText).toMatch(/Aufnahme geplant für \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} Uhr – Mitarbeiter Max [A-Za-z]\./);
    expect(detail.assignment.inspectorPhone).toBeUndefined();

    // Außendienst 1 sieht den Auftrag, Außendienst 2 nicht.
    expect((await api('GET', `/inspection-requests/${created.id}`, { session: inspector })).statusCode).toBe(200);
    expect((await api('GET', `/inspection-requests/${created.id}`, { session: inspector2 })).statusCode).toBe(404);
    const list2 = json(await api('GET', '/inspection-requests?view=all', { session: inspector2 }));
    expect(list2.some((r: { id: string }) => r.id === created.id)).toBe(false);

    // Anderes Autohaus sieht den Auftrag nicht.
    expect((await api('GET', `/inspection-requests/${created.id}`, { session: other })).statusCode).toBe(404);

    // Benachrichtigungen an Mitarbeiter und Autohaus.
    const notes = json(await api('GET', '/notifications', { session: inspector }));
    expect(notes.items.some((n: { type: string }) => n.type === 'INSPECTOR_ASSIGNED')).toBe(true);
  });

  it('Umdisposition auf anderen Mitarbeiter', async () => {
    const created = json(await api('POST', '/inspection-requests', { session: ah, body: requestBody() }));
    await api('POST', `/admin/inspection-requests/${created.id}/assign`, { session: admin, body: { inspectorUserId: inspector.userId, scheduledAt: new Date(Date.now() + 7200_000).toISOString() } });
    await api('POST', `/admin/inspection-requests/${created.id}/assign`, { session: admin, body: { inspectorUserId: inspector2.userId } });
    expect((await api('GET', `/inspection-requests/${created.id}`, { session: inspector })).statusCode).toBe(404);
    expect((await api('GET', `/inspection-requests/${created.id}`, { session: inspector2 })).statusCode).toBe(200);
  });

  it('nur Außendienstmitarbeiter können zugewiesen werden', async () => {
    const created = json(await api('POST', '/inspection-requests', { session: ah, body: requestBody() }));
    const res = await api('POST', `/admin/inspection-requests/${created.id}/assign`, {
      session: admin,
      body: { inspectorUserId: admin.userId, scheduledAt: new Date(Date.now() + 7200_000).toISOString() },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Außendienst-Ablauf', () => {
  it('Statuskette bis Abschluss; Abschluss nur mit abgeschlossenen Fahrzeugaufnahmen', async () => {
    const requestId = await startedInspection(admin, ah, inspector);
    const detail = json(await api('GET', `/inspection-requests/${requestId}`, { session: inspector }));
    expect(detail.status).toBe('IN_PROGRESS');
    expect(detail.assignment.arrivedAt).toBeTruthy();

    const noVehicles = await api('POST', `/inspector/requests/${requestId}/status`, { session: inspector, body: { status: 'COMPLETED' } });
    expect(noVehicles.statusCode).toBe(409);
    expect(json(noVehicles).error.code).toBe('NO_VEHICLES');

    const vehicleId = await inspectFullVehicle(inspector, requestId, { complete: false });
    const open = await api('POST', `/inspector/requests/${requestId}/status`, { session: inspector, body: { status: 'COMPLETED' } });
    expect(open.statusCode).toBe(409);
    expect(json(open).error.code).toBe('VEHICLES_OPEN');

    expect((await api('POST', `/vehicles/${vehicleId}/complete`, { session: inspector })).statusCode).toBe(200);
    const done = await api('POST', `/inspector/requests/${requestId}/status`, { session: inspector, body: { status: 'COMPLETED' } });
    expect(done.statusCode).toBe(200);
    const after = json(await api('GET', `/inspection-requests/${requestId}`, { session: ah }));
    expect(after.status).toBe('COMPLETED');
    expect(after.vehicles).toHaveLength(1);
    expect(after.vehicles[0].status).toBe('WAITING_REVIEW');
  }, 60_000);

  it('Heute-Ansicht des Außendienstes enthält den Termin', async () => {
    const created = json(await api('POST', '/inspection-requests', { session: ah, body: requestBody({ requestedDate: berlinDate(0) }) }));
    const inOneHour = new Date(Date.now() + 3600_000);
    // Termin heute (Berliner Zeit) – nur wenn noch vor Mitternacht.
    const berlinDay = (d: Date) => d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
    const at = berlinDay(inOneHour) === berlinDay(new Date()) ? inOneHour : new Date();
    await api('POST', `/admin/inspection-requests/${created.id}/assign`, { session: admin, body: { inspectorUserId: inspector.userId, scheduledAt: at.toISOString() } });
    const today = json(await api('GET', '/inspection-requests?view=today', { session: inspector }));
    expect(today.some((r: { id: string }) => r.id === created.id)).toBe(true);
  });

  it('Stornierung: Autohaus nur vor Disposition, Admin jederzeit vor Fahrzeugaufnahme', async () => {
    const a = json(await api('POST', '/inspection-requests', { session: ah, body: requestBody() }));
    expect((await api('POST', `/inspection-requests/${a.id}/cancel`, { session: ah, body: { reason: 'Fahrzeuge verkauft' } })).statusCode).toBe(200);
    const b = json(await api('POST', '/inspection-requests', { session: ah, body: requestBody() }));
    await api('POST', `/admin/inspection-requests/${b.id}/assign`, { session: admin, body: { inspectorUserId: inspector.userId, scheduledAt: new Date(Date.now() + 7200_000).toISOString() } });
    expect((await api('POST', `/inspection-requests/${b.id}/cancel`, { session: ah, body: { reason: 'egal' } })).statusCode).toBe(409);
    expect((await api('POST', `/inspection-requests/${b.id}/cancel`, { session: admin, body: { reason: 'Autohaus abgesagt' } })).statusCode).toBe(200);
    const cancelled = json(await api('GET', '/inspection-requests?view=cancelled', { session: admin }));
    expect(cancelled.some((r: { id: string }) => r.id === b.id)).toBe(true);
  });
});
